const { app, BrowserWindow, ipcMain, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveCanvasUrl } = require('./canvas-url');
const { persistResolveArtifact, readPersistedResolveArtifact } = require('./artifact-store');
const { withCandidatesBin } = require('./candidates-bin');

const PLUGIN_ID = 'com.flovart.studio.resolve';
const MAX_MATERIALIZED_BYTES = 64 * 1024 * 1024;
const MAX_IMPORTED_ARTIFACT_BYTES = 64 * 1024 * 1024;
const SAFE_INTEGRATION_ERROR = 'Iris 无法连接 DaVinci Resolve；请确认 Resolve 集成组件已安装后重试。';
const SAFE_CONTEXT_ERROR = '无法安全读取 Resolve 项目状态；请确认项目已打开后重试。';
const SAFE_SELECTION_ERROR = '无法安全读取 Resolve 当前选择；请重新选择素材后重试。';
const SAFE_SOURCE_ERROR = '无法安全读取 Resolve 选中的本地素材；请确认素材在线后重试。';
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

function artifactBytes(artifact) {
  const value = artifact?.bytes;
  const supported = Buffer.isBuffer(value) || (ArrayBuffer.isView(value) && value.BYTES_PER_ELEMENT === 1) || Array.isArray(value);
  const byteLength = supported ? value.length : 0;
  if (!supported || byteLength <= 0) throw new Error('Iris 没有返回可持久化的 Resolve 产物字节。');
  if (byteLength > MAX_IMPORTED_ARTIFACT_BYTES) {
    throw new Error('Resolve 产物超过 64 MB 的本地面板传输上限；请先在 Iris 中导出较小版本。');
  }
  const bytes = Buffer.from(value);
  return bytes;
}

function importMetadata(persisted) {
  if (!persisted) return {};
  return {
    artifactId: persisted.artifactId,
    ...(persisted.taskId ? { taskId: persisted.taskId } : {}),
    ...(persisted.modelId ? { modelId: persisted.modelId } : {}),
    sha256: persisted.sha256,
    byteSize: persisted.byteSize,
    createdAt: persisted.createdAt,
  };
}

function importFailure(importStatus, message, persisted) {
  return { ok: false, importStatus, ...importMetadata(persisted), message };
}

function loadIntegration() {
  try {
    integration = require('./WorkflowIntegration.node');
    if (!integration.Initialize(PLUGIN_ID)) throw new Error('WorkflowIntegration 初始化失败。');
  } catch {
    // Native module load errors include the absolute installation/worktree path.
    bridgeError = SAFE_INTEGRATION_ERROR;
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

function safeDisplayName(value, fallback) {
  const raw = text(value) || text(fallback);
  if (!raw) return '';
  const fileUrl = /^file:\/\//i.test(raw);
  const filePath = fileUrl ? raw.replace(/^file:\/\//i, '') : raw;
  const isAbsolutePath = fileUrl || path.isAbsolute(filePath) || path.win32.isAbsolute(filePath) || path.posix.isAbsolute(filePath);
  if (isAbsolutePath) {
    return path.win32.basename(filePath) || path.posix.basename(filePath) || 'Media item';
  }
  return raw.slice(0, 256);
}

async function getName(value, fallback) {
  const method = value?.GetName || value?.getName;
  return safeDisplayName(await invoke(method, value), fallback);
}

async function context() {
  try {
    const project = await getProject();
    if (!project) return { available: false, title: bridgeError || '请打开一个 Resolve Studio 项目。' };
    const projectId = await getId(project);
    if (!projectId) return { available: false, title: 'Resolve 没有返回稳定的项目身份，无法安全绑定候选。' };
    const name = await getName(project, 'Resolve 项目');
    return { available: true, projectId, documentId: projectId, documentName: name, title: name };
  } catch {
    return { available: false, title: SAFE_CONTEXT_ERROR };
  }
}

async function selectionFromProject(project) {
  try {
    if (!project) return null;
    const projectId = await getId(project);
    if (!projectId) return null;
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
    const timelineId = await getId(timeline);
    const itemId = await getId(item);
    let range;
    try {
      // Timeline frame numbers, so the panel can show the record timecode of the captured item.
      const startFrame = Number(await item.GetStart?.());
      const endFrame = Number(await item.GetEnd?.());
      const fps = Number(await timeline.GetSetting?.('timelineFrameRate'));
      if (Number.isFinite(startFrame) && Number.isFinite(endFrame) && fps > 0) range = { startFrame, endFrame, fps };
    } catch { range = undefined; }
    return {
      selectionId: itemId,
      label: await getName(item, 'Timeline item ' + itemId),
      kind: 'video',
      locator: { projectId, ...(timelineId ? { timelineId } : {}), timelineItemId: itemId },
      ...(range ? { range } : {}),
      mimeType: 'video/mp4',
    };
  } catch {
    // Resolve's native exceptions can contain media paths; never forward them over IPC.
    throw new Error(SAFE_SELECTION_ERROR);
  }
}

async function selection() {
  try { return await selectionFromProject(await getProject()); }
  catch { throw new Error(SAFE_SELECTION_ERROR); }
}

async function materializeClip({ selection: expected }) {
  const expectedProjectId = typeof expected?.locator?.projectId === 'string' ? expected.locator.projectId.trim() : '';
  if (!expectedProjectId || !expected?.selectionId) throw new Error('Resolve 参考素材缺少冻结的项目或素材身份。');
  let project;
  let activeProjectId;
  try {
    project = await getProject();
    activeProjectId = project ? await getId(project) : '';
  } catch {
    throw new Error(SAFE_CONTEXT_ERROR);
  }
  if (!project || activeProjectId !== expectedProjectId) throw new Error('Resolve 当前项目已变化，请重新选择素材。');
  const current = await selectionFromProject(project);
  if (!current || current.selectionId !== expected.selectionId || locatorKey(current.locator) !== locatorKey(expected.locator)) {
    throw new Error('Resolve 当前选择已变化，请重新选择素材。');
  }
  let kind = 'video';
  let filePath = '';
  if (typeof expected.locator.clipId === 'string' && expected.locator.clipId) {
    let clips;
    try {
      const mediaPool = await project.GetMediaPool();
      clips = mediaPool && await mediaPool.GetSelectedClips();
    } catch {
      throw new Error(SAFE_SELECTION_ERROR);
    }
    let clip = null;
    try {
      for (const candidate of clips || []) {
        if (await getId(candidate) === expected.locator.clipId) { clip = candidate; break; }
      }
    } catch {
      throw new Error(SAFE_SELECTION_ERROR);
    }
    if (!clip) throw new Error('Resolve 当前 Media Pool 选择已变化，请重新选择素材。');
    try { filePath = text(await clip.GetClipProperty?.('File Path')); }
    catch { throw new Error(SAFE_SOURCE_ERROR); }
    if (!filePath) throw new Error('Resolve 没有返回当前 Media Pool 素材的可读取路径。');
  } else if (typeof expected.locator.timelineItemId === 'string' && expected.locator.timelineItemId) {
    let timeline;
    let currentTimelineId;
    let item;
    let currentItemId;
    try {
      timeline = await project.GetCurrentTimeline();
      currentTimelineId = timeline ? await getId(timeline) : '';
      item = timeline && await timeline.GetCurrentVideoItem();
      currentItemId = item ? await getId(item) : '';
    } catch {
      throw new Error(SAFE_SELECTION_ERROR);
    }
    if (!timeline) throw new Error('Resolve 当前时间线已关闭，请重新选择素材。');
    if (expected.locator.timelineId && currentTimelineId !== expected.locator.timelineId) {
      throw new Error('Resolve 当前时间线已变化，请重新选择素材。');
    }
    if (!item || currentItemId !== expected.locator.timelineItemId) {
      throw new Error('Resolve 当前时间线片段已变化，请重新选择素材。');
    }
    filePath = path.join(os.tmpdir(), 'iris-resolve-frame-' + crypto.randomUUID() + '.png');
    try {
      if (!await item.ExportCurrentFrameAsStill(filePath)) throw new Error('export-failed');
    } catch {
      try { fs.unlinkSync(filePath); } catch {}
      throw new Error('无法安全导出 Resolve 当前帧作为参考素材。');
    }
    kind = 'image';
  } else {
    throw new Error('Resolve 返回了不支持的素材定位信息。');
  }

  let bytes;
  try {
    if (!fs.existsSync(filePath)) throw new Error('missing');
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_MATERIALIZED_BYTES) throw new Error('too-large');
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    if (kind === 'image') try { fs.unlinkSync(filePath); } catch {}
    if (error?.message === 'too-large') throw new Error('Resolve 参考素材超过 64 MB，请先使用代理或当前帧。');
    throw new Error('无法从 Resolve 安全读取选中的本地参考素材。');
  }
  if (kind === 'image') try { fs.unlinkSync(filePath); } catch {}
  return { base64: bytes.toString('base64'), kind, mimeType: kind === 'image' ? 'image/png' : mimeFor(filePath) };
}

async function persistArtifact({ artifact }) {
  const bytes = artifactBytes(artifact);
  let persisted;
  try {
    persisted = persistResolveArtifact({ rootDir: app.getPath('userData'), bytes, artifact });
  } catch {
    throw new Error('Iris 无法安全保存或校验 Resolve 候选文件；请检查本地存储空间后重试。');
  }
  const { filePath, ...persistence } = persisted;
  return { status: 'persisted', ...persistence };
}

async function importArtifact({ artifact, persistence, target }) {
  if ((target?.kind || 'media-pool') !== 'media-pool') return importFailure('rejected', 'Resolve 第一版只支持写入 Media Pool。');
  const targetProjectId = typeof target?.projectId === 'string' ? target.projectId.trim() : '';
  if (!targetProjectId) return importFailure('rejected', 'Resolve 候选缺少冻结的项目身份，拒绝导入；请在原项目重新生成候选。');
  let persisted;
  if (persistence?.status === 'persisted') {
    try {
      persisted = readPersistedResolveArtifact({ rootDir: app.getPath('userData'), persistence });
    } catch {
      return importFailure('rejected', 'Resolve 候选文件不存在或完整性校验失败，未导入 Media Pool。');
    }
    if ((artifact?.artifactId && String(artifact.artifactId) !== persisted.artifactId)
        || (artifact?.sha256 && String(artifact.sha256).toLowerCase() !== persisted.sha256)
        || (artifact?.byteSize !== undefined && artifact.byteSize !== persisted.byteSize)
        || (artifact?.mimeType && String(artifact.mimeType).split(';', 1)[0].trim().toLowerCase() !== persisted.mimeType)) {
      return importFailure('rejected', 'Resolve 候选元数据与持久化回执不一致，拒绝导入。', persisted);
    }
  } else {
    let bytes;
    try { bytes = artifactBytes(artifact); }
    catch { return importFailure('rejected', 'Resolve 候选缺少可读取的有效素材字节，未执行导入。'); }
    try {
      persisted = persistResolveArtifact({ rootDir: app.getPath('userData'), bytes, artifact });
    } catch {
      return importFailure('rejected', 'Iris 无法安全保存或校验 Resolve 候选文件；未执行导入。');
    }
  }
  let resolve;
  let project;
  let activeProjectId = '';
  try {
    resolve = await getResolve();
    project = await getProject();
    activeProjectId = project ? await getId(project) : '';
  } catch {
    return importFailure('rejected', '无法核对 Resolve 当前项目，未执行 Media Pool 导入。', persisted);
  }
  if (!resolve || !project || activeProjectId !== targetProjectId) {
    return importFailure('rejected', !resolve || !project
      ? 'Resolve 当前没有可用项目；候选文件已保存在 Iris 本地，打开原项目后重试导入。'
      : 'Resolve 当前项目已改变；候选文件已保存在 Iris 本地，请切回原项目后重试导入。', persisted);
  }
  let mediaPool;
  try { mediaPool = await project.GetMediaPool(); }
  catch { return importFailure('rejected', '无法读取目标 Resolve 项目的 Media Pool，未执行导入。', persisted); }
  if (!mediaPool || typeof mediaPool.ImportMedia !== 'function') {
    return importFailure('rejected', '当前 Resolve API 未提供绑定到目标项目的 Media Pool 导入操作；候选文件已保留。', persisted);
  }
  let importInvoked = false;
  try {
    importInvoked = true;
    const { result: items, bin } = await withCandidatesBin(mediaPool, () => mediaPool.ImportMedia([persisted.filePath]));
    const ok = Array.isArray(items) ? items.length > 0 : Boolean(items);
    if (!ok) return importFailure('rejected', 'Resolve 没有接受导入；Iris 已保留本地产物文件，可重试。', persisted);
    const importedItemId = Array.isArray(items) && items[0] ? await getId(items[0]) : undefined;
    return {
      ok: true,
      importStatus: 'confirmed',
      targetId: 'media-pool',
      ...(importedItemId ? { mediaPoolItemId: importedItemId } : {}),
      ...(bin ? { mediaPoolBin: bin } : {}),
      ...importMetadata(persisted),
      message: bin
        ? `已添加到 Resolve Media Pool 的「${bin}」；Iris 已保留本地产物文件。`
        : '已添加到 Resolve Media Pool；Iris 已保留本地产物文件。',
    };
  } catch {
    return importFailure(importInvoked ? 'unknown' : 'rejected', importInvoked
      ? 'Resolve 已收到导入请求，但没有确认结果。请先检查 Media Pool；在确认前不要重试此候选。'
      : 'Resolve 导入失败；Iris 已保留本地产物文件，可重试。', persisted);
  }
}

function registerIpc() {
  ipcMain.handle('flovart:context', context);
  ipcMain.handle('flovart:selection', selection);
  ipcMain.handle('flovart:materialize-clip', materializeClip);
  ipcMain.handle('flovart:persist-artifact', persistArtifact);
  ipcMain.handle('flovart:import-artifact', importArtifact);
  ipcMain.handle('flovart:open-canvas', async () => {
    await shell.openExternal(resolveCanvasUrl());
    return { ok: true };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 600,
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
