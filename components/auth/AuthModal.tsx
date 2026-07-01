import { useState } from 'react';
import { Modal, Input, Button, message } from 'antd';
import { useAuthStore } from '../../stores/useAuthStore';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AuthModal({ open, onClose, onSuccess }: AuthModalProps) {
  const { login, register } = useAuthStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (loading) return;
    setLoading(true);
    try {
      if (mode === 'login') {
        if (!identifier.trim() || !password) {
          message.warning('请输入账号和密码');
          setLoading(false);
          return;
        }
        await login(identifier.trim(), password);
      } else {
        if (!username.trim() || !email.trim() || !password) {
          message.warning('请填写用户名、邮箱和密码');
          setLoading(false);
          return;
        }
        await register(username.trim(), email.trim(), password);
      }
      message.success(mode === 'login' ? '登录成功' : '注册成功');
      onSuccess?.();
      handleClose();
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setIdentifier('');
    setUsername('');
    setEmail('');
    setPassword('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      footer={null}
      title={mode === 'login' ? '登录 Flovart' : '注册 Flovart'}
      width={380}
      centered
    >
      <div className="flex flex-col gap-4 py-2">
        {mode === 'register' && (
          <Input
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            size="large"
          />
        )}
        {mode === 'register' && (
          <Input
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            size="large"
          />
        )}
        {mode === 'login' && (
          <Input
            placeholder="用户名或邮箱"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            size="large"
          />
        )}
        <Input.Password
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          size="large"
          onPressEnter={handleSubmit}
        />
        <Button
          type="primary"
          size="large"
          block
          loading={loading}
          onClick={handleSubmit}
        >
          {mode === 'login' ? '登录' : '注册'}
        </Button>
        <div className="text-center text-sm text-gray-400">
          {mode === 'login' ? (
            <span>
              还没有账号？
              <button
                className="text-blue-500 hover:underline ml-1"
                onClick={() => setMode('register')}
              >
                注册
              </button>
            </span>
          ) : (
            <span>
              已有账号？
              <button
                className="text-blue-500 hover:underline ml-1"
                onClick={() => setMode('login')}
              >
                登录
              </button>
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}