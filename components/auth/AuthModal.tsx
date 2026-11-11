import { Button, ConfigProvider, Modal, theme as antdTheme } from 'antd';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

// 内测期账号功能未开放：保留入口与 props，调用方无需改动。
// 工程、素材与 API Key 仍只存在用户本机浏览器（localforage / IndexedDB）。
export function AuthModal({ open, onClose }: AuthModalProps) {
  const dark = useResolvedTheme() === 'dark';
  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: '#19c8b9', fontFamily: 'inherit' },
      }}
    >
      <Modal
        open={open}
        onCancel={onClose}
        footer={null}
        title="Flovart 账号"
        width={380}
        centered
        styles={{
          container: { background: 'var(--panel-strong)', border: '1px solid var(--border-color)' },
          header: { background: 'transparent', color: 'var(--text-primary)' },
          body: { background: 'transparent', color: 'var(--text-primary)' },
          mask: { background: dark ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.35)' },
        }}
      >
        <div className="flex flex-col gap-3 py-2 text-sm" data-testid="auth-placeholder">
          <p>账号生态还在探索中，后续会更新多端同步等功能。</p>
          <p style={{ color: 'var(--isl-ink-soft)' }}>
            如果觉得好用，可以先到我的{' '}
            <a
              href="https://github.com/avabbbb/Flovart"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--isl-mint-deep, #12a89b)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2 }}
            >GitHub</a>{' '}
            上点个赞。
          </p>
          <Button type="primary" block onClick={onClose}>知道了</Button>
        </div>
      </Modal>
    </ConfigProvider>
  );
}
