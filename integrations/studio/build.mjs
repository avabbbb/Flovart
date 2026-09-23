import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const output = resolve(root, '..', '..', 'dist-studio');
if (!output.startsWith(`${resolve(root, '..', '..')}${sep}`)) throw new Error('Studio output escaped the workspace');

const packages = [
  { id: 'photoshop', host: 'PS', manifestVersion: 4, required: ['manifest.json', 'index.html', 'index.js', 'panel.css'] },
  { id: 'premiere', host: 'premierepro', manifestVersion: 5, required: ['manifest.json', 'index.html', 'index.js', 'panel.css'] },
  { id: 'after-effects', host: 'AEFT', runtime: 'CEP', required: ['manifest.json', 'CSXS/manifest.xml', 'index.html', 'index.js', 'panel.css', 'cep-bridge.js', 'host.jsx'],
    effect: {
      dir: 'effect',
      required: ['FlovartEffect.cpp', 'FlovartEffect.r', 'asset-manifest.json'],
      entryPoint: 'EffectMain',
      params: ['Asset Version', 'Blend'],
    }},
  { id: 'resolve', host: 'resolve-studio', runtime: 'resolve-workflow-integration', required: ['manifest.json', 'manifest.xml', 'package.json', 'main.js', 'canvas-url.js', 'preload.js', 'index.html', 'index.js', 'panel.css'] },
];

function assert(condition, message) {
  if (!condition) throw new Error(`[studio] ${message}`);
}

if (existsSync(output)) rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const spec of packages) {
  const source = join(root, spec.id);
  const target = join(output, spec.id);
  const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
  if (spec.manifestVersion) assert(manifest.manifestVersion === spec.manifestVersion, `${spec.id} manifest version mismatch`);
  if (spec.id === 'photoshop' || spec.id === 'premiere') {
    assert(manifest.host?.[0]?.app === spec.host, `${spec.id} host declaration mismatch`);
    assert(manifest.main === 'index.html', `${spec.id} must load its persistent panel HTML`);
  } else {
    assert(manifest.host === spec.host, `${spec.id} host declaration mismatch`);
    assert(manifest.runtime === spec.runtime, `${spec.id} runtime declaration mismatch`);
  }
  for (const file of spec.required) assert(existsSync(join(source, file)), `${spec.id}/${file} missing`);
  if (spec.id === 'after-effects') {
    const cepManifest = readFileSync(join(source, 'CSXS', 'manifest.xml'), 'utf8');
    assert(cepManifest.includes(`<Host Name="${spec.host}"`), `${spec.id} CEP host declaration mismatch`);
    assert(cepManifest.includes('<Type>Panel</Type>'), `${spec.id} must declare a CEP panel`);
  }
  if (spec.id === 'resolve') {
    const resolveManifest = readFileSync(join(source, 'manifest.xml'), 'utf8');
    assert(resolveManifest.includes('<Id>com.flovart.studio.resolve</Id>'), spec.id + ' manifest id mismatch');
    assert(resolveManifest.includes('<FilePath>main.js</FilePath>'), spec.id + ' must load main.js');
  }
  cpSync(source, target, { recursive: true });
  cpSync(join(root, 'shared'), join(target, 'shared'), { recursive: true });
  if (spec.id === 'resolve') {
    const candidates = [
      process.env.FLOVART_RESOLVE_WORKFLOW_NODE,
      'C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Workflow Integrations\\Examples\\SamplePlugin\\WorkflowIntegration.node',
      '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node',
    ].filter(Boolean);
    const nativeModule = candidates.find(candidate => existsSync(candidate));
    if (nativeModule) cpSync(nativeModule, join(target, 'WorkflowIntegration.node'));
    else console.warn('[studio] Resolve WorkflowIntegration.node 未找到；设置 FLOVART_RESOLVE_WORKFLOW_NODE 后重新构建可生成可运行包。');
  }
  const sourceText = readFileSync(join(source, 'index.js'), 'utf8');
  assert(!/(?:api.?key|provider.?key|secret|token)/i.test(sourceText), `${spec.id} panel contains a credential-shaped implementation`);
  assert(readFileSync(join(source, 'index.html'), 'utf8').includes('shared/inspector.js'), `${spec.id} does not use shared Studio UI`);
  if (spec.effect) buildEffect(spec, source, target);
}

function buildEffect(spec, source, target) {
  const effect = spec.effect;
  const effectSrc = join(source, effect.dir);
  for (const file of effect.required) assert(existsSync(join(effectSrc, file)), `${spec.id}/${effect.dir}/${file} missing`);

  const manifest = JSON.parse(readFileSync(join(effectSrc, 'asset-manifest.json'), 'utf8'));
  assert(manifest.effect?.entryPoint === effect.entryPoint, `${spec.id} effect entry point mismatch`);
  const names = (manifest.parameters ?? []).map(p => p.name);
  for (const name of effect.params) assert(names.includes(name), `${spec.id} effect manifest missing param "${name}"`);

  const sdk = process.env.FLOVART_AE_SDK_ROOT;
  const compiler = process.env.FLOVART_AE_EFFECT_CL || 'cl';
  if (sdk && existsSync(sdk)) {
    const probe = spawnSync(compiler, ['/nologo'], { stdio: 'pipe' });
    if (probe.error || probe.status === null) {
      console.warn(`[studio] AE SDK present but "${compiler}" unavailable; emitting needs-native-sdk effect source package.`);
    } else {
      console.warn('[studio] AE Effect SDK toolchain detected; real compile is a real-host gate (see NATIVE_EFFECT.md). Emitting source package.');
    }
  } else {
    console.warn(`[studio] AE Effect SDK not found (set FLOVART_AE_SDK_ROOT); emitting needs-native-sdk effect source package.`);
  }
  manifest.effect.buildStatus = 'needs-native-sdk';

  const effectTarget = join(target, effect.dir);
  mkdirSync(effectTarget, { recursive: true });
  cpSync(effectSrc, effectTarget, { recursive: true });
  writeFileSync(join(effectTarget, 'asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

console.log(`[studio] built ${packages.length} host packages at ${output}`);
