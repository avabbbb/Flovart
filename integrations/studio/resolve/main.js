const { app, BrowserWindow, ipcMain, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveCanvasUrl } = require('./canvas-url');

const PLUGIN_ID = 'com.flovart.studio.resolve';
const MAX_MATERIALIZED_BYTES = 64 * 1024 * 1024;
let integration = null;
let resolveApi = null;
let mainWindow = null;
let bridgeError = null;

const text = value => String(value || '').trim();
const invoke = async (value, target) => {
  if (typeof value !== 'function') return value;
  return value.call(target);
};
const mimeFor = filePath => ({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.mxf': 'video/mxf',
}[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
const locatorKey = locator => JSON.stringify(Object.entries(locator || {}).sort(([left], [right]) => left.localeCompare(right)));
const sha256hex = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const artifactsDir = () => {
  const dir = path.join(app.getPath('userData'), 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
async function importArtifact({ artifact, target }) {
  if ((target?.kind || 'media-pool') !== 'media-pool') throw new Error('Resolve 第一版只支持写入 Media Pool。');
  const raw = artifact?.bytes;
  // 渲染端现传 Uint8Array（结构化克隆）；兼容旧版普通数组负载。
  const bytes = Array.isArray(raw)
    ? Buffer.from(raw)
    : raw instanceof Uint8Array
      ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
      : null;
  if (!bytes?.length) throw new Error('Iris 没有返回可导入的 Resolve 产物。');
  if (bytes.length > MAX_MATERIALIZED_BYTES) throw new Error('Iris 产物超过 64MB 上限，未导入 Resolve。');
  const extension = artifact.mimeType === 'image/png' ? '.png' : artifact.mimeType === 'image/jpeg' ? '.jpg' : artifact.mimeType === 'video/quicktime' ? '.mov' : '.mp4';
  // Resolve 可能引用而不是复制源文件：产物必须落在持久目录，导入后绝不删除。
  const sha256 = sha256hex(bytes);
  const name = `iris-${text(artifact.artifactId) || crypto.randomUUID()}-${sha256.slice(0, 8)}${extension}`;
  const filePath = path.join(artifactsDir(), name);
  if (!(fs.existsSync(filePath) && sha256hex(fs.readFileSync(filePath)) === sha256)) fs.writeFileSync(filePath, bytes);
  const manifest = {
    artifactId: text(artifact.artifactId) || undefined,
    sha256,
    byteSize: bytes.length,
    mimeType: text(artifact.mimeType) || undefined,
    createdAt: new Date().toISOString(),
    providerTaskId: text(artifact.providerTaskId || artifact.taskId) || undefined,
    prompt: text(artifact.prompt).slice(0, 500) || undefined,
    modelId: text(artifact.modelId) || undefined,
  };
  try { fs.writeFileSync(filePath + '.iris.json', JSON.stringify(manifest, null, 2)); } catch {}
  const resolve = await getResolve();
  const storage = resolve && await resolve.GetMediaStorage();
  const items = storage && await storage.AddItemListToMediaPool([filePath]);
  const ok = Array.isArray(items) ? items.length > 0 : Boolean(items);
  return {
    ok,
    targetId: ok ? 'media-pool' : undefined,
    message: ok ? '已添加到 Resolve Media Pool。' : 'Resolve 没有接受这个产物。',
    artifact: { path: filePath, sha256, byteSize: bytes.length },
  };
}

function loadIntegration() {
  try {
    integration = require('./WorkflowIntegration.node');
    if (!integration.Initialize(PLUGIN_ID)) throw new Error('WorkflowIntegration 初始化失败。');
  } catch (error) {
    bridgeError = error instanceof Error ? error.message : String(error);
  }
}

async function getResolve() {
  if (!integration) return null;
  if (!resolveApi) resolveApi = await integration.GetResolve();
  return resolveApi || null;
}

async function getProject() {
  const resolve = await getResolve();
  const manager = resolve && await resolve.GetProjectManager();
  return manager && await manager.GetCurrentProject();
}

async function getId(value) {
  const method = value?.GetUniqueId || value?.getUniqueId;
  return text(await invoke(method, value));
}

async function getName(value, fallback) {
  const method = value?.GetName || value?.getName;
  return text(await invoke(method, value)) || fallback;
}

async function context() {
  const project = await getProject();
  if (!project) return { available: false, title: bridgeError || '请打开一个 Resolve Studio 项目。' };
  const projectId = await getId(project);
  const name = await getName(project, 'Resolve 项目');
  return { available: true, projectId, documentId: projectId, documentName: name, title: name };
}

async function selection() {
  const project = await getProject();
  if (!project) return null;
  const projectId = await getId(project);
  const mediaPool = await project.GetMediaPool();
  const clips = mediaPool && await mediaPool.GetSelectedClips();
  const clip = clips?.[0];
  if (clip) {
    const clipId = await getId(clip);
    const name = await getName(clip, 'Clip ' + clipId);
    const filePath = text(await clip.GetClipProperty?.('File Path'));
    return { selectionId: clipId, label: name, kind: 'video', locator: { projectId, clipId }, mimeType: filePath ? mimeFor(filePath) : 'video/mp4' };
  }
  const timeline = await project.GetCurrentTimeline();
  const item = timeline && await timeline.GetCurrentVideoItem();
  if (!item) return null;
  const itemId = await getId(item);
  return { selectionId: itemId, label: await getName(item, 'Timeline item ' + itemId), kind: 'video', locator: { projectId, timelineItemId: itemId }, mimeType: 'video/mp4' };
}

async function materializeClip({ selection: expected }) {
  const current = await selection();
  if (!current || current.selectionId !== expected?.selectionId || locatorKey(current.locator) !== locatorKey(expected?.locator)) throw new Error('Resolve 当前选择已变化，请重新选择素材。');
  const project = await getProject();
  const mediaPool = await project.GetMediaPool();
  const clips = mediaPool && await mediaPool.GetSelectedClips();
  const clip = clips?.[0];
  let filePath = text(await clip?.GetClipProperty?.('File Path'));
  let kind = 'video';
  if (!filePath) {
    const timeline = await project.GetCurrentTimeline();
    const item = timeline && await timeline.GetCurrentVideoItem();
    if (!item) throw new Error('Resolve 没有可物化的当前帧。');
    filePath = path.join(os.tmpdir(), 'flovart-resolve-frame-' + crypto.randomUUID() + '.png');
    if (!await item.ExportCurrentFrameAsStill(filePath)) throw new Error('Resolve 当前帧导出失败。');
    kind = 'image';
  }
  if (!fs.existsSync(filePath)) throw new Error('Resolve 没有返回可读取的素材文件。');
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_MATERIALIZED_BYTES) throw new Error('Resolve 参考素材超过 64 MB，请先使用代理或当前帧。');
  const bytes = fs.readFileSync(filePath);
  if (kind === 'image') try { fs.unlinkSync(filePath); } catch {}
  return { base64: bytes.toString('base64'), kind, mimeType: kind === 'image' ? 'image/png' : mimeFor(filePath) };
}


function registerIpc() {
  ipcMain.handle('flovart:context', context);
  ipcMain.handle('flovart:selection', selection);
  ipcMain.handle('flovart:materialize-clip', materializeClip);
  ipcMain.handle('flovart:import-artifact', importArtifact);
  ipcMain.handle('flovart:artifact-dir', async () => artifactsDir());
  ipcMain.handle('flovart:locale', async () => app.getLocale());
  ipcMain.handle('flovart:open-canvas', async () => {
    await shell.openExternal(resolveCanvasUrl());
    return { ok: true };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 360,
    height: 600,
    // PRODUCT_UI_SPEC: default 340–380px, minimum usable 280px. Panel CSS is
    // fluid down to 280; allow the host to dock it at the minimum.
    minWidth: 280,
    minHeight: 460,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => { loadIntegration(); registerIpc(); createWindow(); });
app.on('before-quit', () => { try { integration?.CleanUp?.(); } catch {} });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
