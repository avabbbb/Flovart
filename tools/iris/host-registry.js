import registryDocument from './contracts/host-registry.v1.json' with { type: 'json' };

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}

const registry = freezeDeep(registryDocument);
const agentIdentities = new Map(registry.agentIdentities.map(identity => [identity.id, identity]));
const distributionTargets = new Map(registry.distributionTargets.map(target => [target.id, target]));
const distributionTargetAliases = new Map(Object.entries(registry.distributionTargetAliases || {}));

export function getHostRegistry() {
  return registry;
}

export function getAgentIdentity(id) {
  return agentIdentities.get(String(id || '').trim()) || null;
}

export function listAgentIdentities() {
  return [...registry.agentIdentities];
}

export function getDistributionTarget(id) {
  const requested = String(id || '').trim().toLowerCase();
  return distributionTargets.get(distributionTargetAliases.get(requested) || requested) || null;
}

export function resolveDistributionTargetId(id) {
  const requested = String(id || '').trim().toLowerCase();
  return distributionTargetAliases.get(requested) || requested;
}

export function listDistributionTargets() {
  return [...registry.distributionTargets];
}

