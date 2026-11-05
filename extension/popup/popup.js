import { PAIRINGS_KEY, readPairings, removePairing, setPairingStatus } from '../background/web-pairings.js';

const statusDot = document.getElementById('statusDot');
const statusTitle = document.getElementById('statusTitle');
const statusMessage = document.getElementById('statusMessage');
const connectButton = document.getElementById('connectDesktop');
const receipt = document.getElementById('receipt');
const receiptName = document.getElementById('receiptName');
const receiptDestination = document.getElementById('receiptDestination');
const history = document.getElementById('history');
const historyList = document.getElementById('historyList');
const clearHistoryButton = document.getElementById('clearHistory');

const HISTORY_KEY = 'flovartImportHistory';

function render(status) {
  const state = status?.state || 'idle';
  statusDot.dataset.state = state;
  statusTitle.textContent = {
    connected: 'Desktop 已连接',
    connecting: '正在连接',
    importing: '正在导入',
    imported: '导入完成',
    error: '连接或导入失败',
  }[state] || '尚未连接';
  statusMessage.textContent = status?.message || '连接 Desktop 后即可右键导入图片';
  connectButton.textContent = state === 'error' ? '重新连接' : '连接 / 打开 Flovart Desktop';
  const lastReceipt = status?.receipt;
  receipt.hidden = !lastReceipt;
  if (lastReceipt) {
    receiptName.textContent = lastReceipt.name;
    receiptDestination.textContent = lastReceipt.destinationProjectId ? '已路由到活动 Workflow' : '保存在浏览器导入箱';
  }
}

function renderHistory(entries) {
  const list = Array.isArray(entries) ? entries : [];
  history.hidden = list.length === 0;
  historyList.textContent = '';
  for (const entry of list) {
    const item = document.createElement('li');
    const when = new Date(entry.at).toLocaleTimeString('zh-CN', { hour12: false });
    item.innerHTML = `<span>${escapeHtml(String(entry.name || '未命名图片'))}</span><small>${when} · ${escapeHtml(String(entry.destination || ''))}</small>`;
    historyList.appendChild(item);
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

chrome.storage.local.get(['flovartBridgeStatus', HISTORY_KEY]).then(result => {
  render(result.flovartBridgeStatus);
  renderHistory(result[HISTORY_KEY]);
});
chrome.storage.onChanged.addListener(changes => {
  if (changes.flovartBridgeStatus) render(changes.flovartBridgeStatus.newValue);
  if (changes[HISTORY_KEY]) renderHistory(changes[HISTORY_KEY].newValue);
});
const webPairings = document.getElementById('webPairings');
const webPairingList = document.getElementById('webPairingList');

function pairingButton(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', () => {
    button.disabled = true;
    action()
      .catch(error => render({ state: 'error', message: error instanceof Error ? error.message : String(error) }))
      .finally(() => { button.disabled = false; });
  });
  return button;
}

// 网页画布配对：pending 显示允许/拒绝，approved 显示断开。拒绝与断开都会删除条目，网页可再次发起。
function renderPairings(pairings) {
  const entries = Object.entries(pairings && typeof pairings === 'object' ? pairings : {});
  webPairings.hidden = entries.length === 0;
  webPairingList.textContent = '';
  for (const [origin, entry] of entries) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = origin;
    const state = document.createElement('small');
    const approved = entry?.status === 'approved';
    state.textContent = approved ? '已连接：可导入媒体、同步配置' : '请求连接：确认是你自己打开的 Flovart 画布再允许';
    item.append(label, state);
    if (approved) {
      item.append(pairingButton('断开', () => removePairing(origin)));
    } else {
      item.append(
        pairingButton('允许', () => setPairingStatus(origin, 'approved')),
        pairingButton('拒绝', () => removePairing(origin)),
      );
    }
    webPairingList.appendChild(item);
  }
}

readPairings().then(renderPairings);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[PAIRINGS_KEY]) renderPairings(changes[PAIRINGS_KEY].newValue);
});

connectButton.addEventListener('click', async () => {
  connectButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'FLOVART_DESKTOP_CONNECT' });
    if (!response?.ok) throw new Error(response?.error || '连接失败');
  } catch (error) {
    render({ state: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    connectButton.disabled = false;
  }
});

clearHistoryButton.addEventListener('click', async () => {
  await chrome.storage.local.remove(HISTORY_KEY);
  renderHistory([]);
});

// 插件内反推结果：只在 chrome.storage.session（浏览器关闭即清空），可复制或发送到已配对的网页画布。
const REVERSE_RESULT_KEY = 'flovartReversePrompt';
const reverseSection = document.getElementById('reverse');
const reversePrompt = document.getElementById('reversePrompt');
const reverseMeta = document.getElementById('reverseMeta');
const copyReverseButton = document.getElementById('copyReverse');
const sendReverseButton = document.getElementById('sendReverse');

function renderReverse(result) {
  reverseSection.hidden = !result?.prompt;
  if (!result?.prompt) return;
  reversePrompt.textContent = result.prompt;
  reverseMeta.textContent = result.provider + ' · ' + result.model;
  copyReverseButton.textContent = '复制';
  sendReverseButton.textContent = '发送到网页画布';
}

chrome.storage.session.get(REVERSE_RESULT_KEY).then(stored => renderReverse(stored[REVERSE_RESULT_KEY]));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[REVERSE_RESULT_KEY]) renderReverse(changes[REVERSE_RESULT_KEY].newValue);
});

copyReverseButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(reversePrompt.textContent || '');
  copyReverseButton.textContent = '已复制';
});

sendReverseButton.addEventListener('click', async () => {
  sendReverseButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'FLOVART_REVERSE_TO_CANVAS' });
    sendReverseButton.textContent = response?.ok ? '已发送' : '发送失败';
    if (!response?.ok) reverseMeta.textContent = response?.error || '发送失败';
  } finally {
    sendReverseButton.disabled = false;
  }
});
