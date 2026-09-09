import { importFlovartModule } from './flovart-modules.js';

const { discoverAgentHosts } = await importFlovartModule('host-discovery');
const { getAgentIdentity, getDistributionTarget } = await importFlovartModule('host-registry');
const { initCliHost } = await importFlovartModule('agent-kit');

function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function projectionTarget(identity) {
  const targets = identity.distributionTargets
    .map(id => getDistributionTarget(id))
    .filter(Boolean);
  return targets.find(target => target.kind === 'skill' && target.status === 'supported' && target.id !== 'project-skill')
    || targets.find(target => target.kind === 'skill' && target.status === 'supported')
    || null;
}

export function prepareAgentHostProjection(input = {}) {
  const identityId = String(input.agentIdentity || input.host || '').trim().toLowerCase();
  const identity = getAgentIdentity(identityId);
  if (!identity) return failure('UNKNOWN_AGENT_HOST', '未识别的 Agent Host。', { agentIdentity: identityId || null });

  const discovery = (input.discover || (() => discoverAgentHosts({ includeVersion: false })))();
  const host = discovery.agents?.find(item => item.id === identity.id);
  if (!host?.available && identity.status !== 'manual-import') return failure('HOST_UNAVAILABLE', `${identity.label} 当前未在本机就绪。`, { agentIdentity: identity.id });

  if (identity.status === 'manual-import') return {
    ok: true,
    agentIdentity: { id: identity.id, label: identity.label },
    distributionTarget: { id: 'workbuddy-skill', label: 'WorkBuddy 技能包', kind: 'skill' },
    projection: { status: 'external', skillReady: false, bootstrapReady: false, message: '在 WorkBuddy 的技能页导入下载的 Flovart 技能包，再发送连接指令。' },
  };

  const target = projectionTarget(identity);
  if (!target) {
    return {
      ok: true,
      agentIdentity: { id: identity.id, label: identity.label },
      distributionTarget: { id: identity.distributionTargets[0] || null, label: '外部插件', kind: 'plugin' },
      projection: { status: 'external', skillReady: false, bootstrapReady: false, message: `${identity.label} 由其 Plugin/Profile 管理。` },
    };
  }

  const installed = initCliHost({ target: target.id, projectDir: input.projectDir });
  if (!installed.ok) return failure('PROJECTION_FAILED', `${identity.label} 的 Flovart Skill 暂时无法准备。`, { agentIdentity: identity.id, distributionTarget: target.id });
  return {
    ok: true,
    agentIdentity: { id: identity.id, label: identity.label },
    distributionTarget: { id: target.id, label: target.label, kind: target.kind },
    projection: { status: 'ready', skillReady: true, bootstrapReady: true, message: `${identity.label} 的 Flovart Skill 已准备。` },
  };
}
