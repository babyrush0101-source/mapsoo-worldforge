import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import JSZip from 'jszip';

const ART_ROOT = 'docs/visual-qa/production-art';
const PROJECTION_MANIFEST = `${ART_ROOT}/layered-depth-2d-pack-atlases-v1.json`;
const PREVIEW_MANIFEST = `${ART_ROOT}/layered-depth-2d-production-preview-v1.json`;
const GODOT_EVIDENCE = `${ART_ROOT}/layered-depth-2d-production-candidate-godot-render-v1.json`;
const FIXTURE_ROOT = 'tests/fixtures/layered-depth-2d-production-pack09-candidate-v1';
const ZIP_PATH = `${ART_ROOT}/layered-depth-2d-production-pack09-candidate-v1.zip`;
const RECORD_PATH = `${ART_ROOT}/layered-depth-2d-production-pack09-candidate-v1.json`;
const ARCHIVE_ROOT = 'mapsoo-lanternmere-crossing-production-v1-v0.1.0-alpha.12';
const PACK_ID = 'lanternmere-crossing-production-v1';
const CREATED_AT = '2026-07-26T12:00:00.000Z';
const ZIP_DATE = new Date(Date.UTC(1980, 0, 1));
const SAFE_PATH = /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*)*$/;

const LAYERS = Object.freeze([
  ['background.sky', 'layers/background-sky.png'],
  ['background.far', 'layers/background-far.png'],
  ['background.mid', 'layers/background-mid.png'],
  ['background.depth-fog', 'layers/background-depth-fog.png'],
  ['near.overlay', 'layers/near-overlay.png'],
  ['lighting.ambient', 'layers/lighting-ambient.png'],
  ['lighting.local', 'layers/lighting-local.png'],
  ['foreground.overlay', 'layers/foreground-overlay.png'],
]);
const ATLAS_ROLE_GROUPS = Object.freeze({
  terrain: [
    'terrain.ground', 'terrain.path', 'terrain.edge', 'terrain.bridge',
    'terrain.stairs', 'terrain.water',
  ],
  props: [
    'prop.tree', 'prop.rock', 'prop.crate', 'prop.sign', 'prop.lamp', 'prop.occluder',
  ],
  structures: [
    'structure.entrance', 'structure.exit', 'structure.checkpoint', 'structure.landmark',
  ],
  collectibles: ['collectible.primary', 'collectible.health'],
  effects: ['effect.footstep', 'effect.interact', 'effect.portal', 'effect.ambient'],
});
const LAYER_IDS = Object.freeze(['sky', 'far', 'mid', 'gameplay', 'near', 'lighting', 'foreground']);
const PLANE_SPECS = Object.freeze([
  ['sky', 'background.sky', 'sky', [0, 0], -70, 'mix'],
  ['far', 'background.far', 'far', [0.12, 0.04], -60, 'mix'],
  ['mid', 'background.mid', 'mid', [0.32, 0.12], -50, 'mix'],
  ['depth-fog', 'background.depth-fog', 'mid', [0.45, 0.18], -40, 'add'],
  ['near', 'near.overlay', 'near', [0.82, 0.42], 30, 'mix'],
  ['ambient-light', 'lighting.ambient', 'lighting', [1, 1], 50, 'multiply'],
  ['foreground', 'foreground.overlay', 'foreground', [1.16, 1.08], 70, 'mix'],
]);
const SCHEMAS = Object.freeze([
  'mapsoo-pack-0.9.schema.json',
  'mapsoo-layered-depth-scene-0.4.schema.json',
  'mapsoo-layered-depth-collision-0.4.schema.json',
  'mapsoo-layered-depth-navigation-0.4.schema.json',
  'mapsoo-world-asset-receipt-0.4.schema.json',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function json(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function text(value) {
  return Buffer.from(value, 'utf8');
}

async function loadJson(path) {
  const bytes = await readFile(resolve(path));
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
}

async function boundFile(record, label) {
  const bytes = await readFile(resolve(record.path));
  assert(
    bytes.length === record.bytes && sha256(bytes) === record.sha256,
    `${label} no longer matches its recorded bytes and SHA-256.`,
  );
  return bytes;
}

async function makeEntry(path, mediaType, bytes, source = undefined) {
  assert(SAFE_PATH.test(path), `Unsafe candidate-pack path: ${path}`);
  return {
    path,
    mediaType,
    bytes: Buffer.from(bytes),
    record: {
      path,
      media_type: mediaType,
      bytes: bytes.length,
      sha256: sha256(bytes),
    },
    source,
  };
}

const projectionSource = await loadJson(PROJECTION_MANIFEST);
const projection = projectionSource.value;
assert(
  projection.id === 'layered-depth-2d-pack-atlases-v1'
    && projection.pack_schema === '0.9.0'
    && projection.status === 'runtime-candidate'
    && projection.distribution === 'internal-review'
    && projection.output_license === 'UNRELEASED'
    && projection.outputs?.length === 15,
  'Production projection is not the expected 15-PNG internal candidate.',
);

const previewSource = await loadJson(PREVIEW_MANIFEST);
const preview = previewSource.value;
assert(
  preview.id === 'layered-depth-2d-production-preview-v1'
    && preview.profile === 'layered-depth-2d'
    && preview.status === 'runtime-candidate'
    && preview.distribution === 'internal-review'
    && preview.output_license === 'UNRELEASED'
    && preview.width === 640
    && preview.height === 360,
  'Production preview is not the expected internal candidate.',
);
for (const [field, expected] of [
  ['layers_manifest_sha256', projection.source_bindings.layers_manifest_sha256],
  ['prop_manifest_sha256', projection.source_bindings.prop_manifest_sha256],
]) {
  assert(
    preview.source_bindings?.[field] === expected,
    `Preview and Pack projection disagree on ${field}.`,
  );
}

const godotEvidenceSource = await loadJson(GODOT_EVIDENCE);
const godotEvidence = godotEvidenceSource.value;
assert(
  godotEvidence.id === 'layered-depth-2d-production-candidate-godot-render-v1'
    && godotEvidence.status === 'runtime-candidate'
    && godotEvidence.distribution === 'internal-review'
    && godotEvidence.output_license === 'UNRELEASED'
    && godotEvidence.checks?.cross_version_render_identity === 'pass',
  'Godot evidence is not the expected internal production candidate.',
);

const projectionTargets = new Map([
  ...LAYERS.map(([role, path]) => [role, path]),
  ...Object.keys(ATLAS_ROLE_GROUPS).map((id) => [id, `atlases/${id}.png`]),
  ['player', 'atlases/player.png'],
  ['npc', 'atlases/npc.png'],
]);
const assetEntries = [];
for (const record of projection.outputs) {
  const target = projectionTargets.get(record.id);
  assert(target, `Projection contains an unexpected output: ${record.id}`);
  const bytes = await boundFile(record, `projection ${record.id}`);
  assetEntries.push(await makeEntry(target, 'image/png', bytes, {
    source_path: record.path,
    source_sha256: record.sha256,
    projection_id: record.id,
  }));
}
assert(
  new Set(assetEntries.map(({ path }) => path)).size === 15,
  'Projection target paths are not exactly 15 unique PNG files.',
);

const previewBytes = await boundFile(preview, 'production preview');
assetEntries.push(await makeEntry('previews/world.png', 'image/png', previewBytes, {
  source_path: preview.path,
  source_sha256: preview.sha256,
  projection_id: null,
}));

const bounds = Object.freeze({ x: 0, y: 0, width: 640, height: 360 });
const spawn = Object.freeze({
  x: preview.runtime_layout.player.spawn_anchor.x,
  y: preview.runtime_layout.player.spawn_anchor.y,
});
assert(spawn.x === 120 && spawn.y === 316, 'Production preview spawn contract changed.');

const propPlacements = preview.prop_placements.map((placement, index) => ({
  id: `prop-${String(index).padStart(2, '0')}-${placement.role.replaceAll('.', '-')}`,
  role: placement.role,
  layer: 'gameplay',
  x: placement.anchor.x,
  y: placement.anchor.y,
}));
const npcPlacement = preview.character_placements.find(
  (placement) => placement.role === 'character.npc.atlas',
);
assert(npcPlacement, 'Production preview has no NPC placement.');
const scene = {
  schema_version: '0.4.0',
  profile: 'layered-depth-2d',
  completeness_policy: 'layered-depth-2d-complete-v1',
  bounds,
  spawn,
  baseline_y: spawn.y,
  layers: LAYER_IDS,
  planes: PLANE_SPECS.map(([id, role, layer, scrollRatio, zIndex, blend]) => ({
    id,
    role,
    layer,
    scroll_ratio: scrollRatio,
    z_index: zIndex,
    blend,
    native_size: [320, 180],
    repeat_size: [320, 180],
    repeat_enabled: true,
  })),
  placements: [
    ...propPlacements,
    {
      id: 'npc-guide',
      role: 'character.npc.atlas',
      layer: 'gameplay',
      x: npcPlacement.anchor.x,
      y: npcPlacement.anchor.y,
    },
    {
      id: 'local-light-plane',
      role: 'lighting.local',
      layer: 'lighting',
      x: 320,
      y: 180,
    },
  ],
};

const previewNavigation = preview.runtime_layout.navigation;
const nodeKind = (kind) => ({
  spawn: 'spawn',
  exit: 'exit',
  collectible: 'checkpoint',
}[kind] ?? 'route');
const navigation = {
  schema_version: '0.4.0',
  profile: 'layered-depth-2d',
  completeness_policy: 'layered-depth-2d-complete-v1',
  bounds,
  spawn,
  nodes: previewNavigation.nodes.map(({ id, x, y, kind }) => ({
    id,
    x,
    y,
    kind: nodeKind(kind),
  })),
  edges: previewNavigation.edges.map(({ from, to }) => ({ from, to, kind: 'walk' })),
  exit_node_id: previewNavigation.exit_node_id,
};
const nodeById = new Map(navigation.nodes.map((node) => [node.id, node]));
const collision = {
  schema_version: '0.4.0',
  profile: 'layered-depth-2d',
  completeness_policy: 'layered-depth-2d-complete-v1',
  bounds,
  spawn,
  ground_segments: navigation.edges.map((edge, index) => {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    assert(from && to && from.x < to.x, `Navigation edge ${edge.from} -> ${edge.to} cannot bind a route segment.`);
    return {
      id: `route-${String(index).padStart(2, '0')}`,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      one_way: true,
    };
  }),
  blockers: preview.runtime_layout.collision_shapes.map(({ id, rect }) => ({ id, rect })),
  hazards: [],
};

for (const [path, value] of [
  ['runtime/scene.json', scene],
  ['runtime/collision.json', collision],
  ['runtime/navigation.json', navigation],
]) {
  assetEntries.push(await makeEntry(path, 'application/json', json(value), {
    source_path: PREVIEW_MANIFEST,
    source_sha256: sha256(previewSource.bytes),
  }));
}

const projectionAssetRecords = assetEntries
  .filter(({ source }) => source?.projection_id !== undefined && source.projection_id !== null)
  .map(({ record, source }) => ({
    ...record,
    source_path: source.source_path,
    source_sha256: source.source_sha256,
    projection_id: source.projection_id,
  }));
const runtimeAssetRecords = assetEntries
  .filter(({ path }) => path.startsWith('runtime/') || path === 'previews/world.png')
  .map(({ record }) => record);
const requestBinding = json({
  profile: 'layered-depth-2d',
  world: preview.world,
  projection_manifest_sha256: sha256(projectionSource.bytes),
  preview_manifest_sha256: sha256(previewSource.bytes),
  godot_evidence_sha256: sha256(godotEvidenceSource.bytes),
});
const receipt = {
  schema_version: '0.4.0',
  completed_at: CREATED_AT,
  request: {
    fingerprint_sha256: sha256(requestBinding),
    profile: 'layered-depth-2d',
    seed: 'lanternmere-crossing-production-v1',
    reference_rights: [
      {
        role: 'environment-style',
        basis: 'review-pending',
        license: 'LicenseRef-UNRELEASED',
        permits_cc0_dedication: false,
      },
      {
        role: 'character',
        basis: 'review-pending',
        license: 'LicenseRef-UNRELEASED',
        permits_cc0_dedication: false,
      },
    ],
  },
  provider: {
    id: 'mapsoo-production-art-pipeline',
    version: 'candidate-v1',
    execution: 'local-assisted',
    determinism: 'source-hash-bound-projection',
    output_provenance: 'hybrid',
    contains_generative_ai: true,
    generation_receipt: 'not-persisted',
  },
  output: {
    bundle_schema_version: '0.4.0',
    completeness_policy: 'layered-depth-2d-complete-v1',
    license: 'LicenseRef-UNRELEASED',
    files: [...projectionAssetRecords, ...runtimeAssetRecords]
      .map(({ path, bytes, sha256: digest }) => ({ path, bytes, sha256: digest }))
      .sort((left, right) => left.path.localeCompare(right.path, 'en')),
  },
  disclosures: [
    'This production candidate is internal-review and UNRELEASED; no redistribution permission is granted.',
    'Pack 0.9 and receipt 0.4 require CC0-1.0, so the current importer and receipt schema must reject this candidate.',
    'The archive contains exactly 15 hash-bound projection PNG files plus one separately bound composited preview PNG.',
    'Four Pack 0.9 alias groups bind 22 role names to 18 independent terrain/prop regions.',
    'Character Pack frames select one independently generated pose per clip; model-native temporal animation is not claimed.',
    'Reference images, raw prompts, private consumer data and character identity source images are excluded.',
  ],
};

const reviewStatus = {
  schema_version: 'mapsoo-production-pack-candidate-review/1.0',
  id: 'layered-depth-2d-production-pack09-candidate-v1',
  pack_id: PACK_ID,
  profile: 'layered-depth-2d',
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  public_release_allowed: false,
  source_bindings: {
    projection_manifest: PROJECTION_MANIFEST,
    projection_manifest_sha256: sha256(projectionSource.bytes),
    preview_manifest: PREVIEW_MANIFEST,
    preview_manifest_sha256: sha256(previewSource.bytes),
    godot_evidence: GODOT_EVIDENCE,
    godot_evidence_sha256: sha256(godotEvidenceSource.bytes),
  },
  inventory: {
    production_projection_pngs: 15,
    composited_preview_pngs: 1,
    runtime_sidecars: 3,
    projection_roles: projection.outputs.map(({ id }) => id),
  },
  pack_0_9_compatibility: {
    schema_structure: 'candidate-pass',
    canonical_paths_and_dimensions: 'candidate-pass',
    runtime_sidecars: 'candidate-pass',
    receipt_0_4_license_contract: 'expected-reject',
    importer_license_contract: 'expected-reject',
    rejection_reason:
      'Pack 0.9 requires an irrevocable CC0-1.0 dedication and redistribution permission; this candidate is UNRELEASED.',
  },
  review_gates: {
    source_hash_binding: 'pass',
    deterministic_build: 'verifier-required',
    godot_production_render: 'candidate-pass',
    human_art_review: 'pending',
    rights_and_license_review: 'pending',
    raspberry_pi_runtime: 'pending',
  },
  alias_disclosure: {
    independent_regions: 18,
    canonical_role_bindings: 22,
    groups: projection.alias_contract.alias_groups.map(({ shared_roles }) => shared_roles),
  },
  not_accepted_for: [
    'Pack 0.9 importer acceptance',
    'CC0 dedication',
    'redistribution',
    'public asset-pack release',
    'human art approval',
    'Raspberry Pi approval',
  ],
};

const licenseNotice = text(`# Internal-review asset notice

Status: UNRELEASED

No license or redistribution permission is granted for the production PNG or
runtime JSON assets in this candidate archive. They exist only for local,
private technical and art review.

The included schema copies and explanatory documentation retain the upstream
repository's MIT license. Reference images are not included.

Do not publish this archive or upload it to an asset marketplace. A later
reviewed export must name its actual output license explicitly.
`);
const readme = text(`# Lanternmere Crossing production Pack 0.9 candidate

This is a deterministic, hash-bound internal review fixture. It contains the
15 production projection PNGs, one composited preview, and Pack 0.9-shaped
runtime sidecars.

It is intentionally **not importable by the current Pack 0.9 importer**:
the production art is \`UNRELEASED\`, while Pack 0.9 requires an irrevocable
\`CC0-1.0\` dedication. Do not change the manifest to CC0 merely to make the
import pass.

See \`review-status.json\` and \`generation-receipt.json\` for the exact gates,
source hashes, AI disclosure, alias limitation and excluded source material.
`);

const supportEntries = [
  await makeEntry('generation-receipt.json', 'application/json', json(receipt)),
  await makeEntry('review-status.json', 'application/json', json(reviewStatus)),
  await makeEntry('license-assets.md', 'text/markdown', licenseNotice),
  await makeEntry('readme.md', 'text/markdown', readme),
];
for (const name of SCHEMAS) {
  supportEntries.push(await makeEntry(
    `schema/${name}`,
    'application/schema+json',
    await readFile(resolve(`schemas/${name}`)),
  ));
}

const allEntries = [...assetEntries, ...supportEntries].sort(
  (left, right) => left.path.localeCompare(right.path, 'en'),
);
assert(
  new Set(allEntries.map(({ path }) => path)).size === allEntries.length,
  'Candidate pack contains duplicate paths.',
);

const rolePath = new Map(LAYERS);
for (const [atlas, roles] of Object.entries(ATLAS_ROLE_GROUPS)) {
  for (const role of roles) rolePath.set(role, `atlases/${atlas}.png`);
}
rolePath.set('character.player.atlas', 'atlases/player.png');
rolePath.set('character.npc.atlas', 'atlases/npc.png');
rolePath.set('world.scene', 'runtime/scene.json');
rolePath.set('world.collision', 'runtime/collision.json');
rolePath.set('world.navigation', 'runtime/navigation.json');
rolePath.set('world.preview', 'previews/world.png');
assert(rolePath.size === 36, 'Pack 0.9 requires exactly 36 canonical role bindings.');

const characterRecord = (id) => projection.outputs.find(
  (record) => record.kind === 'character' && record.id === id,
);
const characterManifest = (id, actions) => {
  const record = characterRecord(id);
  assert(record, `Projection is missing ${id}.`);
  return {
    id,
    atlas: `atlases/${id}.png`,
    frame_size: [48, 72],
    pivot: [24, 67],
    clips: record.clips.map((clip) => {
      assert(actions.includes(clip.action), `${id} contains unexpected action ${clip.action}.`);
      return {
        id: clip.clip_id,
        action: clip.action,
        direction: clip.direction,
        fps: clip.action === 'idle' ? 4 : clip.action === 'run' ? 10 : 7,
        frames: [{ x: clip.pack_pixel_origin.x, y: clip.pack_pixel_origin.y }],
      };
    }),
  };
};
const manifest = {
  schema_version: '0.9.0',
  pack: {
    id: PACK_ID,
    title: 'Lanternmere Crossing production candidate',
    version: '0.1.0-alpha.12',
    generator: { name: 'Mapsoo Worldsmith', version: '0.1.0-alpha.12' },
    created_at: CREATED_AT,
  },
  profile: 'layered-depth-2d',
  completeness_policy: 'layered-depth-2d-complete-v1',
  compatibility: {
    godot_min: '4.3',
    projection: 'layered-depth-stage',
    art_style: 'pixel_art',
    importer: { id: 'mapsoo_importer', min_version: '0.1.0-alpha.12' },
  },
  layers: LAYER_IDS.map((id, order) => ({ id, order })),
  atlases: ['terrain', 'props', 'structures', 'collectibles', 'effects', 'player', 'npc']
    .map((id) => ({ id, path: `atlases/${id}.png` })),
  planes: PLANE_SPECS.map(([id, role]) => ({ id, role, path: rolePath.get(role) })),
  roles: [...rolePath].map(([role, path]) => ({ role, path })),
  characters: [
    characterManifest('player', ['idle', 'walk', 'run', 'interact']),
    characterManifest('npc', ['idle', 'talk']),
  ],
  runtime: {
    scene: { path: 'runtime/scene.json' },
    collision: { path: 'runtime/collision.json' },
    navigation: { path: 'runtime/navigation.json' },
    spawn,
  },
  files: allEntries.map(({ record }) => record),
  license: {
    output: {
      id: 'LicenseRef-UNRELEASED',
      notice_path: 'license-assets.md',
      permits_redistribution: false,
    },
  },
  provenance: {
    provider: { id: 'mapsoo-production-art-pipeline', version: 'candidate-v1' },
    output_provenance: 'hybrid',
    contains_generative_ai: true,
    model_provider: 'OpenAI built-in image generation',
    model: null,
    seed: 'lanternmere-crossing-production-v1',
    human_curated: false,
  },
};
const manifestBytes = json(manifest);

const absoluteFixture = resolve(FIXTURE_ROOT);
assert(
  absoluteFixture.startsWith(`${resolve('tests/fixtures')}\\`)
    || absoluteFixture.startsWith(`${resolve('tests/fixtures')}/`),
  'Refusing to replace a fixture outside tests/fixtures.',
);
await rm(absoluteFixture, { recursive: true, force: true });
await mkdir(absoluteFixture, { recursive: true });
for (const item of allEntries) {
  const target = resolve(absoluteFixture, ...item.path.split('/'));
  assert(target.startsWith(absoluteFixture), `Fixture path escaped root: ${item.path}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, item.bytes);
}
await writeFile(resolve(absoluteFixture, 'mapsoo.manifest.json'), manifestBytes);

const archive = new JSZip();
const archiveItems = [
  ...allEntries.map(({ path, bytes }) => ({ path, bytes })),
  { path: 'mapsoo.manifest.json', bytes: manifestBytes },
].sort((left, right) => left.path.localeCompare(right.path, 'en'));
for (const item of archiveItems) {
  archive.file(`${ARCHIVE_ROOT}/${item.path}`, item.bytes, {
    binary: true,
    createFolders: false,
    date: ZIP_DATE,
    unixPermissions: 0o100644,
  });
}
const zipBytes = await archive.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
  platform: 'UNIX',
  streamFiles: false,
});
await writeFile(resolve(ZIP_PATH), zipBytes);

const record = {
  schema_version: 'mapsoo-production-pack-candidate-build/1.0',
  id: 'layered-depth-2d-production-pack09-candidate-v1',
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  archive: {
    path: ZIP_PATH,
    root: ARCHIVE_ROOT,
    bytes: zipBytes.length,
    sha256: sha256(zipBytes),
  },
  fixture_root: FIXTURE_ROOT,
  manifest_sha256: sha256(manifestBytes),
  source_bindings: reviewStatus.source_bindings,
  inventory: {
    production_projection_pngs: 15,
    composited_preview_pngs: 1,
    runtime_sidecars: 3,
    pack_files_excluding_manifest: allEntries.length,
  },
  expected_contract_results: {
    pack_0_9_json_schema: 'pass',
    runtime_0_4_json_schemas: 'pass',
    receipt_0_4_json_schema: 'expected-reject-license-const',
    pack_0_9_godot_importer: 'expected-reject-license-contract',
  },
  automated_checks: {
    source_hash_binding: 'pass',
    safe_paths: 'pass',
    canonical_pack_paths: 'pass',
    exact_15_projection_pngs: 'pass',
    preview_separate_from_projection: 'pass',
    manifest_file_hashes: 'pass',
    deterministic_zip: 'verifier-required',
    public_release: 'blocked',
  },
};
const recordBytes = json(record);
await writeFile(resolve(RECORD_PATH), recordBytes);

console.log(
  `MAPSOO_LAYERED_PACK09_CANDIDATE_OK projection_pngs=15 preview_pngs=1`
    + ` pack_files=${allEntries.length} zip_sha256=${record.archive.sha256}`
    + ` importer=expected-reject-license`,
);
