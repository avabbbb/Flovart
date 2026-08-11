const statusDot = document.getElementById('statusDot');
const statusTitle = document.getElementById('statusTitle');
const statusMessage = document.getElementById('statusMessage');
const connectButton = document.getElementById('connectDesktop');
const receipt = document.getElementById('receipt');
const receiptName = document.getElementById('receiptName');
const receiptDestination = document.getElementById('receiptDestination');

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
  const lastReceipt = status?.receipt;
  receipt.hidden = !lastReceipt;
  if (lastReceipt) {
    receiptName.textContent = lastReceipt.name;
    receiptDestination.textContent = lastReceipt.destinationProjectId ? '已路由到活动 Workflow' : '保存在浏览器导入箱';
  }
}

chrome.storage.local.get('flovartBridgeStatus').then(result => render(result.flovartBridgeStatus));
chrome.storage.onChanged.addListener(changes => {
  if (changes.flovartBridgeStatus) render(changes.flovartBridgeStatus.newValue);
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
