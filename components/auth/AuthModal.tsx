import { Button, Modal } from 'antd';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

// 内测期账号功能未开放：保留入口与 props，调用方无需改动。
// 工程、素材与 API Key 仍只存在用户本机浏览器（localforage / IndexedDB）。
export function AuthModal({ open, onClose }: AuthModalProps) {
  return (
    <Modal open={open} onCancel={onClose} footer={null} title="Flovart 账号" width={380} centered>
      <div className="flex flex-col gap-3 py-2 text-sm" data-testid="auth-placeholder">
        <p>当前是内测版本，登录 / 注册功能后续更新。</p>
        <p style={{ color: 'var(--isl-ink-soft)' }}>
          现在无需账号即可使用全部功能：工程、素材和 API Key 都只保存在本机浏览器里，换电脑或换浏览器不会同步。
        </p>
        <Button type="primary" block onClick={onClose}>知道了</Button>
      </div>
    </Modal>
  );
}
