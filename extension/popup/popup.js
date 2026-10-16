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
