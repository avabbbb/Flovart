// 合成 spec V2（docs/design/16-agent-video-pipeline.md C14 / C19 / C20）。
// 纯函数：版本化修订、锁、定向修补范围、diff。Runtime 只保存每一版的完整快照。
//
// spec = {
//   schemaVersion: 2,
//   output: { width, height, fps, durationMs },
//   tracks: {
//     visual:   [{ id, kind: image|video|color, artifactId?, color?, startMs, durationMs, fit?, motion?, label?, locked }],
//     text:     [{ id, text, startMs, durationMs, position: top|center|bottom, size?, locked }],
//     captions: [{ id, lineId?, displayText, startMs, durationMs, locked }],
//     audio:    [{ id, role: voice|music|sfx, artifactId, startMs, durationMs?, gainDb?, duck?, locked }],
//   },
// }
import { canonicalJson } from './store.js';

export const SPEC_SCHEMA_VERSION = 2;
export const TRACKS = Object.freeze(['visual', 'text', 'captions', 'audio']);
const TRACK_SET = new Set(TRACKS);
const VISUAL_KINDS = new Set(['image', 'video', 'color']);
const AUDIO_ROLES = new Set(['voice', 'music', 'sfx']);
const POSITIONS = new Set(['top', 'center', 'bottom']);

export class SpecError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function emptySpec(output = {}) {
  return {
    schemaVersion: SPEC_SCHEMA_VERSION,
    output: {
      width: output.width ?? 1080,
      height: output.height ?? 1920,
      fps: output.fps ?? 30,
      durationMs: output.durationMs ?? 0,
    },
    tracks: { visual: [], text: [], captions: [], audio: [] },
  };
}

const clone = value => JSON.parse(JSON.stringify(value));

export function clipEndMs(clip) {
  return clip.startMs + (clip.durationMs ?? 0);
}

export function findClip(spec, id) {
  for (const track of TRACKS) {
    const index = spec.tracks[track].findIndex(clip => clip.id === id);
    if (index >= 0) return { track, index, clip: spec.tracks[track][index] };
  }
  return null;
}

/** 片段覆盖的时间是否与 [startMs, endMs) 相交。 */
function overlaps(clip, startMs, endMs) {
  const end = clip.durationMs === undefined ? Infinity : clipEndMs(clip);
  return clip.startMs < endMs && end > startMs;
}

/** 评审 finding → 允许修补的片段 ID 集合（显式 clipId，或时间点 / 区间覆盖到的片段）。 */
export function clipsForFindings(spec, findings = []) {
  const ids = new Set();
  for (const finding of findings) {
    for (const id of [finding.clipId, ...(finding.clipIds || [])].filter(Boolean)) ids.add(id);
    let range = null;
    if (Array.isArray(finding.range) && finding.range.length === 2) range = [finding.range[0] * 1000, finding.range[1] * 1000];
    else if (Number.isFinite(finding.atSec)) range = [finding.atSec * 1000, finding.atSec * 1000 + 1];
    if (!range) continue;
    for (const track of TRACKS) {
      if (finding.layer && finding.layer !== track && !(finding.layer === 'voice' && track === 'audio')) continue;
      for (const clip of spec.tracks[track]) if (overlaps(clip, range[0], range[1])) ids.add(clip.id);
    }
  }
  return ids;
}

export function computeDurationMs(spec) {
  let end = 0;
  for (const track of TRACKS) {
    for (const clip of spec.tracks[track]) {
      if (track === 'audio' && clip.role === 'music' && clip.durationMs === undefined) continue;
      end = Math.max(end, clipEndMs(clip));
    }
  }
  return end;
}

export function validateSpec(spec) {
  const errors = [];
  if (spec?.schemaVersion !== SPEC_SCHEMA_VERSION) errors.push('schemaVersion 必须是 2');
  for (const key of ['width', 'height', 'fps']) {
    if (!Number.isFinite(spec?.output?.[key]) || spec.output[key] <= 0) errors.push(`output.${key} 必须是正数`);
  }
  if ((spec?.output?.width ?? 1) % 2 || (spec?.output?.height ?? 1) % 2) errors.push('output 宽高必须是偶数（h264 要求）');
  const ids = new Set();
  for (const track of TRACKS) {
    const clips = spec?.tracks?.[track];
    if (!Array.isArray(clips)) { errors.push(`tracks.${track} 必须是数组`); continue; }
    for (const clip of clips) {
      const label = `${track}/${clip?.id ?? '?'}`;
      if (!clip?.id || typeof clip.id !== 'string') errors.push(`${track}: 片段缺少 id`);
      else if (ids.has(clip.id)) errors.push(`${label}: id 重复`);
      else ids.add(clip.id);
      if (!Number.isFinite(clip?.startMs) || clip.startMs < 0) errors.push(`${label}: startMs 必须是非负数`);
      const needsDuration = track !== 'audio';
      if ((needsDuration || clip?.durationMs !== undefined) && (!Number.isFinite(clip?.durationMs) || clip.durationMs <= 0)) {
        errors.push(`${label}: durationMs 必须是正数`);
      }
      if (typeof clip?.locked !== 'boolean') errors.push(`${label}: locked 必须是布尔值`);
      if (track === 'visual') {
        if (!VISUAL_KINDS.has(clip?.kind)) errors.push(`${label}: kind 只能是 image / video / color`);
        if (clip?.kind !== 'color' && !clip?.artifactId) errors.push(`${label}: 缺少 artifactId`);
      }
      if (track === 'text') {
        if (!clip?.text) errors.push(`${label}: text 不能为空`);
        if (clip?.position && !POSITIONS.has(clip.position)) errors.push(`${label}: position 无效`);
      }
      if (track === 'captions' && !clip?.displayText) errors.push(`${label}: displayText 不能为空`);
      if (track === 'audio') {
        if (!AUDIO_ROLES.has(clip?.role)) errors.push(`${label}: role 只能是 voice / music / sfx`);
        if (!clip?.artifactId) errors.push(`${label}: 缺少 artifactId`);
      }
    }
  }
  return errors;
}

function normalizeClip(track, clip) {
  if (!TRACK_SET.has(track)) throw new SpecError('INVALID_ARGUMENT', `未知轨道：${track}`);
  if (!clip || typeof clip !== 'object') throw new SpecError('INVALID_ARGUMENT', `${track}: clip 必须是对象`);
  const normalized = { ...clip, locked: Boolean(clip.locked) };
  if (track === 'visual') normalized.fit = clip.fit || 'cover';
  if (track === 'text') normalized.position = clip.position || 'center';
  if (track === 'audio') normalized.gainDb = clip.gainDb ?? 0;
  return normalized;
}

/**
 * 把 ops 应用到 base，返回新 spec 与 diff。
 * - 修改 / 删除 locked 片段必须在同一次 patch 里先 { op: 'unlock', id, reason }，解锁会写进 diff 留痕。
 * - scope（Set<clipId>）存在时，只允许动 scope 内的片段，新增片段不受限（修补常需要补一段）。
 */
export function applyPatch(base, ops, { scope = null, lockAfter = [] } = {}) {
  if (!Array.isArray(ops) || ops.length === 0) throw new SpecError('INVALID_ARGUMENT', 'ops 不能为空');
  const spec = clone(base);
  const unlocked = new Map();
  const touched = new Set();
  const outOfScope = [];
  const guard = (id, op) => {
    const found = findClip(spec, id);
    if (!found) throw new SpecError('CLIP_NOT_FOUND', `${op}: 找不到片段 ${id}`, { id });
    if (found.clip.locked && !unlocked.has(id)) {
      throw new SpecError('CLIP_LOCKED', `片段 ${id} 已锁定；需要先在同一次 patch 中 unlock 并写明原因`, { id });
    }
    if (scope && !scope.has(id) && !unlocked.has(id)) outOfScope.push(id);
    touched.add(id);
    return found;
  };

  for (const [index, op] of ops.entries()) {
    switch (op?.op) {
      case 'set_output':
        Object.assign(spec.output, op.output || {});
        touched.add('output');
        break;
      case 'add': {
        const clip = normalizeClip(op.track, op.clip);
        if (findClip(spec, clip.id)) throw new SpecError('INVALID_ARGUMENT', `片段 id 已存在：${clip.id}`);
        spec.tracks[op.track].push(clip);
        touched.add(clip.id);
        break;
      }
      case 'update': {
        const found = guard(op.id, 'update');
        const set = { ...(op.set || {}) };
        delete set.id;
        delete set.locked;
        spec.tracks[found.track][found.index] = { ...found.clip, ...set };
        break;
      }
      case 'remove': {
        const found = guard(op.id, 'remove');
        spec.tracks[found.track].splice(found.index, 1);
        break;
      }
      case 'lock': {
        const found = findClip(spec, op.id);
        if (!found) throw new SpecError('CLIP_NOT_FOUND', `lock: 找不到片段 ${op.id}`);
        found.clip.locked = true;
        break;
      }
      case 'unlock': {
        const found = findClip(spec, op.id);
        if (!found) throw new SpecError('CLIP_NOT_FOUND', `unlock: 找不到片段 ${op.id}`);
        if (!String(op.reason || '').trim()) throw new SpecError('INVALID_ARGUMENT', `unlock ${op.id} 必须写明 reason`);
        found.clip.locked = false;
        unlocked.set(op.id, String(op.reason));
        break;
      }
      default:
        throw new SpecError('INVALID_ARGUMENT', `ops[${index}].op 无效：${String(op?.op)}`);
    }
  }
  if (outOfScope.length) {
    throw new SpecError('PATCH_OUT_OF_SCOPE', `修补超出评审范围：${[...new Set(outOfScope)].join(', ')}；只改 findings 指向的片段`, { clipIds: [...new Set(outOfScope)] });
  }
  for (const id of lockAfter) {
    const found = findClip(spec, id);
    if (!found) throw new SpecError('CLIP_NOT_FOUND', `locks: 找不到片段 ${id}`);
    found.clip.locked = true;
  }
  // 时长默认跟随内容；只有本次 patch 显式 set_output.durationMs 时才固定。
  const pinned = ops.some(op => op?.op === 'set_output' && Number.isFinite(op.output?.durationMs));
  if (!pinned) spec.output.durationMs = computeDurationMs(spec);
  const errors = validateSpec(spec);
  if (errors.length) throw new SpecError('INVALID_SPEC', errors.join('; '), { errors });
  return { spec, diff: { ...diffSpecs(base, spec), unlocked: Object.fromEntries(unlocked) } };
}

export function diffSpecs(before, after) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const track of TRACKS) {
    const left = new Map((before?.tracks?.[track] || []).map(clip => [clip.id, clip]));
    const right = new Map((after?.tracks?.[track] || []).map(clip => [clip.id, clip]));
    for (const [id, clip] of right) {
      if (!left.has(id)) added.push({ track, id });
      else if (canonicalJson(left.get(id)) !== canonicalJson(clip)) {
        const fields = [...new Set([...Object.keys(left.get(id)), ...Object.keys(clip)])]
          .filter(key => canonicalJson(left.get(id)[key]) !== canonicalJson(clip[key]));
        changed.push({ track, id, fields });
      }
    }
    for (const id of left.keys()) if (!right.has(id)) removed.push({ track, id });
  }
  const outputChanged = canonicalJson(before?.output || {}) !== canonicalJson(after?.output || {});
  return { added, removed, changed, outputChanged };
}

/** 锁定片段在两版之间是否逐字节一致（验收 §10.1-4）。 */
export function lockedClipsUnchanged(before, after) {
  const violations = [];
  for (const track of TRACKS) {
    const right = new Map(after.tracks[track].map(clip => [clip.id, clip]));
    for (const clip of before.tracks[track]) {
      if (!clip.locked) continue;
      const next = right.get(clip.id);
      if (!next || canonicalJson(next) !== canonicalJson(clip)) violations.push(clip.id);
    }
  }
  return violations;
}
