#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseDocument } from 'yaml';

import { REPOSITORY_ROOT } from './release-config.mjs';

const workflows = ['ci.yml', 'release.yml', 'pages.yml'];
const parsedWorkflows = new Map();
const publicGodotVerificationScripts = Object.freeze({
  'world-visual-placement:godot:verify':
    'scripts/verify-world-visual-placement-applier-godot.ps1',
  'world-art-overlay:v1-1:godot:verify':
    'scripts/verify-world-art-runtime-overlay-v1-1-godot.ps1',
  'world-art-overlay:v1-1:combined:godot:verify':
    'scripts/verify-world-art-runtime-overlay-v1-1-combined-godot.ps1',
  'world-art-overlay:v1-1:capture:godot:verify':
    'scripts/verify-world-art-runtime-overlay-v1-1-capture-godot.ps1',
});

try {
  for (const name of workflows) {
    const path = join(REPOSITORY_ROOT, '.github', 'workflows', name);
    const source = await readFile(path, 'utf8');
    const document = parseDocument(source, { prettyErrors: true, strict: true, uniqueKeys: true });
    if (document.errors.length > 0) throw new Error(`${name}: ${document.errors.map(String).join('\n')}`);
    const workflow = document.toJS();
    if (!workflow || typeof workflow !== 'object' || typeof workflow.name !== 'string' || !workflow.jobs) {
      throw new Error(`${name}: workflow must declare a name and jobs object.`);
    }
    parsedWorkflows.set(name, workflow);
  }

  const packageJson = JSON.parse(
    await readFile(join(REPOSITORY_ROOT, 'package.json'), 'utf8'),
  );
  for (const [name, scriptPath] of Object.entries(publicGodotVerificationScripts)) {
    const expected =
      `powershell -NoProfile -ExecutionPolicy Bypass -File ${scriptPath}`;
    if (packageJson.scripts?.[name] !== expected) {
      throw new Error(`package.json: missing exact public Godot script ${name}.`);
    }
    await readFile(join(REPOSITORY_ROOT, scriptPath));
  }

  const windowsJob =
    parsedWorkflows.get('ci.yml')?.jobs?.['godot-windows-smoke'];
  const linuxJob =
    parsedWorkflows.get('ci.yml')?.jobs?.['godot-smoke'];
  const windowsVersions = new Set(
    windowsJob?.strategy?.matrix?.include?.map(({ version }) => version) ?? [],
  );
  if (
    windowsVersions.size !== 2
    || !windowsVersions.has('4.3')
    || !windowsVersions.has('4.7')
  ) {
    throw new Error(
      'ci.yml: public Godot verification requires the exact 4.3/4.7 Windows matrix.',
    );
  }
  const windowsRuns = (windowsJob?.steps ?? [])
    .map(({ run }) => typeof run === 'string' ? run : '')
    .join('\n');
  for (const scriptPath of Object.values(publicGodotVerificationScripts)) {
    if (!windowsRuns.includes(scriptPath)) {
      throw new Error(`ci.yml: Windows Godot job does not run ${scriptPath}.`);
    }
  }
  for (const legacyScript of [
    'scripts/verify-world-art-runtime-overlay-capture-godot.ps1',
    'res://tests/world_art_runtime_overlay_smoke.gd',
    'res://tests/world_art_runtime_overlay_applier_smoke.gd',
  ]) {
    if (!windowsRuns.includes(legacyScript)) {
      throw new Error(`ci.yml: existing 1.0 verification is missing ${legacyScript}.`);
    }
  }
  const linuxVersions = new Set(
    linuxJob?.strategy?.matrix?.include?.map(({ version }) => version) ?? [],
  );
  if (
    linuxVersions.size !== 2
    || !linuxVersions.has('4.3')
    || !linuxVersions.has('4.7')
  ) {
    throw new Error(
      'ci.yml: runtime-candidate E2E requires the exact 4.3/4.7 Linux matrix.',
    );
  }
  const e2eStep = (linuxJob?.steps ?? []).find(({ name }) =>
    name === 'Run the runtime-candidate Overlay 1.1 end-to-end technical review');
  if (
    typeof e2eStep?.run !== 'string'
    || !e2eStep.run.includes('xvfb-run -a pnpm exec vitest run')
    || !e2eStep.run.includes(
      'src/adapters/runtime-candidate-technical-review.e2e.test.ts',
    )
    || e2eStep.env?.LIBGL_ALWAYS_SOFTWARE !== '1'
    || e2eStep.env?.MAPSOO_RUN_RUNTIME_CANDIDATE_E2E !== '1'
  ) {
    throw new Error(
      'ci.yml: Godot matrix does not run the runtime-candidate Overlay 1.1 E2E.',
    );
  }
  console.log(`MAPSOO_WORKFLOW_YAML_OK files=${workflows.length}`);
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}
