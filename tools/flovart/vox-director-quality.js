#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const FINISH_MARKERS = ['torn', 'halftone', 'newsprint', 'tape', 'grain', 'print', 'xerox', 'riso'];
const SAFE_CAMERA_MOVES = new Set(['static', 'push_in', 'pull_out', 'pan', 'tilt', 'parallax', 'element']);

function addGate(gates, id, passed, weight, details) {
  gates.push({ id, passed, weight, details });
}

function violation(code, message) {
  return { code, message };
}

export function auditVoxProductionSpec(spec = {}) {
  const gates = [];
  const violations = [];
  const extension = spec.extensions?.['community.vox-director']
    || spec.extensions?.['vox-director'];
  const beats = Array.isArray(spec.narrative?.beats) ? spec.narrative.beats : [];
  const shots = beats.flatMap(beat => Array.isArray(beat.shots) ? beat.shots : []);
  const durationMs = Number(spec.delivery?.durationMs || Number(spec.durationSec || 0) * 1000);
  const directives = extension?.shotDirectives || {};

  const extensionPresent = !!extension;
  addGate(gates, 'director-extension', extensionPresent, 25, 'extensions.community.vox-director must preserve the selected Director profile.');
  if (!extensionPresent) violations.push(violation('VOX_EXTENSION_MISSING', 'The ProductionSpec lost extensions.community.vox-director and therefore has no enforceable VOX look.'));

  const themeReady = Array.isArray(extension?.themeCandidates)
    && extension.themeCandidates.length >= 3
    && typeof extension?.selectedTheme === 'string'
    && extension.selectedTheme.length > 0;
  addGate(gates, 'approved-theme', themeReady, 10, 'At least three candidates and one approved theme are required.');
  if (!themeReady) violations.push(violation('STYLE_APPROVAL_MISSING', 'No approved VOX theme with a three-option visual decision exists.'));

  const look = extension?.look || {};
  const finish = Array.isArray(look.finish) ? look.finish.map(value => String(value).toLowerCase()) : [];
  const finishMarkerCount = FINISH_MARKERS.filter(marker => finish.some(value => value.includes(marker))).length;
  const lookReady = /paper|collage|zine|print/i.test(String(look.idiom || ''))
    && Array.isArray(look.palette)
    && look.palette.length >= 3
    && finishMarkerCount >= 4
    && look.constraints === 'strict';
  addGate(gates, 'collage-look', lookReady, 20, 'The look needs a named paper-collage idiom, palette, print finish and strict dimensional lock.');
  if (!lookReady) violations.push(violation('COLLAGE_LOOK_THIN', 'The look does not lock torn paper, halftone/newsprint/tape texture, palette and flat-2D constraints.'));

  const expectedShots = durationMs >= 55_000 ? [10, 12] : durationMs >= 25_000 ? [6, 8] : [4, 6];
  const durationSafe = shots.length > 0 && shots.every(shot => Number(shot.durationMs) > 0 && Number(shot.durationMs) <= 7_000);
  const twoShotCoverage = beats.length > 0 && beats.every(beat => Array.isArray(beat.shots) && beat.shots.length >= 2);
  const cadenceReady = shots.length >= expectedShots[0] && shots.length <= expectedShots[1] && durationSafe && twoShotCoverage;
  addGate(gates, 'shot-cadence', cadenceReady, 15, `${Math.round(durationMs / 1000)}s requires ${expectedShots[0]}-${expectedShots[1]} shots, two-shot beats and no shot over 7s.`);
  if (!cadenceReady) violations.push(violation('CADENCE_TOO_FLAT', 'The plan lacks VOX wide/detail coverage or holds a shot too long.'));

  const directiveList = shots.map(shot => directives[shot.id]);
  const directivesComplete = shots.length > 0 && directiveList.every(directive => (
    directive
    && SAFE_CAMERA_MOVES.has(directive.cameraMove)
    && typeof directive.shotSize === 'string'
    && typeof directive.elementMotion === 'string'
    && directive.elementMotion.trim().length >= 8
  ));
  const cameraMoves = directiveList.map(directive => directive?.cameraMove).filter(Boolean);
  const adjacentMovesVary = cameraMoves.every((move, index) => index === 0 || move !== cameraMoves[index - 1]);
  const motionReady = directivesComplete && adjacentMovesVary;
  addGate(gates, 'shot-direction', motionReady, 15, 'Every shot needs size, flat-safe camera motion, rich element motion and adjacent variation.');
  if (!motionReady) violations.push(violation('SHOT_DIRECTION_WEAK', 'Shot directives are missing, unsafe, or repeat the same camera move on adjacent shots.'));

  const gateTypes = new Set((Array.isArray(spec.gates) ? spec.gates : []).map(gate => gate.type));
  const reviewReady = ['spec', 'style-reference', 'keyframe-review', 'ocr'].every(type => gateTypes.has(type));
  addGate(gates, 'review-gates', reviewReady, 10, 'Spec, style, keyframe and OCR gates must exist before paid motion generation.');
  if (!reviewReady) {
    violations.push(violation('KEYFRAME_GATE_MISSING', 'The plan can reach paid motion generation without approved style, keyframe review and OCR checks.'));
  }

  const audioReady = !!spec.audio?.narration?.voiceProfile
    && !!spec.audio?.music?.intent
    && spec.audio?.music?.duckUnderNarration === true;
  addGate(gates, 'audio-design', audioReady, 5, 'VOX delivery needs one voice profile plus ducked editorial music/ambience.');
  if (!audioReady) violations.push(violation('AUDIO_DESIGN_MISSING', 'Narration and ducked editorial sound design are not both specified.'));

  const score = gates.reduce((total, gate) => total + (gate.passed ? gate.weight : 0), 0);
  return {
    profile: 'vox-collage',
    passed: score >= 85 && violations.length === 0,
    score,
    minimumScore: 85,
    metrics: {
      durationSec: Math.round(durationMs / 1000),
      beatCount: beats.length,
      shotCount: shots.length,
      directedShotCount: directiveList.filter(Boolean).length,
      finishMarkerCount,
    },
    gates,
    violations,
  };
}

async function runCli() {
  const args = process.argv.slice(2);
  const specIndex = args.indexOf('--spec');
  if (specIndex < 0 || !args[specIndex + 1]) {
    throw new Error('Usage: node vox-director-quality.js --spec <production-spec.json> [--json]');
  }
  const spec = JSON.parse(await readFile(args[specIndex + 1], 'utf8'));
  const result = auditVoxProductionSpec(spec);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
