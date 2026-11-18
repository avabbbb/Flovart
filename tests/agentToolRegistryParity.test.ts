// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { AGENT_PUBLIC_COMMANDS } from '../tools/flovart/agent-surface.js';
import { AGENT_TOOL_HOSTS, AGENT_TOOL_SPECS, getAgentToolSpecs } from '../tools/flovart/agent-tools.js';
import { COMMAND_REGISTRY, executeFlovartCommand } from '../tools/flovart/core.js';
import { createMcpServer } from '../tools/flovart/mcp-server.js';
import { MCP_DEPRECATED_TOOL_NAMES } from '../tools/flovart/operation-gateway.js';
import { createFlovartAgentTools } from '../agent/tools.js';
import { BROWSER_DEFAULT_SYSTEM_PROMPT, createBrowserAgentTools } from '../services/browserAgentKernel';
import { specParameter } from '../dsh-plugin/src/tools';

const names = (host: string) => getAgentToolSpecs(host).map(spec => spec.name);

describe('one Agent tool definition, four hosts', () => {
  it('derives every spec from the canonical registry args', () => {
    for (const spec of AGENT_TOOL_SPECS) {
      const args = COMMAND_REGISTRY[spec.command].args as Record<string, string>;
      expect(Object.keys(spec.inputSchema.properties).sort(), spec.name).toEqual(Object.keys(args).sort());
      expect(spec.inputSchema.required.sort(), spec.name).toEqual(Object.entries(args).filter(([, type]) => !type.endsWith('?')).map(([name]) => name).sort());
    }
    expect(AGENT_TOOL_SPECS.map(spec => spec.command).sort()).toEqual([...AGENT_PUBLIC_COMMANDS].sort());
  });

  it('gives the new P0 tools their names on every host', () => {
    for (const host of AGENT_TOOL_HOSTS) {
      expect(names(host)).toEqual(expect.arrayContaining([
        'flovart_generate', 'flovart_models_list', 'flovart_note_write', 'flovart_workflow_node_stop', 'flovart_media_import',
        'flovart_script_materialize', 'flovart_workflow_inspect', 'flovart_workflow_apply', 'flovart_workflow_node_run', 'flovart_image_tool', 'flovart_video_tool', 'flovart_audio_tool',
      ]));
    }
  });

  it('splits the canvas tools by media and every parameter lands on exactly one family that uses it', () => {
    const props = (command: string) => getAgentToolSpecs('mcp').find(spec => spec.command === command)!.inputSchema.properties;
    const image = props('workflow.image.tool');
    const video = props('workflow.video.tool');
    const audio = props('workflow.audio.tool');
    for (const name of ['filters', 'maskNodeId', 'direction', 'amount', 'action', 'x', 'y', 'width', 'height', 'style', 'count', 'preset']) expect(image, name).toHaveProperty(name);
    for (const name of ['currentTimeSec', 'audio', 'sourceNodeIds', 'position']) expect(video, name).toHaveProperty(name);
    for (const name of ['semitones', 'speed']) expect(audio, name).toHaveProperty(name);
    expect(audio).not.toHaveProperty('filters');
    expect(image).not.toHaveProperty('semitones');
  });

  it('built-in Agent registers the builtin specs with the same names and schemas (projectId injected)', () => {
    const tools = createBrowserAgentTools({ projectId: 'p', confirm: async () => true, activeChangeSetId: '' });
    const toolNames = tools.map(tool => tool.name);
    for (const spec of getAgentToolSpecs('builtin')) {
      const tool = tools.find(item => item.name === spec.name);
      expect(tool, spec.name).toBeDefined();
      const properties = Object.keys((tool!.parameters as { properties: Record<string, unknown> }).properties).sort();
      expect(properties).toEqual(Object.keys(spec.inputSchema.properties).filter(name => name !== 'projectId').sort());
    }
    expect(toolNames.filter(name => name.startsWith('flovart_workflow_node_tool'))).toHaveLength(0);
    expect(toolNames.filter(name => /^flovart_(image|video|audio)_tool$/.test(name))).toHaveLength(3);
  });

  it('local Agent registers the local specs with the same names and schemas plus idempotencyKey for writes', () => {
    const tools = createFlovartAgentTools(async () => ({ ok: true }));
    expect(tools.map(tool => tool.name)).toEqual(names('local'));
    const generate = tools.find(tool => tool.name === 'flovart_generate')!;
    const schema = generate.parameters as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['prompt', 'references', 'run', 'idempotencyKey']));
    expect(schema.required).toEqual(expect.arrayContaining(['prompt', 'idempotencyKey']));
  });

  it('MCP lists the unified names plus the previous ones as deprecated aliases', async () => {
    const server = createMcpServer({ gateway: async () => ({ ok: true }), includePipeline: false, includeSkills: false, includeResources: false });
    const client = new Client({ name: 'parity', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).toEqual([...names('mcp'), ...Object.keys(MCP_DEPRECATED_TOOL_NAMES)]);
    const generate = tools.find(tool => tool.name === 'flovart_generate')!;
    expect(Object.keys(generate.inputSchema.properties || {})).toEqual(expect.arrayContaining(['prompt', 'references', 'modelId', 'run', 'idempotencyKey']));
  });

  it('DSH receives the same specs from command.list and maps their parameters', async () => {
    const listed = await executeFlovartCommand('command.list', {}) as { agentTools: Array<{ name: string }> };
    expect(listed.agentTools.map(spec => spec.name)).toEqual(names('dsh'));
    expect(specParameter({ type: 'string', enum: ['image', 'video'], description: '类型' }, true)).toEqual({ type: 'string', description: '类型；可选值：image / video', required: true });
    expect(specParameter({ type: 'array', items: { type: 'object' } }, false)).toMatchObject({ type: 'array', items: { type: 'json' } });
  });
});

describe('Agent prompts no longer teach text-node prompts or removed node types', () => {
  it('built-in system prompt routes generation through flovart_generate', () => {
    expect(BROWSER_DEFAULT_SYSTEM_PROMPT).toContain('flovart_generate');
    expect(BROWSER_DEFAULT_SYSTEM_PROMPT).toContain('flovart_note_write');
    expect(BROWSER_DEFAULT_SYSTEM_PROMPT).not.toMatch(/config（生成配置）|text-generate|audio-generate|视频配置节点|你不能自己导入文件/);
  });
});
