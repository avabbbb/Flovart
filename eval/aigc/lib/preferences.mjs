// Preference events ("设为首图") → pairwise samples for eval/judge `pairs`.
//
// The browser records one event per user pick (services/preferenceEvents.ts):
//   { schema, id, time, actor, nodeId, batchId?, mediaType, chosen: {id, type},
//     rejected: [{id, type}], prompt, model }
// Events hold IDs only — never media bodies, URLs or storage keys.
//
// Export rules:
// - Only `actor: "user"` events are preferences (Agent auto-picks are not).
// - Per node, the latest event is the final choice; earlier ones are superseded.
// - Each (chosen, rejected) becomes one pair. Which side is A is decided by a
//   hash of the pair id, so truth is balanced between A and B and the judge's
//   position bias cannot line up with the answer.

import { createHash } from 'node:crypto';

export const PREFERENCE_EVENT_SCHEMA = 'flovart.preference-event/1';

const MEDIA_FIELD = /^(?:href|storageKey|remoteUrl|artifactRef|poster|dataUrl|base64)$/;

/** Reject an event that is malformed or carries anything that looks like media. */
export function preferenceEventErrors(event) {
  const errors = [];
  if (!event || typeof event !== 'object') return ['event must be an object'];
  if (event.schema !== PREFERENCE_EVENT_SCHEMA) errors.push(`schema must be ${PREFERENCE_EVENT_SCHEMA}`);
  for (const field of ['id', 'time', 'nodeId']) if (typeof event[field] !== 'string' || !event[field]) errors.push(`missing ${field}`);
  if (!event.chosen?.id) errors.push('missing chosen.id');
  if (!Array.isArray(event.rejected) || !event.rejected.length) errors.push('rejected must be a non-empty list');
  const text = JSON.stringify(event);
  if (/data:[a-z]+\/[a-z0-9.+-]+;base64,/i.test(text) || /blob:/i.test(text)) errors.push('event must not carry media bodies or object URLs');
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) { if (MEDIA_FIELD.test(key)) errors.push(`event must not carry media field ${key}`); walk(entry); }
  };
  walk(event);
  return errors;
}

/** Keep user events only, the latest per node. */
export function finalChoices(events) {
  const latest = new Map();
  for (const event of events) {
    if (event.actor !== 'user' || preferenceEventErrors(event).length) continue;
    const previous = latest.get(event.nodeId);
    if (!previous || previous.time <= event.time) latest.set(event.nodeId, event);
  }
  return [...latest.values()].sort((a, b) => a.time.localeCompare(b.time));
}

const describe = (side, model) => `${side.type ?? 'media'} 候选 ${side.id}${model ? `（${model}）` : ''}`;
const flip = id => createHash('sha256').update(id).digest()[0] % 2 === 1;

/**
 * Build pairs.jsonl rows and truth.json for `node eval/judge/run.mjs pairs`.
 * Each row carries `refs` (the media variant IDs) so a frame/image extractor can
 * attach the actual media as `images` before a real judge run.
 */
export function exportPreferencePairs(events, { task } = {}) {
  const pairs = [];
  const truth = {};
  for (const event of finalChoices(events)) {
    for (const rejected of event.rejected) {
      if (!rejected?.id || rejected.id === event.chosen.id) continue;
      const id = `${event.id}:${rejected.id}`;
      const chosenFirst = !flip(id);
      const [a, b] = chosenFirst ? [event.chosen, rejected] : [rejected, event.chosen];
      pairs.push({
        id,
        task: task ?? `${event.prompt || '（无提示词）'}${event.model ? `\n模型：${event.model}` : ''}`,
        a: describe(a, event.model),
        b: describe(b, event.model),
        refs: { a: a.id, b: b.id },
        meta: { nodeId: event.nodeId, batchId: event.batchId ?? null, time: event.time, mediaType: event.mediaType ?? null },
      });
      truth[id] = chosenFirst ? 'A' : 'B';
    }
  }
  return { pairs, truth };
}
