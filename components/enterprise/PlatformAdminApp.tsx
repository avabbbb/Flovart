import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag,
  type TableColumnsType,
} from 'antd';
import { ArrowLeft, Building2, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';

import { ApiError, authApi, getToken, type HubUser } from '../../services/hubClient';
import { platformApi, type PlatformUser } from '../../services/platformApi';
import type { AuditLog, Organization } from '../../services/orgApi';

type CreateUserValues = {
  username: string;
  email: string;
  password: string;
  role: 'user' | 'admin';
};

const statusTag = (status: string) => (
  <Tag color={status === 'active' ? 'green' : status === 'suspended' ? 'orange' : 'default'}>
    {status === 'active' ? '启用' : status === 'suspended' ? '已暂停' : '已停用'}
  </Tag>
);

export default function PlatformAdminApp() {
  const [viewer, setViewer] = useState<HubUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getToken()) {
      setChecking(false);
      return;
    }
    authApi.me()
      .then(user => setViewer({ id: user.userId, username: user.username, email: user.email, role: user.role as HubUser['role'] }))
      .catch(() => setError('登录状态已失效'))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <CenteredMessage text="正在校验平台管理员身份..." />;
  if (!viewer) return <CenteredMessage text={error || '请先登录企业后台'} action={<Link to="/enterprise">前往登录</Link>} />;
  if (viewer.role !== 'admin') return <CenteredMessage text="当前账号不是平台管理员" action={<Link to="/enterprise">返回企业后台</Link>} />;

  return (
    <div className="theme-aware min-h-screen" style={{ background: 'var(--app-bg)', color: 'var(--isl-ink)' }}>
      <header className="flex h-12 items-center gap-2 px-4" style={{ borderBottom: '1px solid var(--isl-border)' }}>
        <Link to="/enterprise" className="isl-icon-btn h-8 w-8" title="返回企业后台" aria-label="返回企业后台"><ArrowLeft size={16} /></Link>
        <ShieldCheck size={17} style={{ color: 'var(--isl-mint-deep)' }} />
        <strong className="text-sm">Flovart 平台管理</strong>
        <span className="ml-auto text-xs" style={{ color: 'var(--isl-ink-soft)' }}>{viewer.username}</span>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Tabs
          defaultActiveKey="users"
          items={[
            { key: 'users', label: '账号管理', children: <UsersPanel viewerId={viewer.id} /> },
            { key: 'organizations', label: '租户管理', children: <OrganizationsPanel /> },
            { key: 'audit', label: '平台审计', children: <AuditTable load={() => platformApi.auditLogs()} /> },
          ]}
        />
      </main>
    </div>
  );
}

function UsersPanel({ viewerId }: { viewerId: string }) {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<CreateUserValues>();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setUsers((await platformApi.users()).list || []); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : '加载账号失败'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const update = useCallback(async (user: PlatformUser, patch: Partial<PlatformUser>) => {
    setError('');
    try {
      await platformApi.updateUser(user.id, patch);
      await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : '更新账号失败'); }
  }, [load]);

  const columns: TableColumnsType<PlatformUser> = [
    { title: '用户', dataIndex: 'username', render: (_, user) => <div><strong>{user.username}</strong><div className="text-xs opacity-60">{user.email}</div></div> },
    { title: '平台角色', dataIndex: 'role', render: (_, user) => <Select aria-label={`${user.username} 平台角色`} size="small" value={user.role} disabled={user.id === viewerId} onChange={role => void update(user, { role })} options={[{ value: 'user', label: '普通用户' }, { value: 'admin', label: '平台管理员' }]} /> },
    { title: '状态', dataIndex: 'status', render: statusTag },
    { title: '创建时间', dataIndex: 'createdAt', responsive: ['lg'], render: value => new Date(value).toLocaleString() },
    { title: '操作', key: 'actions', render: (_, user) => user.id === viewerId ? <span className="text-xs opacity-50">当前账号</span> : <Space>
      <Button size="small" onClick={() => void update(user, { status: user.status === 'active' ? 'suspended' : 'active' })}>{user.status === 'active' ? '暂停' : '恢复'}</Button>
      <Popconfirm title="逻辑停用该账号？现有登录会立即失效。" onConfirm={() => platformApi.deleteUser(user.id).then(load)}><Button size="small" danger>停用</Button></Popconfirm>
    </Space> },
  ];

  return <>
    {error && <Alert className="mb-3" type="error" showIcon message={error} />}
    <div className="mb-3 flex justify-end gap-2"><Button icon={<RefreshCw size={14} />} onClick={() => void load()}>刷新</Button><Button type="primary" icon={<Plus size={14} />} onClick={() => setOpen(true)}>创建账号</Button></div>
    <Table rowKey="id" columns={columns} dataSource={users} loading={loading} pagination={{ pageSize: 20 }} />
    <Modal title="创建企业账号" open={open} onCancel={() => setOpen(false)} okText="创建" cancelText="取消" onOk={() => form.submit()}>
      <Form<CreateUserValues> form={form} layout="vertical" initialValues={{ role: 'user' }} onFinish={async values => {
        try { await platformApi.createUser(values); form.resetFields(); setOpen(false); await load(); }
        catch (cause) { setError(cause instanceof ApiError ? cause.message : '创建账号失败'); }
      }}>
        <Form.Item name="username" label="用户名" rules={[{ required: true }, { min: 3 }]}><Input /></Form.Item>
        <Form.Item name="email" label="邮箱" rules={[{ required: true }, { type: 'email' }]}><Input /></Form.Item>
        <Form.Item name="password" label="初始密码" rules={[{ required: true }, { min: 8 }]}><Input.Password /></Form.Item>
        <Form.Item name="role" label="平台角色"><Select options={[{ value: 'user', label: '普通用户' }, { value: 'admin', label: '平台管理员' }]} /></Form.Item>
      </Form>
    </Modal>
  </>;
}

function OrganizationsPanel() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setOrganizations((await platformApi.organizations()).list || []); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : '加载租户失败'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const columns: TableColumnsType<Organization> = [
    { title: '租户', dataIndex: 'name', render: (_, org) => <div className="flex items-center gap-2"><Building2 size={15} /><div><strong>{org.name}</strong><div className="text-xs opacity-60">/{org.slug}</div></div></div> },
    { title: '状态', dataIndex: 'status', render: statusTag },
    { title: 'Owner', dataIndex: 'ownerId', responsive: ['lg'] },
    { title: '创建时间', dataIndex: 'createdAt', responsive: ['lg'], render: value => new Date(value).toLocaleString() },
    { title: '操作', render: (_, org) => <Button size="small" onClick={async () => { await platformApi.updateOrganization(org.id, org.status === 'active' ? 'suspended' : 'active'); await load(); }}>{org.status === 'active' ? '暂停租户' : '恢复租户'}</Button> },
  ];
  return <>{error && <Alert className="mb-3" type="error" showIcon message={error} />}<Table rowKey="id" columns={columns} dataSource={organizations} loading={loading} pagination={{ pageSize: 20 }} /></>;
}

export function AuditTable({ load }: { load: () => Promise<{ list: AuditLog[]; total: number }> }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setLogs((await load()).list || []); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : '加载审计日志失败'); }
    finally { setLoading(false); }
  }, [load]);
  useEffect(() => { void refresh(); }, [refresh]);
  const columns: TableColumnsType<AuditLog> = [
    { title: '时间', dataIndex: 'createdAt', render: value => new Date(value).toLocaleString() },
    { title: '操作者', dataIndex: 'actorId', responsive: ['md'] },
    { title: '动作', render: (_, log) => <Tag>{log.method}</Tag> },
    { title: '路由', dataIndex: 'route' },
    { title: '结果', dataIndex: 'statusCode', render: value => <Tag color={value < 400 ? 'green' : 'red'}>{value}</Tag> },
    { title: '请求 ID', dataIndex: 'requestId', responsive: ['xl'] },
  ];
  return <>{error && <Alert className="mb-3" type="error" showIcon message={error} />}<div className="mb-3 flex justify-end"><Button icon={<RefreshCw size={14} />} onClick={() => void refresh()}>刷新</Button></div><Table rowKey="id" columns={columns} dataSource={logs} loading={loading} pagination={{ pageSize: 20 }} /></>;
}

function CenteredMessage({ text, action }: { text: string; action?: React.ReactNode }) {
  return <div className="theme-aware flex min-h-screen items-center justify-center" style={{ background: 'var(--app-bg)', color: 'var(--isl-ink)' }}><div className="rounded-xl p-6 text-center" style={{ background: 'var(--isl-surface)', border: '1px solid var(--isl-border)' }}><p className="mb-3 text-sm">{text}</p>{action}</div></div>;
}
