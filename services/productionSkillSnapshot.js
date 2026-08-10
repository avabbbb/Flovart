export const PRODUCTION_SKILL_SNAPSHOT_PATHS = Object.freeze([
  'SKILL.md',
  'agents/openai.yaml',
  'evals/cases.json',
  'examples/production-spec.json',
  'flovart.skill.yaml',
  'references/creative-direction.md',
  'schemas/extension.schema.json',
]);

export function canonicalProductionSkillSnapshot(entries) {
  return JSON.stringify([...entries]
    .map(entry => ({ path: String(entry.path), content: String(entry.content) }))
    .sort((left, right) => left.path.localeCompare(right.path)));
}

export async function hashProductionSkillSnapshot(entries) {
  const bytes = new TextEncoder().encode(canonicalProductionSkillSnapshot(entries));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
