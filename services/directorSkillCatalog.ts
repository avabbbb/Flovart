import { parse } from 'yaml';
import { z } from 'zod';

import exampleSpec from '../.agents/skills/vox-director/examples/production-spec.json';
import manifestSource from '../.agents/skills/vox-director/flovart.skill.yaml?raw';
import openaiSource from '../.agents/skills/vox-director/agents/openai.yaml?raw';
import skillSource from '../.agents/skills/vox-director/SKILL.md?raw';

const permissionSchema = z.object({
  network: z.literal('none'),
  secrets: z.literal('none'),
  filesystem: z.literal('package-readonly'),
}).strict();

const manifestSchema = z.object({
  schemaVersion: z.literal('flovart.director-skill/1'),
  id: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  productionSpec: z.object({
    coreVersion: z.literal('1'),
    extensionSchema: z.string().min(1),
  }).strict(),
  runtime: z.object({
    minVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  }).strict(),
  capabilities: z.array(z.string().min(1)).min(1),
  permissions: permissionSchema,
  gates: z.array(z.object({
    id: z.string().min(1),
    type: z.string().min(1),
  }).strict()).min(1),
  evals: z.object({ entry: z.string().min(1) }).strict(),
  license: z.string().min(1),
  provenance: z.object({
    source: z.string().url(),
    adaptation: z.literal('flovart-provider-neutral-example'),
  }).strict(),
  trustTier: z.literal('bundled-example'),
}).strict();

const openaiMetadataSchema = z.object({
  interface: z.object({
    display_name: z.string().min(1),
    short_description: z.string().min(25).max(64),
    default_prompt: z.string().includes('$vox-director'),
  }).strict(),
}).strict();

export interface BundledDirectorSkill {
  id: string;
  version: string;
  displayName: string;
  description: string;
  defaultPrompt: string;
  trustTier: 'bundled-example';
  license: string;
  sourceUrl: string;
  runtimeMinVersion: string;
  capabilities: readonly string[];
  gates: readonly { id: string; type: string }[];
  permissions: {
    network: 'none';
    secrets: 'none';
    filesystem: 'package-readonly';
  };
  skillSource: string;
  exampleSpec: Record<string, unknown>;
}

const manifest = manifestSchema.parse(parse(manifestSource));
const metadata = openaiMetadataSchema.parse(parse(openaiSource)).interface;
const bundledSkills: readonly BundledDirectorSkill[] = Object.freeze([Object.freeze({
  id: manifest.id,
  version: manifest.version,
  displayName: metadata.display_name,
  description: metadata.short_description,
  defaultPrompt: metadata.default_prompt,
  trustTier: manifest.trustTier,
  license: manifest.license,
  sourceUrl: manifest.provenance.source,
  runtimeMinVersion: manifest.runtime.minVersion,
  capabilities: Object.freeze([...manifest.capabilities]),
  gates: Object.freeze(manifest.gates.map(gate => Object.freeze({ ...gate }))),
  permissions: Object.freeze({ ...manifest.permissions }),
  skillSource,
  exampleSpec,
})]);

export function listBundledDirectorSkills(): readonly BundledDirectorSkill[] {
  return bundledSkills;
}

export function getBundledDirectorSkill(id: string): BundledDirectorSkill | null {
  return bundledSkills.find(skill => skill.id === id) || null;
}
