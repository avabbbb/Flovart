#!/usr/bin/env node
import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { COMMAND_REGISTRY, executeFlovartCommand } from './core.js';
import { FlovartRuntimeClient, createRuntimeFacade } from './runtime-client.js';
import { createShadowRuntimeFacade } from './shadow-runtime.js';

console.error('================================================================');
console.error('Flovart Agent Bridge MCP Core Running');
console.error('================================================================');

const server = new McpServer({
  name: 'Flovart Agent Bridge',
  version: '0.3.0',
}, {
  instructions: 'Call flovart.status before generation. Use explicit prompts and deterministic arguments only. API keys must stay in the browser UI and never be echoed back by tools.',
});

class WebSocketRuntimeBridge {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.pending = new Map();
    this.connectionPromise = null;
  }

  async connect() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectionPromise) {
      return await this.connectionPromise;
    }

    const WebSocketCtor = globalThis.WebSocket;
    if (!WebSocketCtor) {
      throw new Error('WebSocket runtime unavailable in current Node environment');
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      const socket = new WebSocketCtor(this.url);
      let settled = false;

      const failPending = (message) => {
        for (const [, entry] of this.pending) {
          entry.reject(new Error(message));
        }
        this.pending.clear();
      };

      socket.addEventListener('open', () => {
        settled = true;
        this.socket = socket;
        resolve();
      }, { once: true });

      socket.addEventListener('error', (event) => {
        if (!settled) {
          settled = true;
          reject(event.error || new Error(`Failed to connect WebSocket bridge: ${this.url}`));
        }
      }, { once: true });

      socket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data || '{}'));
          const taskId = message.taskId;
          if (!taskId || !this.pending.has(taskId)) return;
          const entry = this.pending.get(taskId);
          this.pending.delete(taskId);
          entry.resolve(message.result ?? message);
        } catch (error) {
          console.error('Invalid WebSocket bridge message', error);
        }
      });

      socket.addEventListener('close', () => {
        this.socket = null;
        this.connectionPromise = null;
        failPending('WebSocket runtime bridge closed');
      });
    }).finally(() => {
      this.connectionPromise = null;
    });

    return await this.connectionPromise;
  }

  async execute(command, payload = {}) {
    await this.connect();

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket runtime bridge is not connected');
    }

    const taskId = `agent_cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return await new Promise((resolve, reject) => {
      this.pending.set(taskId, { resolve, reject });
      this.socket.send(JSON.stringify({ taskId, command, payload }));
    });
  }

  async close() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.pending.clear();
  }
}

const wsBridgeUrl = process.env.FLOVART_AGENT_BRIDGE_URL || '';
const wsBridge = wsBridgeUrl ? new WebSocketRuntimeBridge(wsBridgeUrl) : null;
const LOCAL_COMMANDS = new Set([
  'init',
  'doctor',
  'command.list',
  'command.schema',
  'inspiration.search',
  'inspiration.get',
  'prompt.enhance',
  'batch.plan',
  'workflow.plan-video',
  'preferences.manage',
  'models.list',
]);

async function withRuntime(command, args = {}) {
  if (LOCAL_COMMANDS.has(command)) {
    const result = await executeFlovartCommand(command, args, {});
    return commandEnvelope(command, result);
  }

  try {
    if (wsBridge) {
      const result = await wsBridge.execute(command, args);
      return commandEnvelope(command, result);
    }

    const client = new FlovartRuntimeClient();
    await client.connect();
    try {
      const runtime = createRuntimeFacade(client);
      const result = await executeFlovartCommand(command, args, runtime);
      return commandEnvelope(command, result);
    } finally {
      await client.disconnect();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/No Flovart tab found|Cannot query CDP targets|__flovartAPI not available|WebSocket runtime bridge is not connected|Failed to connect WebSocket bridge|fetch failed|ECONNREFUSED/i.test(message)) {
      try {
        const result = await executeFlovartCommand(command, args, createShadowRuntimeFacade());
        return commandEnvelope(command, result, { fallback: 'shadow-runtime' });
      } catch (shadowError) {
        return { ok: false, error: shadowError instanceof Error ? shadowError.message : String(shadowError) };
      }
    }
    return { ok: false, error: message };
  }
}

function textResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    isError: value?.ok === false,
  };
}

function commandEnvelope(command, result, extra = {}) {
  const ok = result?.ok !== false;
  return {
    ok,
    command,
    result,
    error: ok ? null : result?.error || { code: 'COMMAND_FAILED', message: `${command} failed` },
    ...extra,
  };
}

server.registerTool(
  'flovart.command_list',
  {
    description: 'List every atomic Flovart command and its machine-readable argument contract. Use this for discoverability before executing arbitrary commands.',
    inputSchema: z.object({}),
  },
  async () => textResult({ ok: true, commands: COMMAND_REGISTRY }),
);

server.registerTool(
  'flovart.command_execute',
  {
    description: 'Execute any registered atomic Flovart command by name with explicit JSON args. This is the universal CLI-anything control surface for Claude Code.',
    inputSchema: z.object({
      command: z.string().describe('Registered Flovart command, e.g. canvas.inspect or element.update-prompt.'),
      args: z.record(z.string(), z.unknown()).default({}).describe('Explicit JSON arguments for the command.'),
    }),
  },
  async ({ command, args }) => textResult(await withRuntime(command, args)),
);

server.registerTool(
  'flovart.init_host',
  {
    description: 'Write Flovart MCP configuration for a supported agent host such as opencode, Claude Code, Cursor, Windsurf, Roo, or VS Code.',
    inputSchema: z.object({
      host: z.enum(['project', 'opencode', 'claude', 'cursor', 'windsurf', 'roo', 'vscode', 'all']).default('project'),
      projectDir: z.string().optional(),
      dryRun: z.boolean().optional(),
    }),
  },
  async (args) => textResult(await withRuntime('init', args)),
);

server.registerTool(
  'flovart.doctor',
  {
    description: 'Diagnose local Flovart CLI/MCP setup, host config files, and CDP expectations without reading or exposing secrets.',
    inputSchema: z.object({
      projectDir: z.string().optional(),
      cdpPort: z.number().optional(),
    }),
  },
  async (args) => textResult(await withRuntime('doctor', args)),
);

server.registerTool(
  'flovart.search_inspiration',
  {
    description: 'Search curated Flovart image/video prompt inspirations before generating.',
    inputSchema: z.object({
      query: z.string().optional(),
      category: z.string().optional(),
      limit: z.number().optional(),
    }),
  },
  async (args) => textResult(await withRuntime('inspiration.search', args)),
);

server.registerTool(
  'flovart.get_inspiration',
  {
    description: 'Get one curated Flovart inspiration prompt by ID.',
    inputSchema: z.object({ id: z.string() }),
  },
  async (args) => textResult(await withRuntime('inspiration.get', args)),
);

server.registerTool(
  'flovart.enhance_prompt',
  {
    description: 'Enhance a brief image or video prompt using local Flovart agent preferences. This does not call an external LLM.',
    inputSchema: z.object({
      prompt: z.string(),
      style: z.string().optional(),
      aspectRatio: z.string().optional(),
      mode: z.enum(['image', 'video']).optional(),
      styleNotes: z.string().optional(),
    }),
  },
  async (args) => textResult(await withRuntime('prompt.enhance', args)),
);

server.registerTool(
  'flovart.plan_batch',
  {
    description: 'Create a deterministic multi-shot image generation plan from one brief. Use this before generate_images_batch.',
    inputSchema: z.object({
      prompt: z.string(),
      count: z.number().optional(),
      aspectRatio: z.string().optional(),
    }),
  },
  async (args) => textResult(await withRuntime('batch.plan', args)),
);

server.registerTool(
  'flovart.manage_preferences',
  {
    description: 'Get, set, reset, or add favorite local Flovart agent preferences. Does not store API keys.',
    inputSchema: z.object({
      action: z.enum(['get', 'set', 'reset', 'add-favorite']).default('get'),
      style: z.string().optional(),
      aspectRatio: z.string().optional(),
      imageModel: z.string().optional(),
      videoModel: z.string().optional(),
      styleNotes: z.string().optional(),
      prompt: z.string().optional(),
      title: z.string().optional(),
    }),
  },
  async (args) => textResult(await withRuntime('preferences.manage', args)),
);

server.registerTool(
  'flovart.list_models',
  {
    description: 'List agent-facing image/video model IDs that route through the Flovart browser provider setup.',
    inputSchema: z.object({ purpose: z.enum(['image', 'video', 'all']).optional() }),
  },
  async (args) => textResult(await withRuntime('models.list', args)),
);

server.registerTool(
  'flovart.status',
  {
    description: 'Inspect the running Flovart runtime. Use this before any media generation task.',
    inputSchema: z.object({}),
  },
  async () => textResult(await withRuntime('status')),
);

server.registerTool(
  'flovart.provider_status',
  {
    description: 'Inspect configured Flovart providers and selected image/video models. Does not expose API keys.',
    inputSchema: z.object({}),
  },
  async () => textResult(await withRuntime('provider.status')),
);

server.registerTool(
  'flovart.provider_begin_setup',
  {
    description: 'Open Flovart browser settings so the user can enter API keys safely in the UI.',
    inputSchema: z.object({
      provider: z.string().optional(),
      purpose: z.enum(['image', 'video', 'both']).optional(),
    }),
  },
  async (args) => textResult(await withRuntime('provider.begin-setup', args)),
);

server.registerTool(
  'flovart.provider_select_model',
  {
    description: 'Select image/video/text model IDs already configured in Flovart.',
    inputSchema: z.object({
      imageModel: z.string().optional(),
      videoModel: z.string().optional(),
      textModel: z.string().optional(),
    }),
  },
  async (args) => textResult(await withRuntime('provider.select-model', args)),
);

server.registerTool(
  'flovart.provider_test',
  {
    description: 'Check whether Flovart has configured models for image/video generation.',
    inputSchema: z.object({ purpose: z.enum(['image', 'video', 'both']).optional() }),
  },
  async (args) => textResult(await withRuntime('provider.test', args)),
);

server.registerTool(
  'flovart.canvas_list_media',
  {
    description: 'List only image and video elements on the Flovart canvas.',
    inputSchema: z.object({}),
  },
  async () => textResult(await withRuntime('canvas.list-media')),
);

server.registerTool(
  'flovart.canvas_add_image',
  {
    description: 'Add an image element to the media-only Flovart canvas. Do not use this for text.',
    inputSchema: z.object({
      href: z.string(),
      mimeType: z.string().optional(),
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    }),
  },
  async (args) => textResult(await withRuntime('canvas.add-image', args)),
);

server.registerTool(
  'flovart.canvas_add_video',
  {
    description: 'Add a video element to the media-only Flovart canvas. Do not use this for text.',
    inputSchema: z.object({
      href: z.string(),
      mimeType: z.string().optional(),
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    }),
  },
  async (args) => textResult(await withRuntime('canvas.add-video', args)),
);

server.registerTool(
  'flovart.generate_image',
  {
    description: 'Generate one image from an explicit prompt. Claude Code should write the prompt; Flovart only executes it.',
    inputSchema: z.object({
      prompt: z.string(),
      aspectRatio: z.string().optional(),
      placeOnCanvas: z.boolean().optional(),
    }),
  },
  async (args) => textResult(await withRuntime('generate.image', args)),
);

server.registerTool(
  'flovart.generate_images_batch',
  {
    description: 'Generate storyboard images from explicit per-shot prompts produced by Claude Code.',
    inputSchema: z.object({
      items: z.array(z.object({
        clientShotId: z.string().optional(),
        prompt: z.string(),
        negativePrompt: z.string().optional(),
        aspectRatio: z.string().optional(),
      })),
      placeOnCanvas: z.boolean().optional(),
      layout: z.string().optional(),
    }),
  },
  async (args) => textResult(await withRuntime('generate.images-batch', args)),
);

server.registerTool(
  'flovart.generate_video',
  {
    description: 'Generate a video from explicit prompt and optional source image canvas element IDs. No video editing timeline is exposed.',
    inputSchema: z.object({
      prompt: z.string(),
      sourceImageIds: z.array(z.string()).optional(),
      durationSec: z.number().optional(),
      aspectRatio: z.string().optional(),
    }),
  },
  async (args) => textResult(await withRuntime('generate.video', args)),
);

server.registerTool(
  'flovart.video_status',
  {
    description: 'Query a Flovart video generation job status.',
    inputSchema: z.object({ jobId: z.string() }),
  },
  async (args) => textResult(await withRuntime('video.status', args)),
);

server.registerTool(
  'flovart_element_create',
  {
    title: 'Create canvas element',
    description: 'Create an atomic Flovart canvas element.',
    inputSchema: z.object({
      id: z.string().optional().describe('Optional stable UUID for the element.'),
      type: z.enum(['image', 'video', 'text']).describe('Canvas element type.'),
      name: z.string().min(1).describe('Display name for the layer.'),
      x: z.number().describe('Canvas X coordinate.'),
      y: z.number().describe('Canvas Y coordinate.'),
      width: z.number().default(180).describe('Element width.'),
      height: z.number().default(180).describe('Element height.'),
      href: z.string().optional().describe('Media URL or data URL when creating image/video elements.'),
      mimeType: z.string().optional().describe('Media MIME type when creating image/video elements.'),
    }),
  },
  async (args) => textResult(await withRuntime('element.create', args)),
);

server.registerTool(
  'flovart_element_update_prompt',
  {
    title: 'Update element prompt',
    description: 'Update one media element prompt payload with @ reference support.',
    inputSchema: z.object({
      elementId: z.string().describe('Target canvas element ID.'),
      textPrompt: z.string().min(1).describe('Prompt text that may contain @layer references.'),
      modelId: z.string().default('flux-schnell').describe('Model ID for subsequent generation.'),
    }),
  },
  async (args) => textResult(await withRuntime('element.update-prompt', args)),
);

server.registerTool(
  'flovart_element_assign_slot',
  {
    title: 'Assign reference slot',
    description: 'Assign a resolved upstream media reference into an explicit slot role.',
    inputSchema: z.object({
      elementId: z.string().describe('Downstream target element ID.'),
      targetElementId: z.string().describe('Referenced upstream element ID.'),
      slotRole: z.enum(['first_frame', 'style_ref', 'control_net', 'unassigned']).describe('Explicit slot role.'),
    }),
  },
  async (args) => textResult(await withRuntime('element.assign-slot', args)),
);

server.registerTool(
  'flovart_element_ignite',
  {
    title: 'Ignite element generation',
    description: 'Run one media element generation in place.',
    inputSchema: z.object({
      elementId: z.string().describe('Target media element ID.'),
    }),
  },
  async (args) => textResult(await withRuntime('element.ignite', args)),
);

server.registerTool(
  'flovart_element_watch',
  {
    title: 'Watch element generation',
    description: 'Wait until a media element reaches success or error. Prefer this over shell polling when one terminal result is needed.',
    inputSchema: z.object({
      elementId: z.string().describe('Target media element ID.'),
      timeoutMs: z.number().optional().describe('Maximum wait time in milliseconds.'),
    }),
  },
  async (args) => textResult(await withRuntime('element.watch', args)),
);

server.registerTool(
  'flovart_canvas_update_element',
  {
    title: 'Update canvas element',
    description: 'Patch one existing canvas element. id and type are immutable.',
    inputSchema: z.object({
      id: z.string().describe('Target element ID.'),
      updates: z.record(z.string(), z.unknown()).describe('Element fields to patch.'),
    }),
  },
  async (args) => textResult(await withRuntime('canvas.update-element', args)),
);

server.registerTool(
  'flovart_canvas_remove_element',
  {
    title: 'Remove canvas element',
    description: 'Remove one canvas element by ID.',
    inputSchema: z.object({ id: z.string().describe('Target element ID.') }),
  },
  async (args) => textResult(await withRuntime('canvas.remove-element', args)),
);

server.registerTool(
  'flovart_canvas_select',
  {
    title: 'Select canvas elements',
    description: 'Replace the current canvas selection with explicit element IDs.',
    inputSchema: z.object({ ids: z.array(z.string()).describe('Element IDs to select.') }),
  },
  async (args) => textResult(await withRuntime('canvas.select', args)),
);

server.registerTool(
  'flovart_canvas_inspect',
  {
    title: 'Inspect canvas state',
    description: 'Inspect full canvas, selection, and viewport state.',
    inputSchema: z.object({}),
  },
  async () => textResult(await withRuntime('canvas.inspect')),
);

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
