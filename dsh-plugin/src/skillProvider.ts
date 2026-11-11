// Bundled-skill provider: exposes the canonical Flovart Skill to DeepSeek Harness.
// Mirrors the pattern used by community plugins (e.g. dsh-guizang-design): the
// package ships a vendored skill tree, registers one provider with a high rank
// (600) so the user's own `~/.dsh/skills` or project skill wins, and adapts
// nothing at runtime — the Skill text is already host-agnostic.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider } from '@deepseek-ai/dsh-skill'

const RANK = 600
const INVOCATION = { modelInvocable: true, userInvocable: true } as const
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function frontmatterField(block: string, key: string): string | undefined {
  const match = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  return match?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2')
}

export interface ParsedSkill {
  name: string
  description: string
  /** Body after the frontmatter block, as DSH expects. */
  content: string
  dir: string
  file: string
}

/** Parse one `<dir>/SKILL.md`; anything without name+description is not a skill. */
export function parseSkillFile(file: string, dir: string): ParsedSkill | null {
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8')
  const front = text.match(FRONTMATTER)
  if (!front) return null
  const block = front[1] ?? ''
  const name = frontmatterField(block, 'name')
  const description = frontmatterField(block, 'description')
  if (!name || !description) return null
  return { name, description, content: text.slice(front[0].length), dir, file }
}

/** Every immediate child directory of `root` that carries a SKILL.md. */
export function readBundledSkills(root: string): ParsedSkill[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => parseSkillFile(join(root, entry.name, 'SKILL.md'), join(root, entry.name)))
    .filter((skill): skill is ParsedSkill => Boolean(skill))
}

function candidate(skill: ParsedSkill): SkillCandidate {
  return {
    name: skill.name,
    description: skill.description,
    path: skill.file,
    invocation: INVOCATION,
    source: 'bundled',
    provider: 'flovart',
    rank: RANK,
    locator: skill.dir,
    resourceBase: { kind: 'directory', path: skill.dir },
  }
}

export function createFlovartSkillProvider(root: string): SkillProvider {
  return {
    name: 'flovart',
    async list(_options: SkillLookupOptions) {
      return readBundledSkills(root).map(candidate)
    },
    async get(skillCandidate: SkillCandidate, _options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
      const dir = typeof skillCandidate.locator === 'string' ? skillCandidate.locator : undefined
      if (!dir) return undefined
      const skill = parseSkillFile(join(dir, 'SKILL.md'), dir)
      if (!skill) return undefined
      const { locator: _locator, rank: _rank, ...defined } = candidate(skill)
      return { ...defined, content: skill.content }
    },
  }
}
