import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFlovartSkillProvider, parseSkillFile, readBundledSkills } from '../src/skillProvider.ts'

function skillDir(name: string, frontmatter: string, body = 'body text\n') {
  const root = mkdtempSync(join(tmpdir(), 'flovart-skill-'))
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}`)
  return { root, dir }
}

test('parses name, description, and strips the frontmatter from the body', () => {
  const { root, dir } = skillDir('flovart', 'name: flovart\ndescription: Work the visible canvas', '# Title\n')
  const parsed = parseSkillFile(join(dir, 'SKILL.md'), dir)
  assert.equal(parsed?.name, 'flovart')
  assert.equal(parsed?.description, 'Work the visible canvas')
  assert.equal(parsed?.content.trim(), '# Title')
  assert.equal(readBundledSkills(root).length, 1)
  rmSync(root, { recursive: true, force: true })
})

test('skips directories without a usable SKILL.md and hidden directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'flovart-skill-'))
  mkdirSync(join(root, 'empty'), { recursive: true })
  mkdirSync(join(root, '.hidden'), { recursive: true })
  writeFileSync(join(root, '.hidden', 'SKILL.md'), '---\nname: hidden\ndescription: no\n---\n')
  mkdirSync(join(root, 'broken'), { recursive: true })
  writeFileSync(join(root, 'broken', 'SKILL.md'), 'no frontmatter')
  assert.deepEqual(readBundledSkills(root), [])
  rmSync(root, { recursive: true, force: true })
})

test('lists with rank 600 and a directory resource base, then loads the body', async () => {
  const { root } = skillDir('flovart', 'name: flovart\ndescription: Canvas work')
  const provider = createFlovartSkillProvider(root)
  const list = await provider.list({})
  assert.equal(list.length, 1)
  assert.deepEqual(list[0], {
    name: 'flovart',
    description: 'Canvas work',
    path: join(root, 'flovart', 'SKILL.md'),
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    provider: 'flovart',
    rank: 600,
    locator: join(root, 'flovart'),
    resourceBase: { kind: 'directory', path: join(root, 'flovart') },
  })

  const loaded = await provider.get(list[0], {})
  assert.equal(loaded?.content.trim(), 'body text')
  assert.equal(loaded?.name, 'flovart')
  rmSync(root, { recursive: true, force: true })
})

test('returns undefined when the candidate locator no longer resolves', async () => {
  const provider = createFlovartSkillProvider(join(tmpdir(), 'flovart-skill-missing'))
  assert.deepEqual(await provider.list({}), [])
  assert.equal(await provider.get({ name: 'flovart', description: 'x', invocation: { modelInvocable: true, userInvocable: true }, source: 'bundled', provider: 'flovart', rank: 600, locator: join(tmpdir(), 'nope') }, {}), undefined)
})
