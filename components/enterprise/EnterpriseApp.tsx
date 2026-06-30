// EnterpriseApp — 企业后台主页面（路由 /enterprise/*）
// 未登录时显示登录/注册表单（复用 OnboardingWizard 套路的视觉风格）
// 登录后：组织列表 + 创建组织 + 成员管理

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Building2, Users, Plus, Trash2, UserPlus, ShieldCheck, ShieldAlert, LogOut, Loader2 } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import ToastStack from '../Toast';
import { authApi, setToken, getToken, type HubUser } from '../../services/hubClient';
import { orgApi, type Organization, type OrgMember, type OrgRole } from '../../services/orgApi';
import { ApiError } from '../../services/hubClient';

type View = 'list' | 'org';

export default function EnterpriseApp() {
  const toast = useToast();
  const [user, setUser] = useState<HubUser | null>(null);
  const [view, setView] = useState<View>('list');
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMyOrgs = useCallback(async () => {
    try {
      const list = await orgApi.myOrgs();
      setOrgs(list || []);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载组织失败', 'error');
    }
  }, [toast]);

  const refresh = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);
    try {
      const [org, mems] = await Promise.all([orgApi.get(currentOrg.id), orgApi.members(currentOrg.id)]);
      setCurrentOrg(org);
      setMembers(mems || []);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载组织详情失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [currentOrg, toast]);

  // 进入初次：检查 token 是否有效
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    (async () => {
      try {
        const { userId } = await authApi.me();
        if (userId) {
          // me 仅返回 id；user 主体从 login/register 缓存或在 store 里取
          // 暂设一个临时 user 占位（足够标识）
          setUser((prev) => prev ?? { id: userId, username: '已登录', email: '', role: 'user' });
          await fetchMyOrgs();
        }
      } catch {
        setToken(null);
      }
    })();
  }, [fetchMyOrgs]);

  const handleAuthed = useCallback(async (u: HubUser) => {
    setUser(u);
    await fetchMyOrgs();
  }, [fetchMyOrgs]);

  const handleLogout = useCallback(() => {
    setToken(null);
    setUser(null);
    setOrgs([]);
    setCurrentOrg(null);
    setMembers([]);
    setView('list');
  }, []);

  const openOrg = useCallback(async (org: Organization) => {
    setCurrentOrg(org);
    setView('org');
    setLoading(true);
    try {
      const mems = await orgApi.members(org.id);
      setMembers(mems || []);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载成员失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const backToList = useCallback(() => {
    setView('list');
    setCurrentOrg(null);
    setMembers([]);
  }, []);

  if (!user) {
    return <AuthPanel onAuthed={handleAuthed} toast={toast} />;
  }

  const myRole = useMemo<OrgRole | null>(() => {
    if (!currentOrg) return null;
    const me = members.find((m) => m.userId === user.id);
    return me?.role ?? null;
  }, [currentOrg, members, user.id]);
  const canManage = myRole === 'owner' || myRole === 'admin';

  return (
    <div className="theme-aware min-h-screen" style={{ background: 'var(--app-bg)', color: 'var(--isl-ink)' }}>
      <header
        className="sticky top-0 z-30 flex h-12 items-center gap-2 px-4"
        style={{ background: 'var(--app-bg)', borderBottom: '1px solid var(--isl-border)' }}
      >
        <Link to="/" className="isl-icon-btn h-8 w-8" title="返回主页" aria-label="返回主页">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex items-center gap-2 min-w-0">
          <Building2 size={16} style={{ color: 'var(--isl-mint-deep)' }} />
          <span className="text-sm font-black tracking-[-0.03em]">Flovart 企业后台</span>
        </div>
        <span className="mx-1 h-4 w-px" style={{ background: 'var(--isl-border)' }} />
        {view === 'org' && currentOrg && (
          <button
            type="button"
            className="isl-tab px-2 py-1 text-[11px]"
            onClick={backToList}
          >
            组织列表
          </button>
        )}
        {view === 'org' && currentOrg && (
          <span className="truncate text-xs font-semibold" style={{ color: 'var(--isl-ink-soft)' }}>
            / {currentOrg.name}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden truncate text-xs sm:inline" style={{ color: 'var(--isl-ink-soft)' }}>
            {user.username}
          </span>
          <button type="button" className="isl-icon-btn h-8 w-8" onClick={handleLogout} title="退出登录" aria-label="退出登录">
            <LogOut size={15} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {view === 'list' && (
          <OrgListPanel
            orgs={orgs}
            onOpen={openOrg}
            onChanged={fetchMyOrgs}
            toast={toast}
          />
        )}
        {view === 'org' && currentOrg && (
          <OrgDetailPanel
            org={currentOrg}
            members={members}
            canManage={canManage}
            myRole={myRole}
            loading={loading}
            onRefresh={refresh}
            onDelete={async () => {
              try {
                await orgApi.delete(currentOrg.id);
                toast.show('组织已删除', 'success');
                await fetchMyOrgs();
                backToList();
              } catch (e) {
                toast.show(e instanceof ApiError ? e.message : '删除失败', 'error');
              }
            }}
            toast={toast}
          />
        )}
      </main>

      <ToastStack toasts={toast.toasts} onDismiss={toast.dismiss} />
    </div>
  );
}

// ===== 鉴权面板 =====
function AuthPanel({ onAuthed, toast }: { onAuthed: (u: HubUser) => void; toast: ReturnType<typeof useToast> }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === 'register') {
        const { user, token } = await authApi.register({ username, email, password });
        setToken(token);
        onAuthed(user);
        toast.show('注册成功', 'success');
      } else {
        const { user, token } = await authApi.login({ identifier, password });
        setToken(token);
        onAuthed(user);
        toast.show('登录成功', 'success');
      }
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '请求失败', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [mode, username, email, identifier, password, onAuthed, toast]);

  return (
    <div className="theme-aware min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--app-bg)', color: 'var(--isl-ink)' }}>
      <div className="w-full max-w-sm rounded-2xl p-7" style={{ background: 'var(--isl-surface)', border: '1.5px solid var(--isl-border)' }}>
        <div className="mb-6 flex items-center gap-2">
          <Link to="/" className="isl-icon-btn h-8 w-8" title="返回主页" aria-label="返回主页">
            <ArrowLeft size={16} />
          </Link>
          <div className="flex items-center gap-2">
            <Building2 size={18} style={{ color: 'var(--isl-mint-deep)' }} />
            <span className="text-base font-black tracking-[-0.03em]">Flovart 企业后台</span>
          </div>
        </div>

        <div className="isl-tabbar mb-5">
          {(['login', 'register'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`isl-tab px-3 py-2 text-xs ${mode === m ? 'isl-tab--active' : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && (
            <>
              <FormInput value={username} onChange={setUsername} placeholder="用户名（3-32 位字母数字下划线）" autoFocus />
              <FormInput value={email} onChange={setEmail} placeholder="邮箱" type="email" />
            </>
          )}
          {mode === 'login' && (
            <FormInput value={identifier} onChange={setIdentifier} placeholder="用户名或邮箱" autoFocus />
          )}
          <FormInput value={password} onChange={setPassword} placeholder="密码（至少 6 位）" type="password" />
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: 'var(--isl-mint-deep)' }}
          >
            {submitting ? '提交中...' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>
        <p className="mt-4 text-center text-[11px]" style={{ color: 'var(--isl-ink-ghost)' }}>
          注册的账号同时在 Flovart 社区生态与未来额度池通用
        </p>
      </div>
    </div>
  );
}

function FormInput({ value, onChange, placeholder, type = 'text', autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className="w-full rounded-lg px-3 py-2.5 text-sm"
      style={{
        background: 'var(--isl-surface-sunk)',
        border: '1.5px solid var(--isl-border)',
        color: 'var(--isl-ink)',
      }}
    />
  );
}

// ===== 组织列表面板 =====
function OrgListPanel({ orgs, onOpen, onChanged, toast }: {
  orgs: Organization[];
  onOpen: (org: Organization) => void;
  onChanged: () => Promise<void>;
  toast: ReturnType<typeof useToast>;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const create = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await orgApi.create({ slug, name });
      toast.show('组织已创建', 'success');
      setSlug('');
      setName('');
      setShowCreate(false);
      await onChanged();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '创建失败', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [slug, name, onChanged, toast]);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">我的组织</h2>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="isl-icon-btn flex h-8 items-center gap-1.5 px-3"
          style={{ background: 'var(--isl-mint-bg)', border: '1.5px solid var(--isl-mint)', color: 'var(--isl-mint-deep)' }}
        >
          <Plus size={14} />
          <span className="text-xs font-semibold">新建组织</span>
        </button>
      </div>

      {showCreate && (
        <form onSubmit={create} className="mb-4 space-y-2 rounded-xl p-4" style={{ background: 'var(--isl-surface)', border: '1.5px solid var(--isl-border)' }}>
          <FormInput value={slug} onChange={setSlug} placeholder="slug（字母数字短横线，3-80 位）" autoFocus />
          <FormInput value={name} onChange={setName} placeholder="组织名称" />
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            style={{ background: 'var(--isl-mint-deep)' }}
          >
            {submitting ? '创建中...' : '创建'}
          </button>
        </form>
      )}

      {orgs.length === 0 ? (
        <div className="rounded-xl p-10 text-center" style={{ background: 'var(--isl-surface)', border: '1.5px dashed var(--isl-border)' }}>
          <Users size={28} className="mx-auto mb-2" style={{ color: 'var(--isl-ink-ghost)' }} />
          <p className="text-sm" style={{ color: 'var(--isl-ink-soft)' }}>尚未加入任何组织</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {orgs.map((org) => (
            <li key={org.id}>
              <button
                type="button"
                onClick={() => onOpen(org)}
                className="w-full rounded-xl p-4 text-left transition-colors"
                style={{ background: 'var(--isl-surface)', border: '1.5px solid var(--isl-border)' }}
              >
                <div className="flex items-center gap-2">
                  <Building2 size={16} style={{ color: 'var(--isl-mint-deep)' }} />
                  <span className="font-semibold text-sm">{org.name}</span>
                </div>
                <p className="mt-1 truncate text-[11px]" style={{ color: 'var(--isl-ink-ghost)' }}>/{org.slug}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ===== 组织详情/成员管理面板 =====
function OrgDetailPanel({ org, members, canManage, myRole, loading, onRefresh, onDelete, toast }: {
  org: Organization;
  members: OrgMember[];
  canManage: boolean;
  myRole: OrgRole | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onDelete: () => Promise<void>;
  toast: ReturnType<typeof useToast>;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [byUsername, setByUsername] = useState('');
  const [newRole, setNewRole] = useState<OrgRole>('member');
  const [submitting, setSubmitting] = useState(false);

  const addMember = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await orgApi.addMember(org.id, { byUsername, role: newRole });
      toast.show('成员已添加', 'success');
      setByUsername('');
      setNewRole('member');
      setShowAdd(false);
      await onRefresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '添加失败', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [org.id, byUsername, newRole, onRefresh, toast]);

  const updateRole = useCallback(async (userId: string, role: OrgRole) => {
    try {
      await orgApi.updateMemberRole(org.id, userId, role);
      toast.show('角色已更新', 'success');
      await onRefresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '更新失败', 'error');
    }
  }, [org.id, onRefresh, toast]);

  const removeMember = useCallback(async (userId: string) => {
    if (!confirm('确认移除该成员？')) return;
    try {
      await orgApi.removeMember(org.id, userId);
      toast.show('成员已移除', 'success');
      await onRefresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '移除失败', 'error');
    }
  }, [org.id, onRefresh, toast]);

  const isOwner = myRole === 'owner';

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-bold">{org.name}</h2>
          <p className="text-[11px]" style={{ color: 'var(--isl-ink-ghost)' }}>/{org.slug}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {canManage && (
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className="isl-icon-btn flex h-8 items-center gap-1.5 px-3"
              style={{ background: 'var(--isl-mint-bg)', border: '1.5px solid var(--isl-mint)', color: 'var(--isl-mint-deep)' }}
            >
              <UserPlus size={14} />
              <span className="text-xs font-semibold">添加成员</span>
            </button>
          )}
          {isOwner && (
            <button
              type="button"
              onClick={onDelete}
              className="isl-icon-btn flex h-8 items-center gap-1.5 px-3"
              style={{ background: 'rgba(232,97,90,0.10)', border: '1.5px solid var(--isl-coral)', color: 'var(--isl-coral-deep)' }}
            >
              <Trash2 size={14} />
              <span className="text-xs font-semibold">删除组织</span>
            </button>
          )}
        </div>
      </div>

      {showAdd && canManage && (
        <form onSubmit={addMember} className="rounded-xl p-4 space-y-2" style={{ background: 'var(--isl-surface)', border: '1.5px solid var(--isl-border)' }}>
          <FormInput value={byUsername} onChange={setByUsername} placeholder="用户名（需已在 Flovart 注册）" autoFocus />
          <div className="flex items-center gap-2">
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as OrgRole)}
              className="rounded-lg px-3 py-2 text-xs"
              style={{ background: 'var(--isl-surface-sunk)', border: '1.5px solid var(--isl-border)', color: 'var(--isl-ink)' }}
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
              style={{ background: 'var(--isl-mint-deep)' }}
            >
              {submitting ? '添加中...' : '添加'}
            </button>
          </div>
        </form>
      )}

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--isl-surface)', border: '1.5px solid var(--isl-border)' }}>
        <div className="grid grid-cols-[minmax(0,1fr)_120px_120px_40px] items-center gap-2 px-4 py-2.5 text-[11px] font-bold uppercase"
          style={{ background: 'var(--isl-surface-2)', color: 'var(--isl-ink-soft)', borderBottom: '1px solid var(--isl-border)' }}>
          <span>成员</span>
          <span>角色</span>
          <span>加入时间</span>
          <span />
        </div>
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin" size={18} style={{ color: 'var(--isl-ink-ghost)' }} />
          </div>
        )}
        {!loading && members.length === 0 && (
          <div className="py-8 text-center text-xs" style={{ color: 'var(--isl-ink-ghost)' }}>尚无成员</div>
        )}
        {!loading && members.map((m) => (
          <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_120px_120px_40px] items-center gap-2 px-4 py-2.5 text-xs"
            style={{ borderBottom: '1px solid var(--isl-border)' }}>
            <div className="min-w-0">
              <div className="truncate font-semibold" style={{ color: 'var(--isl-ink)' }}>{m.user.username}</div>
              <div className="truncate text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>{m.user.email}</div>
            </div>
            <div>
              {canManage && m.role !== 'owner' ? (
                <select
                  value={m.role}
                  onChange={(e) => updateRole(m.userId, e.target.value as OrgRole)}
                  className="rounded-md px-2 py-1 text-[11px]"
                  style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)', color: 'var(--isl-ink)' }}
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              ) : (
                <RoleBadge role={m.role} />
              )}
            </div>
            <span className="truncate text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>
              {new Date(m.createdAt).toLocaleDateString()}
            </span>
            <div>
              {canManage && m.role !== 'owner' && (
                <button
                  type="button"
                  onClick={() => removeMember(m.userId)}
                  className="isl-icon-btn h-7 w-7"
                  title="移除成员"
                  aria-label="移除成员"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RoleBadge({ role }: { role: OrgRole }) {
  if (role === 'owner') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
        style={{ background: 'var(--isl-mint-bg)', color: 'var(--isl-mint-deep)', border: '1px solid var(--isl-mint)' }}>
        <ShieldCheck size={11} /> owner
      </span>
    );
  }
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
        style={{ background: 'var(--isl-surface-2)', color: 'var(--isl-ink)', border: '1px solid var(--isl-border-strong)' }}>
        <ShieldAlert size={11} /> admin
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: 'var(--isl-surface-sunk)', color: 'var(--isl-ink-soft)', border: '1px solid var(--isl-border)' }}>
      member
    </span>
  );
}