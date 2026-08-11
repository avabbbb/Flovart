import {
  bytesToBase64,
  exactOptionalOrigin,
  provenanceUrl,
  sha256Hex,
  splitImportBytes,
} from './import-protocol.js';
import { NativeSession, nativeResult } from './native-client.js';
import { purgeLegacyExtensionStorage } from './storage-migration.js';

const MENU_IMPORT = 'flovart-import-image';
const MENU_OPEN = 'flovart-open-desktop';
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const SUPPORTED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

chrome.runtime.onInstalled.addListener(() => {
  void purgeLegacyExtensionStorage().catch(error => {
    console.error('[Flovart Browser Import] 清理旧扩展数据失败', error);
  });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_IMPORT,
      title: '添加图片到 Flovart',
      contexts: ['image'],
    });
    chrome.contextMenus.create({
      id: MENU_OPEN,
      title: '连接 / 打开 Flovart Desktop',
      contexts: ['page', 'image', 'selection'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_IMPORT) void importSelectedImage(info, tab);
  if (info.menuItemId === MENU_OPEN) void connectDesktop();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'FLOVART_DESKTOP_CONNECT') return undefined;
  connectDesktop()
    .then(result => sendResponse({ ok: true, result }))
    .catch(error => sendResponse({ ok: false, error: errorMessage(error) }));
  return true;
});

async function connectDesktop() {
  await setBridgeStatus('connecting', '正在连接 Flovart Desktop…');
  let session;
  try {
    session = new NativeSession();
    const pairing = nativeResult(await session.request({
      type: 'bridge.hello',
      protocolVersion: '1',
      capabilities: ['browser.import.image'],
    }, 35_000));
    if (pairing.status === 'rejected') throw new Error('Desktop 已拒绝此扩展连接');
    await setBridgeStatus('connected', 'Flovart Desktop 已连接');
    return pairing;
  } catch (error) {
    await setBridgeStatus('error', errorMessage(error));
    throw error;
  } finally {
    session?.disconnect();
  }
}

async function importSelectedImage(info, tab) {
  if (!info.srcUrl) return;
  // Start the exact-origin permission request synchronously from the context-menu
  // gesture; the gesture may no longer be valid after Desktop pairing completes.
  const imagePromise = readSelectedImage(info.srcUrl, info.pageUrl, tab?.id);
  await setBridgeStatus('importing', '正在读取所选图片…');
  let session;
  try {
    const image = await imagePromise;
    session = new NativeSession();
    const pairing = nativeResult(await session.request({
      type: 'bridge.hello',
      protocolVersion: '1',
      capabilities: ['browser.import.image'],
    }, 35_000));
    if (pairing.status === 'rejected') throw new Error('Desktop 已拒绝此扩展连接');

    const sha256 = await sha256Hex(image.bytes);
    const requestId = crypto.randomUUID();
    const transfer = nativeResult(await session.request({
      type: 'import.begin',
      payload: {
        requestId,
        kind: 'image',
        name: image.name,
        mimeType: image.mimeType,
        byteSize: image.bytes.length,
        sha256,
        sourceUrl: provenanceUrl(info.srcUrl),
        sourcePageUrl: provenanceUrl(info.pageUrl || tab?.url || ''),
        sourceTitle: tab?.title?.slice(0, 4096) || null,
        naturalWidth: image.width,
        naturalHeight: image.height,
      },
    }));

    let sequence = transfer.nextSequence || 0;
    let offset = transfer.receivedBytes || 0;
    if (offset > image.bytes.length) throw new Error('Desktop 返回的续传偏移无效');
    for (const chunk of splitImportBytes(image.bytes.subarray(offset))) {
      const ack = nativeResult(await session.request({
        type: 'import.chunk',
        transferId: transfer.transferId,
        sequence,
        dataBase64: bytesToBase64(chunk),
      }));
      sequence = ack.nextSequence;
      offset += chunk.length;
    }
    if (offset !== image.bytes.length) throw new Error('图片分块传输未完整结束');

    const receipt = nativeResult(await session.request({
      type: 'import.commit',
      transferId: transfer.transferId,
    }, 15_000));
    const destination = receipt.destinationProjectId ? '活动 Workflow' : '浏览器导入箱';
    await setBridgeStatus('imported', `已发送到${destination}`, receipt);
  } catch (error) {
    console.error('[Flovart Browser Import]', error);
    await setBridgeStatus('error', errorMessage(error));
  } finally {
    session?.disconnect();
  }
}

async function readSelectedImage(sourceUrl, pageUrl, tabId) {
  if (sourceUrl.startsWith('blob:')) {
    if (!tabId) throw new Error('无法从当前页面读取 Blob 图片');
    return readBlobImageFromTab(tabId, sourceUrl);
  }

  const optionalOrigin = exactOptionalOrigin(sourceUrl, pageUrl || '');
  let temporaryPermission = false;
  try {
    if (optionalOrigin) {
      temporaryPermission = await chrome.permissions.request({ origins: [optionalOrigin] });
      if (!temporaryPermission) throw new Error('未授予所选图片来源的临时读取权限');
    }
    const response = await fetch(sourceUrl, { cache: 'no-store', credentials: 'include' });
    if (!response.ok) throw new Error(`读取图片失败（HTTP ${response.status}）`);
    return inspectBlob(await response.blob(), sourceUrl);
  } finally {
    if (temporaryPermission && optionalOrigin) {
      await chrome.permissions.remove({ origins: [optionalOrigin] }).catch(() => false);
    }
  }
}

async function readBlobImageFromTab(tabId, sourceUrl) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [sourceUrl, MAX_IMAGE_BYTES],
    func: async (url, maximum) => {
      const response = await fetch(url);
      const blob = await response.blob();
      if (blob.size > maximum) throw new Error('图片超过 64 MB 限制');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32 * 1024) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32 * 1024));
      }
      return { dataBase64: btoa(binary), mimeType: blob.type };
    },
  });
  if (!result?.result?.dataBase64) throw new Error('页面没有返回 Blob 图片字节');
  const binary = atob(result.result.dataBase64);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return inspectBlob(new Blob([bytes], { type: result.result.mimeType }), sourceUrl);
}

async function inspectBlob(blob, sourceUrl) {
  if (!blob.size || blob.size > MAX_IMAGE_BYTES) throw new Error('图片大小必须在 1 B 到 64 MB 之间');
  const mimeType = normalizedImageMime(blob.type, sourceUrl);
  if (!SUPPORTED_MIME.has(mimeType)) throw new Error(`暂不支持此图片格式：${blob.type || 'unknown'}`);
  let width = null;
  let height = null;
  try {
    const bitmap = await createImageBitmap(blob);
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  } catch {
    // Desktop still validates bytes/hash; dimensions are optional metadata.
  }
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mimeType,
    name: imageName(sourceUrl, mimeType),
    width,
    height,
  };
}

function normalizedImageMime(value, sourceUrl) {
  const mime = String(value || '').split(';')[0].trim().toLowerCase();
  if (mime === 'image/jpg') return 'image/jpeg';
  if (SUPPORTED_MIME.has(mime)) return mime;
  const path = (() => { try { return new URL(sourceUrl).pathname.toLowerCase(); } catch { return ''; } })();
  if (/\.jpe?g$/.test(path)) return 'image/jpeg';
  if (/\.webp$/.test(path)) return 'image/webp';
  if (/\.gif$/.test(path)) return 'image/gif';
  if (/\.avif$/.test(path)) return 'image/avif';
  if (/\.png$/.test(path) || sourceUrl.startsWith('data:image/png')) return 'image/png';
  return mime;
}

function imageName(sourceUrl, mimeType) {
  const extension = {
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
  }[mimeType] || 'png';
  if (!sourceUrl.startsWith('http:') && !sourceUrl.startsWith('https:')) {
    return `browser-image.${extension}`;
  }
  try {
    const segment = decodeURIComponent(new URL(sourceUrl).pathname.split('/').pop() || '');
    const safe = segment.replace(/[\\/:*?"<>|]/g, '-').slice(0, 160);
    if (safe && safe.includes('.')) return safe;
  } catch {
    // data/blob URL
  }
  return `browser-image.${extension}`;
}

async function setBridgeStatus(state, message, receipt = null) {
  const status = { state, message, receipt, updatedAt: Date.now() };
  await chrome.storage.local.set({ flovartBridgeStatus: status });
  const badge = state === 'importing' || state === 'connecting' ? '…' : state === 'error' ? '!' : state === 'imported' ? '✓' : '';
  await chrome.action.setBadgeText({ text: badge });
  if (badge) await chrome.action.setBadgeBackgroundColor({ color: state === 'error' ? '#d14343' : '#168f82' });
  return status;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || '未知错误');
}
