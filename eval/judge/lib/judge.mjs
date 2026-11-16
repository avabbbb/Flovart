// Pointwise judging of cleaned samples against one rubric.

import { compileJudgePrompt, renderSampleMessage, rubricKey } from './rubric.mjs';
import { parseJudgeOutput } from './parse.mjs';
import { aggregateSample } from './funnel.mjs';

export async function judgeSample(rubric, sample, provider, { round = 0, seed } = {}) {
  const system = compileJudgePrompt(rubric);
  const user = renderSampleMessage(rubric, sample);
  const key = round ? `${sample.id}#r${round}` : sample.id;
  let output;
  try {
    output = await provider.complete({ key, system, user, images: sample.images, seed });
  } catch (error) {
    return { id: sample.id, rubric: rubricKey(rubric), round, providerError: String(error.message ?? error) };
  }
  const parsed = parseJudgeOutput(rubric, output.text);
  if (!parsed.ok) {
    return { id: sample.id, rubric: rubricKey(rubric), round, parseError: parsed.error, raw: output.text };
  }
  return {
    id: sample.id,
    rubric: rubricKey(rubric),
    round,
    slice: sample.slice,
    dataset: sample.dataset,
    verdicts: parsed.verdicts,
    aggregate: aggregateSample(rubric, parsed.verdicts),
    usage: output.usage,
  };
}

/**
 * Multi-round judging. A sample's verdict is trusted only when all rounds
 * agree; disagreement is reported as unstable instead of majority-voted,
 * because a stable wrong judge is the dangerous case and a flip is a signal.
 */
export async function judgeWithRounds(rubric, sample, provider, rounds = 1) {
  const results = [];
  for (let round = 0; round < rounds; round += 1) {
    results.push(await judgeSample(rubric, sample, provider, { round, seed: round }));
  }
  if (rounds === 1) return results[0];
  const usable = results.filter(result => result.aggregate);
  const verdicts = new Set(usable.map(result => JSON.stringify(result.aggregate.verdict)));
  const stable = usable.length === rounds && verdicts.size === 1;
  return { ...usable[0] ?? results[0], rounds: results, stable };
}
