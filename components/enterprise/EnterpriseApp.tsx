// EnterpriseApp — 企业后台主页面（路由 /enterprise/*）
// 登录后：组织列表 + 组织详情（成员名册 / 部门 / 角色 三标签）

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft, Building2, Users, Plus, Trash2, UserPlus, LogOut, Loader2,
  Shield, Check, Star,
} from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import ToastStack from '../Toast';
import { authApi, setToken, getToken, type HubUser, ApiError } from '../../services/hubClient';
import {
  orgApi, type Organization, type DeptNode,
  type DepartmentMember, type Role, ALL_PERMISSIONS,
} from '../../services/orgApi';

type View = 'list' | 'org';
type Tab = 'members' | 'depts' | 'roles';

export default function EnterpriseApp() {
  const toast = useToast();
  const [user, setUser] = useState<HubUser | null>(null);
  const [view, setView] = useState<View>('list');
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);

  const fetchMyOrgs = useCallback(async () => {
    try {
      setOrgs((await orgApi.myOrgs()) || []);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载组织失败', 'error');
    }
  }, [toast]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    (async () => {
      try {
        const { userId } = await authApi.me();
        if (userId) {
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
    setView('list');
  }, []);

  const openOrg = useCallback((org: Organization) => {
    setCurrentOrg(org);
    setView('org');
  }, []);

  const backToList = useCallback(() => {
    setView('list');
    setCurrentOrg(null);
  }, []);

  if (!user) return <AuthPanel onAuthed={handleAuthed} toast={toast} />;

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
          <button type="button" className="isl-tab px-2 py-1 text-[11px]" onClick={backToList}>
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
          <OrgListPanel orgs={orgs} onOpen={openOrg} onChanged={fetchMyOrgs} toast={toast} />
        )}
        {view === 'org' && currentOrg && (
          <OrgDetailPanel org={currentOrg} user={user} onDeleted={backToList} toast={toast} />
        )}
      </main>

      <ToastStack toasts={toast.toasts} onDismiss={toast.dismiss} />
    </div>
  );
}

// ===== 组织详情（三标签页）=====
function OrgDetailPanel({ org, user, onDeleted, toast }: {
  org: Organization;
  user: HubUser;
  onDeleted: () => void;
  toast: ReturnType<typeof useToast>;
}) {
  const [members, setMembers] = useState<DepartmentMember[]>([]);
  const [perms, setPerms] = useState<string[]>([]);
  const [depts, setDepts] = useState<DeptNode[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('members');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [mems, mp, tree, rs] = await Promise.all([
        orgApi.members(org.id),
        orgApi.myPerms(org.id),
        orgApi.deptTree(org.id),
        orgApi.roles(org.id),
      ]);
      setMembers(mems || []);
      setPerms(mp?.permissions || []);
      setDepts(tree || []);
      setRoles(rs || []);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载组织详情失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [org.id, toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const refreshMembers = useCallback(async () => {
    try { setMembers((await orgApi.members(org.id)) || []); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : '加载成员失败', 'error'); }
  }, [org.id, toast]);
  const refreshTree = useCallback(async () => {
    try { setDepts((await orgApi.deptTree(org.id)) || []); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : '加载部门失败', 'error'); }
  }, [org.id, toast]);
  const refreshRoles = useCallback(async () => {
    try { setRoles((await orgApi.roles(org.id)) || []); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : '加载角色失败', 'error'); }
  }, [org.id, toast]);

  const can = useCallback((p: string) => perms.includes(p), [perms]);
  const isOwner = org.ownerId === user.id;

  const handleDelete = useCallback(async () => {
    if (!confirm(`确认删除组织「${org.name}」？此操作不可恢复。`)) return;
    try {
      await orgApi.delete(org.id);
      toast.show('组织已删除', 'success');
      onDeleted();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '删除失败', 'error');
    }
  }, [org, onDeleted, toast]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'members', label: '成员名册' },
    { key: 'depts', label: '部门' },
    { key: 'roles', label: '角色' },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-bold">{org.name}</h2>
          <p className="text-[11px]" style={{ color: 'var(--isl-ink-ghost)' }}>/{org.slug}</p>
        </div>
        {isOwner && (
          <button
            type="button"
            onClick={handleDelete}
            className="isl-icon-btn ml-auto flex h-8 items-center gap-1.5 px-3"
            style={{ background: 'rgba(232,97,90,0.10)', border: '1.5px solid var(--isl-coral)', color: 'var(--isl-coral-deep)' }}
          >
            <Trash2 size={14} />
            <span className="text-xs font-semibold">删除组织</span>
          </button>
        )}
      </div>

      <div className="isl-tabbar">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`isl-tab px-3 py-1.5 text-xs ${tab === t.key ? 'isl-tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin" size={18} style={{ color: 'var(--isl-ink-ghost)' }} />
        </div>
      ) : tab === 'members' ? (
        <MemberRoster org={org} members={members} canInvite={can('member:invite')} canManage={can('member:manage')} onRefresh={refreshMembers} toast={toast} />
      ) : tab === 'depts' ? (
        <DeptPanel org={org} depts={depts} roles={roles} orgMembers={members} canManage={can('dept:manage')} onTreeChanged={refreshTree} onMembersChanged={refreshMembers} toast={toast} />
      ) : (
        <RolePanel org={org} roles={roles} canManage={can('role:manage')} onRefresh={refreshRoles} toast={toast} />
      )}
    </section>
  );
}

// ===== 成员名册 tab（只读 + 增删）=====
function MemberRoster({ org, members, canInvite, canManage, onRefresh, toast }: {
  org: Organization;
  members: DepartmentMember[];
  canInvite: boolean;
  canManage: boolean;
  onRefresh: () => Promise<void>;
  toast: ReturnType<typeof useToast>;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [byUsername, setByUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const add = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await orgApi.addMember(org.id, { byUsername });
      toast.show('成员已添加', 'success');
      setByUsername('');
      setShowAdd(false);
      await onRefresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '添加失败', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [org.id, byUsername, onRefresh, toast]);

  const remove = useCallback(async (userId: string) => {
    if (!confirm('确认移除该成员？将从组织所有部门移除。')) return;
    try {
      await orgApi.removeMember(org.id, userId);
      toast.show('成员已移除', 'success');
      await onRefresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '移除失败', 'error');
    }
  }, [org.id, onRefresh, toast]);

  return (
    <div className="space-y-3">
      {canInvite && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="isl-icon-btn flex h-8 items-center gap-1.5 px-3"
            style={{ background: 'var(--isl-mint-bg)', border: '1.5px solid var(--isl-mint)', color: 'var(--isl-mint-deep)' }}
          >
            <UserPlus size={14} />
            <span className="text-xs font-semibold">添加成员</span>
          </button>
        </div>
      )}

      {showAdd && canInvite && (
        <form onSubmit={add} className="rounded-xl p-4 space-y-2" style={{ background: 'var(--isl-surface)', border: '1.5px solid var(--isl-border)' }}>
          <FormInput value={byUsername} onChange={setByUsername} placeholder="用户名（需已在 Flovart 注册）" autoFocus />
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            style={{ background: 'var(--isl-mint-deep)' }}
          >
            {submitting ? '添加中...' : '添加'}
          </button>
          <p className="text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>新成员默认加入「全体成员」根部门，无特殊角色；可在「部门」tab 分配角色。</p>
        </form>
      )}

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--isl-surface)', border: '1.5px solid var(--isl-border)' }}>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_40px] items-center gap-2 px-4 py-2.5 text-[11px] font-bold uppercase"
          style={{ background: 'var(--isl-surface-2)', color: 'var(--isl-ink-soft)', borderBottom: '1px solid var(--isl-border)' }}>
          <span>用户名</span>
          <span>邮箱</span>
          <span>加入时间</span>
          <span />
        </div>
        {members.length === 0 && (
          <div className="py-8 text-center text-xs" style={{ color: 'var(--isl-ink-ghost)' }}>尚无成员</div>
        )}
        {members.map((m) => (
          <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_40px] items-center gap-2 px-4 py-2.5 text-xs"
            style={{ borderBottom: '1px solid var(--isl-border)' }}>
            <span className="truncate font-semibold" style={{ color: 'var(--isl-ink)' }}>{m.user?.username ?? m.userId}</span>
            <span className="truncate text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>{m.user?.email ?? '—'}</span>
            <span className="truncate text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>{new Date(m.createdAt).toLocaleDateString()}</span>
            <div>
              {canManage && m.userId !== org.ownerId && (
                <button type="button" onClick={() => remove(m.userId)} className="isl-icon-btn h-7 w-7" title="移除成员" aria-label="移除成员">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== 部门 tab（左树右面板）=====
function DeptPanel({ org, depts, roles, orgMembers, canManage, onTreeChanged, onMembersChanged, toast }: {
  org: Organization;
  depts: DeptNode[];
  roles: Role[];
  orgMembers: DepartmentMember[];
  canManage: boolean;
  onTreeChanged: () => Promise<void>;
  onMembersChanged: () => Promise<void>;
  toast: ReturnType<typeof useToast>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deptMembers, setDeptMembers] = useState<DepartmentMember[]>([]);
  const [dmLoading, setDmLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newSlug, setNewSlug] = useState('');
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [addUserId, setAddUserId] = useState('');

  const selected = useMemo(() => (selectedId ? findNode(depts, selectedId) : null), [depts, selectedId]);
  const flat = useMemo(() => flattenDepts(depts), [depts]);
  const candidates = useMemo(
    () => orgMembers.filter((m) => !deptMembers.some((dm) => dm.userId === m.userId)),
    [orgMembers, deptMembers],
  );

  const refreshDeptMembers = useCallback(async () => {
    if (!selectedId) { setDeptMembers([]); return; }
    setDmLoading(true);
    try {
      setDeptMembers((await orgApi.deptMembers(selectedId)) || []);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载部门成员失败', 'error');
    } finally {
      setDmLoading(false);
    }
  }, [selectedId, toast]);

  useEffect(() => { refreshDeptMembers(); }, [refreshDeptMembers]);

  const createDept = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await orgApi.createDept(org.id, { slug: newSlug, name: newName, parentId: newParent || undefined });
      toast.show('部门已创建', 'success');
      setNewSlug(''); setNewName(''); setNewParent(''); setShowCreate(false);
      await onTreeChanged();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '创建失败', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [org.id, newSlug, newName, newParent, onTreeChanged, toast]);

  const deleteDept = useCallback(async (id: string) => {
    if (!confirm('确认删除该部门？需先清空子部门与成员。')) return;
    try {
      await orgApi.deleteDept(id);
      toast.show('部门已删除', 'success');
      if (selectedId === id) setSelectedId(null);
      await onTreeChanged();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '删除失败', 'error');
    }
  }, [selectedId, onTreeChanged, toast]);

  const addDeptMember = useCallback(async () => {
    if (!selectedId || !addUserId) return;
    try {
      await orgApi.addDeptMember(selectedId, { userId: addUserId, roleIds: [] });
      toast.show('成员已加入部门', 'success');
      setAddUserId('');
      await refreshDeptMembers();
      await onMembersChanged();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '添加失败', 'error');
    }
  }, [selectedId, addUserId, refreshDeptMembers, onMembersChanged, toast]);

  const toggleLead = useCallback(async (dm: DepartmentMember) => {
    if (!selectedId) return;
    try {
      await orgApi.updateDeptMember(selectedId, dm.userId, { isLead: !dm.isLead });
      await refreshDeptMembers();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '更新失败', 'error');
    }
  }, [selectedId, refreshDeptMembers, toast]);

  const toggleRole = useCallback(async (dm: DepartmentMember, roleId: string) => {
    if (!selectedId) return;
    const next = dm.roles.includes(roleId) ? dm.roles.filter((r) => r !== roleId) : [...dm.roles, roleId];
    try {
      await orgApi.updateDeptMember(selectedId, dm.userId, { roleIds: next });
      await refreshDeptMembers();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '更新失败', 'error');
    }
  }, [selectedId, refreshDeptMembers, toast]);

  const removeDeptMember = useCallback(async (userId: string) => {
    if (!selectedId || !confirm('确认将该成员移出此部门？')) return;
    try {
      await orgApi.removeDeptMember(selectedId, userId);
      toast.show('成员已移出部门', 'success');
      await refreshDeptMembers();
      await onMembersChanged();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '移除失败', 'error');
    }
  }, [selectedId, refreshDeptMembers, onMembersChanged, toast]);

  const cardStyle = { background: 'var(--isl-surface)', border: '1.5px solid var(--isl-border)' } as const;

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <div className="rounded-xl p-3" style={cardStyle}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-bold">部门树</span>
          {canManage && (
            <button type="button" onClick={() => setShowCreate((v) => !v)} className="isl-icon-btn h-7 w-7" title="新建部门" aria-label="新建部门">
              <Plus size={14} />
            </button>
          )}
        </div>
        {showCreate && canManage && (
          <form onSubmit={createDept} className="mb-3 space-y-2 rounded-lg p-2.5" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
            <FormInput value={newName} onChange={setNewName} placeholder="部门名称" autoFocus />
            <FormInput value={newSlug} onChange={setNewSlug} placeholder="slug（字母数字短横线）" />
            <select value={newParent} onChange={(e) => setNewParent(e.target.value)}
              className="w-full rounded-lg px-3 py-2.5 text-xs"
              style={{ background: 'var(--isl-surface-sunk)', border: '1.5px solid var(--isl-border)', color: 'var(--isl-ink)' }}>
              <option value="">— 顶级部门 —</option>
              {flat.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
            </select>
            <button type="submit" disabled={submitting}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              style={{ background: 'var(--isl-mint-deep)' }}>
              {submitting ? '创建中...' : '创建'}
            </button>
          </form>
        )}
        {depts.length === 0 ? (
          <div className="py-6 text-center text-[11px]" style={{ color: 'var(--isl-ink-ghost)' }}>尚无部门</div>
        ) : (
          <DeptTree nodes={depts} selectedId={selectedId} onSelect={(n) => setSelectedId(n.id)} />
        )}
      </div>

      <div className="rounded-xl p-3" style={cardStyle}>
        {!selected ? (
          <div className="py-10 text-center">
            <Building2 size={24} className="mx-auto mb-2" style={{ color: 'var(--isl-ink-ghost)' }} />
            <p className="text-xs" style={{ color: 'var(--isl-ink-soft)' }}>选择左侧部门查看成员</p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{selected.name}</div>
                <div className="truncate text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>/{selected.slug}</div>
              </div>
              {canManage && !selected.hidden && (
                <button type="button" onClick={() => deleteDept(selected.id)}
                  className="isl-icon-btn flex h-7 items-center gap-1 px-2"
                  style={{ background: 'rgba(232,97,90,0.10)', border: '1px solid var(--isl-coral)', color: 'var(--isl-coral-deep)' }}>
                  <Trash2 size={12} /><span className="text-[10px] font-semibold">删除</span>
                </button>
              )}
            </div>

            {canManage && candidates.length > 0 && (
              <div className="mb-3 flex items-center gap-2">
                <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg px-2.5 py-2 text-xs"
                  style={{ background: 'var(--isl-surface-sunk)', border: '1.5px solid var(--isl-border)', color: 'var(--isl-ink)' }}>
                  <option value="">— 选择成员加入此部门 —</option>
                  {candidates.map((m) => (<option key={m.userId} value={m.userId}>{m.user?.username ?? m.userId}</option>))}
                </select>
                <button type="button" onClick={addDeptMember} disabled={!addUserId}
                  className="rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  style={{ background: 'var(--isl-mint-deep)' }}>
                  加入
                </button>
              </div>
            )}

            {dmLoading ? (
              <div className="flex items-center justify-center py-6"><Loader2 className="animate-spin" size={16} style={{ color: 'var(--isl-ink-ghost)' }} /></div>
            ) : deptMembers.length === 0 ? (
              <div className="py-6 text-center text-[11px]" style={{ color: 'var(--isl-ink-ghost)' }}>该部门尚无成员</div>
            ) : (
              <ul className="space-y-2">
                {deptMembers.map((dm) => (
                  <li key={dm.id} className="rounded-lg p-2.5" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => toggleLead(dm)} className="isl-icon-btn h-6 w-6" title={dm.isLead ? '取消负责人' : '设为负责人'} aria-label="负责人">
                        <Star size={13} style={dm.isLead ? { fill: 'var(--isl-mint-deep)', color: 'var(--isl-mint-deep)' } : { color: 'var(--isl-ink-ghost)' }} />
                      </button>
                      <span className="truncate text-xs font-semibold">{dm.user?.username ?? dm.userId}</span>
                      {dm.isLead && <span className="text-[10px] font-bold" style={{ color: 'var(--isl-mint-deep)' }}>负责人</span>}
                      {canManage && dm.userId !== org.ownerId && (
                        <button type="button" onClick={() => removeDeptMember(dm.userId)} className="isl-icon-btn ml-auto h-6 w-6" title="移出部门" aria-label="移出部门">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                    {roles.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5 pl-8">
                        {roles.map((r) => {
                          const on = dm.roles.includes(r.id);
                          return (
                            <button key={r.id} type="button" onClick={() => canManage && toggleRole(dm, r.id)} disabled={!canManage}
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold disabled:cursor-default"
                              style={on
                                ? { background: 'var(--isl-mint-bg)', color: 'var(--isl-mint-deep)', border: '1px solid var(--isl-mint)' }
                                : { background: 'transparent', color: 'var(--isl-ink-ghost)', border: '1px solid var(--isl-border)' }}>
                              {on && <Check size={9} />}{r.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// 部门树递归渲染
function DeptTree({ nodes, selectedId, onSelect, depth = 0 }: {
  nodes: DeptNode[];
  selectedId: string | null;
  onSelect: (n: DeptNode) => void;
  depth?: number;
}) {
  return (
    <ul className={depth === 0 ? 'space-y-0.5' : 'ml-2.5 mt-0.5 space-y-0.5 border-l pl-2'} style={{ borderColor: 'var(--isl-border)' }}>
      {nodes.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => onSelect(n)}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left"
            style={selectedId === n.id
              ? { background: 'var(--isl-mint-bg)', color: 'var(--isl-mint-deep)' }
              : { color: 'var(--isl-ink)' }}
          >
            <span className="truncate text-xs font-semibold">{n.name}</span>
            <span className="truncate text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>/{n.slug}</span>
          </button>
          {n.children?.length > 0 && <DeptTree nodes={n.children} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

// ===== 角色 tab =====
function RolePanel({ org, roles, canManage, onRefresh, toast }: {
  org: Organization;
  roles: Role[];
  canManage: boolean;
  onRefresh: () => Promise<void>;
  toast: ReturnType<typeof useToast>;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});

  const create = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await orgApi.createRole(org.id, { name });
      toast.show('角色已创建', 'success');
      setName(''); setShowCreate(false);
      await onRefresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '创建失败', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [org.id, name, onRefresh, toast]);

  const saveRole = useCallback(async (r: Role) => {
    const perms = drafts[r.id] ?? r.permissions;
    try {
      await orgApi.updateRole(r.id, { permissions: perms });
      toast.show('角色已保存', 'success');
      setDrafts((d) => { const next = { ...d }; delete next[r.id]; return next; });
      await onRefresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '保存失败', 'error');
    }
  }, [drafts, onRefresh, toast]);

  const remove = useCallback(async (r: Role) => {
    if (!confirm(`确认删除角色「${r.name}」？绑定此角色的成员将失去对应权限。`)) return;
    try {
      await orgApi.deleteRole(r.id);
      toast.show('角色已删除', 'success');
      await onRefresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '删除失败', 'error');
    }
  }, [onRefresh, toast]);

  const togglePerm = (roleId: string, perm: string, current: string[]) => {
    const next = current.includes(perm) ? current.filter((p) => p !== perm) : [...current, perm];
    setDrafts((d) => ({ ...d, [roleId]: next }));
  };

  const cardStyle = { background: 'var(--isl-surface)', border: '1.5px solid var(--isl-border)' } as const;

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setShowCreate((v) => !v)}
            className="isl-icon-btn flex h-8 items-center gap-1.5 px-3"
            style={{ background: 'var(--isl-mint-bg)', border: '1.5px solid var(--isl-mint)', color: 'var(--isl-mint-deep)' }}>
            <Plus size={14} /><span className="text-xs font-semibold">新建角色</span>
          </button>
        </div>
      )}

      {showCreate && canManage && (
        <form onSubmit={create} className="rounded-xl p-4 space-y-2" style={cardStyle}>
          <FormInput value={name} onChange={setName} placeholder="角色名称（同组织内唯一）" autoFocus />
          <button type="submit" disabled={submitting}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            style={{ background: 'var(--isl-mint-deep)' }}>
            {submitting ? '创建中...' : '创建'}
          </button>
        </form>
      )}

      {roles.length === 0 ? (
        <div className="rounded-xl p-10 text-center" style={cardStyle}>
          <Shield size={24} className="mx-auto mb-2" style={{ color: 'var(--isl-ink-ghost)' }} />
          <p className="text-xs" style={{ color: 'var(--isl-ink-soft)' }}>尚无角色</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {roles.map((r) => {
            const working = drafts[r.id] ?? r.permissions;
            const dirty = JSON.stringify(working) !== JSON.stringify(r.permissions);
            const locked = r.isBuiltin || !canManage;
            return (
              <li key={r.id} className="rounded-xl p-4" style={cardStyle}>
                <div className="mb-3 flex items-center gap-2">
                  <Shield size={14} style={{ color: r.isBuiltin ? 'var(--isl-mint-deep)' : 'var(--isl-ink-soft)' }} />
                  <span className="text-sm font-bold">{r.name}</span>
                  {r.isBuiltin && (
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ background: 'var(--isl-mint-bg)', color: 'var(--isl-mint-deep)', border: '1px solid var(--isl-mint)' }}>
                      内置
                    </span>
                  )}
                  {!r.isBuiltin && canManage && (
                    <button type="button" onClick={() => remove(r)}
                      className="isl-icon-btn ml-auto h-7 w-7" title="删除角色" aria-label="删除角色">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {ALL_PERMISSIONS.map((p) => {
                    const on = working.includes(p);
                    return (
                      <label key={p} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]"
                        style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)', color: 'var(--isl-ink)', opacity: locked ? 0.7 : 1 }}>
                        <input type="checkbox" checked={on} disabled={locked}
                          onChange={() => togglePerm(r.id, p, working)}
                          className="h-3 w-3 accent-current" style={{ accentColor: 'var(--isl-mint-deep)' }} />
                        <span className="truncate font-mono">{p}</span>
                      </label>
                    );
                  })}
                </div>
                {!r.isBuiltin && canManage && dirty && (
                  <div className="mt-3 flex justify-end">
                    <button type="button" onClick={() => saveRole(r)}
                      className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                      style={{ background: 'var(--isl-mint-deep)' }}>
                      <Check size={12} />保存
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
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

// ===== 工具 =====
function flattenDepts(nodes: DeptNode[]): DeptNode[] {
  const out: DeptNode[] = [];
  const walk = (ns: DeptNode[]) => { for (const n of ns) { out.push(n); if (n.children?.length) walk(n.children); } };
  walk(nodes);
  return out;
}

function findNode(nodes: DeptNode[], id: string): DeptNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) { const f = findNode(n.children, id); if (f) return f; }
  }
  return null;
}
