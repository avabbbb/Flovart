// AIGC item / take / rating loading and semantic checks.
//
// Shape is checked by the JSON Schemas (lib/schema.mjs); this module adds the
// rules a schema cannot express: what each domain must bring as condition
// assets, consent for real people, data hygiene (a TTS reference clip is never
// the target clip), referential integrity, and the 1–3 scale of multimodal task
// following.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateItemShape, validateRatingShape, validateTakeShape } from './schema.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const AIGC_DIR = join(here, '..');
export const ITEMS_DIR = join(AIGC_DIR, 'items');
export const RUBRICS_DIR = join(AIGC_DIR, '..', 'judge', 'rubrics');

export const DOMAINS = ['t2i', 'i2i-edit', 't2v', 'i2v', 'flf2v', 'r2v', 'v-edit', 'v-extend', 'digital-human', 'tts', 'agent-run'];
export const SCENARIOS = ['ad', 'fiction', 'pgc', 'consumer-effects', 'social', 'basic'];
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const SPLITS = ['dev', 'test', 'holdout'];
export const VIDEO_DOMAINS = new Set(['t2v', 'i2v', 'flf2v', 'r2v', 'v-edit', 'v-extend', 'digital-human']);

/** Condition roles each domain needs. Each inner list is "at least one of". */
const REQUIRED_ROLES = {
  'i2i-edit': [['ref_image']],
  i2v: [['first_frame']],
  flf2v: [['first_frame'], ['last_frame']],
  r2v: [['ref_image', 'ref_video', 'ref_audio', 'face_ref']],
  'v-edit': [['ref_video']],
  'v-extend': [['ref_video']],
  'digital-human': [['face_ref']],
};
/** Roles that depict or voice a real person: only consented or synthetic material. */
const PERSON_ROLES = ['face_ref', 'ref_audio'];
const PERSON_OK = new Set(['person-consent', 'synthetic', 'owned']);

export function readJsonl(path) {
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`${path}:${index + 1}: ${error.message}`); }
  });
}

export function loadItems(dir = ITEMS_DIR) {
  return readdirSync(dir).filter(name => name.endsWith('.json')).sort()
    .map(name => ({ ...JSON.parse(readFileSync(join(dir, name), 'utf8')), __file: name }));
}

const strip = ({ __file, ...rest }) => rest;
const sameClip = (a, b) => (a.sha256 && b.sha256 && a.sha256 === b.sha256) || a.uri === b.uri;

/** Semantic checks for one item (after the shape check). */
export function itemSemanticErrors(item, { rubricIds } = {}) {
  const errors = [];
  const at = `item(${item.id})`;
  const assets = item.assets ?? {};
  for (const anyOf of REQUIRED_ROLES[item.domain] ?? []) {
    if (!anyOf.some(role => assets[role]?.length)) errors.push(`${at}: domain ${item.domain} needs assets.${anyOf.join(' | assets.')}`);
  }
  if (item.domain === 'tts' && !item.constraints?.textToSpeak) errors.push(`${at}: tts needs constraints.textToSpeak`);
  if (item.domain === 'digital-human' && !assets.ref_audio?.length && !item.constraints?.textToSpeak) {
    errors.push(`${at}: digital-human needs assets.ref_audio or constraints.textToSpeak`);
  }
  for (const role of PERSON_ROLES) {
    for (const asset of assets[role] ?? []) {
      if (!PERSON_OK.has(asset.consent.kind)) errors.push(`${at}: assets.${role} ${asset.uri} needs consent person-consent, synthetic or owned (got ${asset.consent.kind})`);
      if (asset.consent.kind === 'person-consent' && !asset.consent.ref) errors.push(`${at}: assets.${role} ${asset.uri} person-consent needs consent.ref`);
    }
  }
  for (const ref of assets.ref_audio ?? []) {
    for (const truth of assets.ground_truth ?? []) {
      if (sameClip(ref, truth)) errors.push(`${at}: ref_audio and ground_truth are the same clip (${ref.uri}); the reference must differ from the target`);
    }
  }
  if (item.constraints?.audio?.required && !VIDEO_DOMAINS.has(item.domain) && item.domain !== 'tts') {
    errors.push(`${at}: constraints.audio only applies to video or tts domains`);
  }
  const checkIds = new Set();
  for (const check of item.checks ?? []) {
    if (checkIds.has(check.id)) errors.push(`${at}: duplicate check id ${check.id}`);
    checkIds.add(check.id);
  }
  for (const check of item.checks ?? []) {
    if (check.parent && !checkIds.has(check.parent)) errors.push(`${at}: check ${check.id} parent ${check.parent} does not exist`);
    if (check.type === 'rule' && !check.grader) errors.push(`${at}: rule check ${check.id} needs grader`);
    if (check.type === 'ocr-match' && !check.target) errors.push(`${at}: ocr-match check ${check.id} needs target`);
  }
  if (rubricIds) for (const id of item.rubrics) if (!rubricIds.has(id)) errors.push(`${at}: rubric ${id} does not exist in eval/judge/rubrics`);
  if (item.status && item.status !== 'active' && !item.statusReason) errors.push(`${at}: status ${item.status} needs statusReason`);
  return errors;
}

export function rubricIdsOnDisk(dir = RUBRICS_DIR) {
  return new Set(existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith('.md')).map(name => name.slice(0, -3)) : []);
}

/** Validate a full dataset. Returns { errors, items }. */
export function validateDataset({ items, takes = [], ratings = [], rubricIds = rubricIdsOnDisk() }) {
  const errors = [];
  const byId = new Map();
  for (const raw of items) {
    const item = strip(raw);
    const shape = validateItemShape(item);
    errors.push(...shape.map(error => (raw.__file ? `${raw.__file}: ${error}` : error)));
    if (!shape.length) errors.push(...itemSemanticErrors(item, { rubricIds }));
    if (raw.__file && raw.__file !== `${item.id}.json`) errors.push(`${raw.__file}: file name must be ${item.id}.json`);
    if (byId.has(item.id)) errors.push(`duplicate item id ${item.id}`);
    byId.set(item.id, item);
  }
  const takeIds = new Map();
  for (const take of takes) {
    errors.push(...validateTakeShape(take));
    if (!byId.has(take.itemId)) errors.push(`take(${take.takeId}): unknown item ${take.itemId}`);
    if (takeIds.has(take.takeId)) errors.push(`duplicate take id ${take.takeId}`);
    takeIds.set(take.takeId, take);
  }
  for (const take of takes) {
    if (take.alternatesOf && !takeIds.has(take.alternatesOf)) errors.push(`take(${take.takeId}): alternatesOf ${take.alternatesOf} is not a known take`);
  }
  for (const rating of ratings) {
    errors.push(...validateRatingShape(rating));
    if (rating.dim === 'taskFollowing' && rating.score > 3) errors.push(`rating(${rating.takeId}/taskFollowing): multimodal task following is scored 1–3`);
    const take = takeIds.get(rating.takeId);
    if (takes.length && !take) errors.push(`rating(${rating.takeId}): unknown take`);
    else if (take && take.itemId !== rating.itemId) errors.push(`rating(${rating.takeId}): itemId ${rating.itemId} does not match take item ${take.itemId}`);
  }
  return { errors, items: [...byId.values()] };
}

/** Items that count toward rates: active and in one of the requested splits. */
export function countedItems(items, { splits = ['dev', 'test'] } = {}) {
  return items.filter(item => (item.status ?? 'active') === 'active' && splits.includes(item.split));
}
