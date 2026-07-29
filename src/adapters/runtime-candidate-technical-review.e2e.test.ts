import Ajv2020 from 'ajv/dist/2020.js';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, dirname, resolve } from 'node:path';

import captureReceiptSchema
  from '../../schemas/mapsoo-godot-runtime-capture-receipt-1.1.schema.json';
import {
  runRuntimeCandidateTechnicalReview,
} from '../../scripts/run-runtime-candidate-technical-review';
import {
  materializeGodotRuntimeCaptureReceiptV1_1,
} from '../core/godot-runtime-capture-receipt-v1-1';
import {
  serializeCanonicalWorldLayoutPlan,
  type WorldLayoutPlan,
} from '../core/world-layout-plan';
import type {
  BuiltWorldArtRuntimeCandidate,
} from '../app/world-art-runtime-candidate';
import {
  buildWorldArtRuntimeCandidateTestFixture,
} from '../app/world-art-runtime-candidate.test-fixture';

type GodotVersion = '4.3' | '4.7';

interface InstalledGodot {
  readonly version: GodotVersion;
  readonly path: string;
}

const REPOSITORY_ROOT = resolve(process.cwd());
const RUN_E2E =
  process.env.MAPSOO_RUN_RUNTIME_CANDIDATE_E2E === '1';

function pathCandidates(names: readonly string[]): readonly string[] {
  const directories = (process.env.PATH ?? '')
    .split(delimiter)
    .filter((directory) => directory.length > 0);
  const extensions = process.platform === 'win32' ? ['', '.exe'] : [''];
  return directories.flatMap((directory) =>
    names.flatMap((name) => extensions.map((extension) =>
      resolve(directory, `${name}${extension}`))));
}

const GODOT_CANDIDATES = Object.freeze([
  Object.freeze({
    version: '4.3' as const,
    paths: Object.freeze([
      process.env.MAPSOO_GODOT_43_BIN,
      process.env.GODOT_BIN,
      resolve(
        REPOSITORY_ROOT,
        'release/godot-runtimes/4.3/Godot_v4.3-stable_win64_console.exe',
      ),
      ...pathCandidates([
        'Godot_v4.3-stable_win64_console',
        'godot4',
        'godot',
      ]),
    ]),
  }),
  Object.freeze({
    version: '4.7' as const,
    paths: Object.freeze([
      process.env.MAPSOO_GODOT_47_BIN,
      process.env.GODOT_BIN,
      resolve(
        REPOSITORY_ROOT,
        'release/godot-runtimes/4.7/Godot_v4.7-stable_win64_console.exe',
      ),
      ...pathCandidates([
        'Godot_v4.7-stable_win64_console',
        'godot4',
        'godot',
      ]),
    ]),
  }),
]);
const INSTALLED_GODOT: readonly InstalledGodot[] = Object.freeze(
  GODOT_CANDIDATES.flatMap(({ version, paths }) => {
    const path = [...new Set(paths)].find((candidate): candidate is string => {
      if (
        typeof candidate !== 'string'
        || candidate.length === 0
        || !existsSync(candidate)
      ) return false;
      const detected = spawnSync(resolve(candidate), ['--version'], {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      });
      return detected.status === 0
        && `${detected.stdout ?? ''}\n${detected.stderr ?? ''}`
          .trimStart()
          .startsWith(`${version}.`);
    });
    return path ? [Object.freeze({ version, path: resolve(path) })] : [];
  }),
);

async function writeCandidate(
  directory: string,
  candidate: BuiltWorldArtRuntimeCandidate,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const file of candidate.files) {
    const path = resolve(directory, ...file.path.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.readBytes(), { flag: 'wx' });
  }
}

describe.skipIf(!RUN_E2E)('runtime-candidate technical review E2E', () => {
  if (INSTALLED_GODOT.length === 0) {
    it.skip('requires an installed Godot 4.3 or 4.7 console executable', () => {});
    return;
  }

  let temporaryRoot = '';
  let candidateDirectory = '';
  let layoutPath = '';
  let layoutPlan: WorldLayoutPlan;
  let candidate: BuiltWorldArtRuntimeCandidate;

  beforeAll(async () => {
    temporaryRoot = await mkdtemp(resolve(tmpdir(), 'mapsoo-runtime-review-e2e-'));
    candidateDirectory = resolve(temporaryRoot, 'candidate');
    layoutPath = resolve(temporaryRoot, 'world-layout-plan.json');
    const fixture = await buildWorldArtRuntimeCandidateTestFixture('topdown-farm');
    candidate = fixture.built;
    layoutPlan = fixture.layout;
    await Promise.all([
      writeCandidate(candidateDirectory, candidate),
      serializeCanonicalWorldLayoutPlan(layoutPlan).then((bytes) =>
        writeFile(layoutPath, bytes, { flag: 'wx' })),
    ]);
  }, 120_000);

  afterAll(async () => {
    if (temporaryRoot) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it.each(INSTALLED_GODOT)(
    'builds Overlay 1.1 and produces a five-mode Capture Receipt 1.1 with Godot $version',
    async ({ version, path }) => {
      expect(candidate.overlay.manifest.schema_version).toBe('1.1.0');
      expect(candidate.placement_plan.placements.length).toBeGreaterThan(0);
      expect(candidate.placement_map.bindings.length).toBeGreaterThan(0);

      const outputDirectory = resolve(
        temporaryRoot,
        `technical-review-godot-${version.replace('.', '-')}`,
      );
      const result = await runRuntimeCandidateTechnicalReview({
        candidateDirectory,
        layoutPath,
        godotConsolePath: path,
        godotVersion: version,
        reviewId: `runtime-e2e-godot-${version.replace('.', '-')}`,
        outputDirectory,
      });

      expect(result).toMatchObject({
        status: 'technical-review-created',
        profile: 'topdown-farm',
        technical_gates: 5,
        human_gate: 'pending',
        release_decision: 'blocked',
        remote_requests: 0,
        published: false,
      });

      const receiptPath = resolve(
        outputDirectory,
        'review-evidence/godot-runtime-capture-receipt.json',
      );
      const receiptValue: unknown = JSON.parse(await readFile(receiptPath, 'utf8'));
      const validate = new Ajv2020({ strict: true, allErrors: true })
        .compile(captureReceiptSchema);
      expect(validate(receiptValue), JSON.stringify(validate.errors)).toBe(true);
      const receipt = await materializeGodotRuntimeCaptureReceiptV1_1(receiptValue);

      expect(receipt.schema_version).toBe('1.1.0');
      expect(receipt.engine.godot_version).toBe(version);
      expect(receipt.source).toMatchObject({
        candidate_id: candidate.receipt.candidate_id,
        layout_plan_sha256: candidate.receipt.source.layout_plan_sha256,
        runtime_overlay_id: candidate.overlay.manifest.overlay_id,
        runtime_projection_id: candidate.projected.projection.projection_id,
      });
      expect(receipt.evidence.map(({ kind }) => kind)).toEqual([
        'rendered-world-capture',
        'role-placement-overlay',
        'art-collision-overlay',
        'spawn-exit-traversal',
        'navigation-traversal',
      ]);
      expect(receipt.runtime.route_reached).toBe(true);
      expect(receipt.runtime.catalog_assets).toBeGreaterThan(0);
      expect(receipt.runtime.bound_catalog_assets).toBeGreaterThan(0);
      expect(receipt.runtime.applied_prop_instances).toBeGreaterThan(0);
      expect(receipt.runtime.runtime_bindings).toBe(
        receipt.runtime.applied_runtime_bindings,
      );
      expect(receipt.runtime.all_required_bindings_applied).toBe(true);
      expect(receipt.claims).toEqual({
        runtime: 'technical-pass',
        raspberry_pi: 'pending',
        production_ready: false,
        remote_request_count: 0,
      });

      for (const evidence of receipt.evidence) {
        const evidencePath = resolve(outputDirectory, ...evidence.path.split('/'));
        await access(evidencePath);
        expect((await stat(evidencePath)).size).toBe(evidence.bytes);
      }

      const review = JSON.parse(await readFile(
        resolve(outputDirectory, 'review/production-world-review.json'),
        'utf8',
      ));
      expect(review.evidence.at(-1)).toMatchObject({
        evidence_id: 'godot-runtime-capture-receipt',
        kind: 'headless-asset-controller-smoke',
        path: 'review-evidence/godot-runtime-capture-receipt.json',
      });
      expect(review.gates.filter(({ status }: { status: string }) =>
        status === 'technical-pass')).toHaveLength(5);
    },
    600_000,
  );
});
