const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EXTENSION_BY_MIME = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['video/mp4', '.mp4'],
  ['video/quicktime', '.mov'],
  ['video/mxf', '.mxf'],
  ['video/webm', '.webm'],
]);
const SECRET_SHAPED_VALUE = /(?:\bsk-[A-Za-z0-9_-]{8,}\b|\bBearer\s+\S{8,}|\bgh[pousr]_[A-Za-z0-9_]{12,}\b|\bAIza[0-9A-Za-z_-]{20,}\b)/i;
const FILE_EXTENSION = /\.(?:aep|drp|json|jpg|jpeg|log|mov|mp4|mxf|pem|png|webp|wav|mp3|key|txt)$/i;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function safeArtifactId(value, digest) {
  if (value === undefined || value === null || value === '') return `sha256-${digest}`;
  const id = typeof value === 'string' ? value : '';
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || SECRET_SHAPED_VALUE.test(id)) {
    throw new Error('Resolve 产物身份格式无效，无法建立稳定文件名。');
  }
  return id;
}

function looksLikeLocalPath(value) {
  const normalized = value.trim();
  const segments = normalized.split(/[\\/]+/);
  return path.posix.isAbsolute(normalized)
    || path.win32.isAbsolute(normalized)
    || /^[A-Za-z]:/.test(normalized)
    || /^(?:file|vfs|smb):\/\//i.test(normalized)
    || normalized.includes('\\')
    || segments.includes('.')
    || segments.includes('..')
    || /(?:^|[\\/])(?:Users|home|private|tmp|var|AppData|Program Files)(?:[\\/]|$)/i.test(normalized)
    || FILE_EXTENSION.test(normalized);
}

function safeProvenanceId(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const id = typeof value === 'string' ? value : '';
  if (!/^[A-Za-z0-9_./:-]{1,200}$/.test(id) || SECRET_SHAPED_VALUE.test(id) || looksLikeLocalPath(id)) {
    throw new Error(`Resolve 产物 ${label} 格式无效，拒绝写入元数据。`);
  }
  return id;
}

function ensureExclusiveFile(filePath, contents) {
  const stagingPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(stagingPath, contents, { flag: 'wx' });
    fs.linkSync(stagingPath, filePath);
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  } finally {
    try { fs.unlinkSync(stagingPath); } catch {}
  }
}

function artifactPath(rootDir, artifactId, digest, extension) {
  const identityHash = sha256(Buffer.from(artifactId, 'utf8')).slice(0, 16);
  return path.join(rootDir, 'artifacts', 'resolve', `iris-artifact-${identityHash}-sha256-${digest}${extension}`);
}

function readManifest(filePath, expected) {
  if (!fs.existsSync(filePath)) return null;
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('Resolve 产物 provenance 文件损坏，拒绝覆盖。');
  }
  if (value?.version !== 1
      || value.artifactId !== expected.artifactId
      || value.sha256 !== expected.sha256
      || value.byteSize !== expected.byteSize
      || value.mimeType !== expected.mimeType
      || (Object.hasOwn(expected, 'taskId') && value.taskId !== expected.taskId)
      || (Object.hasOwn(expected, 'modelId') && value.modelId !== expected.modelId)
      || typeof value.createdAt !== 'string') {
    throw new Error('Resolve 产物 provenance 与当前素材不一致，拒绝覆盖。');
  }
  return value;
}

/**
 * Keep a Resolve-imported source under Electron's persistent per-user data path.
 * The sidecar records artifact provenance; it is not a second task or media index.
 */
function persistResolveArtifact({ rootDir, bytes, artifact = {}, now = new Date() }) {
  if (typeof rootDir !== 'string' || !path.isAbsolute(rootDir)) {
    throw new Error('Resolve 产物需要有效的应用数据目录。');
  }
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new Error('Iris 没有返回可导入的 Resolve 产物字节。');
  }
  if (artifact.byteSize !== undefined
      && (!Number.isSafeInteger(artifact.byteSize) || artifact.byteSize !== bytes.length)) {
    throw new Error('Resolve 产物字节数与素材元数据不一致。');
  }

  const mimeType = String(artifact.mimeType || '').split(';', 1)[0].trim().toLowerCase();
  const extension = EXTENSION_BY_MIME.get(mimeType);
  if (!extension) throw new Error(`Resolve 暂不支持导入 ${mimeType || '未知'} 格式的产物。`);

  const digest = sha256(bytes);
  const declaredDigest = artifact.sha256 === undefined ? '' : String(artifact.sha256).toLowerCase();
  if (declaredDigest && (!/^[a-f0-9]{64}$/.test(declaredDigest) || declaredDigest !== digest)) {
    throw new Error('Resolve 产物 SHA-256 与素材元数据不一致。');
  }

  const artifactId = safeArtifactId(artifact.artifactId, digest);
  const taskId = safeProvenanceId(artifact.taskId, '任务身份');
  const modelId = safeProvenanceId(artifact.modelId, '模型身份');
  const artifactRoot = path.join(rootDir, 'artifacts', 'resolve');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const filePath = artifactPath(rootDir, artifactId, digest, extension);
  const manifestPath = `${filePath}.json`;

  if (!fs.existsSync(filePath)) ensureExclusiveFile(filePath, bytes);
  const persistedBytes = fs.readFileSync(filePath);
  if (persistedBytes.length !== bytes.length || sha256(persistedBytes) !== digest) {
    throw new Error('Resolve durable 产物已存在但校验失败，拒绝导入。');
  }

  const manifest = {
    version: 1,
    artifactId,
    ...(taskId ? { taskId } : {}),
    ...(modelId ? { modelId } : {}),
    mimeType,
    byteSize: bytes.length,
    sha256: digest,
    createdAt: now.toISOString(),
  };
  const existingManifest = readManifest(manifestPath, manifest);
  if (!existingManifest) {
    ensureExclusiveFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const savedManifest = readManifest(manifestPath, manifest);

  return {
    filePath,
    artifactId,
    ...(taskId ? { taskId } : {}),
    ...(modelId ? { modelId } : {}),
    sha256: digest,
    byteSize: bytes.length,
    mimeType,
    createdAt: savedManifest.createdAt,
  };
}

function readPersistedResolveArtifact({ rootDir, persistence }) {
  if (typeof rootDir !== 'string' || !path.isAbsolute(rootDir)) {
    throw new Error('Resolve 产物需要有效的应用数据目录。');
  }
  if (!persistence || persistence.status !== 'persisted') {
    throw new Error('Resolve 候选缺少持久化回执。');
  }
  const sha = String(persistence.sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha)
      || !Number.isSafeInteger(persistence.byteSize)
      || persistence.byteSize <= 0) {
    throw new Error('Resolve 持久化回执缺少有效的 SHA-256 或字节数。');
  }
  const artifactId = safeArtifactId(persistence.artifactId, sha);
  const mimeType = String(persistence.mimeType || '').split(';', 1)[0].trim().toLowerCase();
  const taskId = safeProvenanceId(persistence.taskId, '任务身份');
  const modelId = safeProvenanceId(persistence.modelId, '模型身份');
  const extension = EXTENSION_BY_MIME.get(mimeType);
  if (!extension) throw new Error(`Resolve 暂不支持导入 ${mimeType || '未知'} 格式的产物。`);

  const filePath = artifactPath(rootDir, artifactId, sha, extension);
  const manifest = readManifest(`${filePath}.json`, {
    artifactId,
    sha256: sha,
    byteSize: persistence.byteSize,
    mimeType,
    ...(taskId ? { taskId } : {}),
    ...(modelId ? { modelId } : {}),
  });
  if (!manifest) throw new Error('Resolve durable 候选文件已不存在，请重新生成。');
  const bytes = fs.readFileSync(filePath);
  if (bytes.length !== persistence.byteSize || sha256(bytes) !== sha) {
    throw new Error('Resolve durable 候选文件校验失败，拒绝导入。');
  }

  return {
    filePath,
    artifactId,
    ...(taskId ? { taskId } : {}),
    ...(modelId ? { modelId } : {}),
    sha256: sha,
    byteSize: bytes.length,
    mimeType,
    createdAt: manifest.createdAt,
  };
}

module.exports = { persistResolveArtifact, readPersistedResolveArtifact };
