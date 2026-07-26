import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const manifests = [
  'docs/visual-qa/production-art/side-platformer-direction-v1.json',
  'docs/visual-qa/production-art/side-platformer-character-sheet-v1.json',
  'docs/visual-qa/production-art/side-platformer-character-atlas-v1.json',
  'docs/visual-qa/production-art/side-platformer-terrain-sheet-v1.json',
  'docs/visual-qa/production-art/side-platformer-terrain-atlas-v2.json',
  'docs/visual-qa/production-art/side-platformer-prop-sheet-v1.json',
  'docs/visual-qa/production-art/side-platformer-prop-atlas-v1.json',
  'docs/visual-qa/production-art/side-platformer-background-layers-v1.json',
  'docs/visual-qa/production-art/side-platformer-production-preview-v1.json',
];

function readPngDimension(bytes, offset) {
  return bytes.readUInt32BE(offset);
}

for (const manifestPath of manifests) {
  const manifestBytes = await readFile(resolve(manifestPath));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (
    ![
      'mapsoo-art-direction-sample/1.0',
      'mapsoo-production-art-source/1.0',
      'mapsoo-runtime-character-atlas/1.0',
      'mapsoo-runtime-terrain-atlas/1.0',
      'mapsoo-runtime-prop-atlas/1.0',
      'mapsoo-production-world-preview/1.0',
    ].includes(manifest.schema_version)
    || !['direction-review', 'source-candidate', 'runtime-candidate'].includes(manifest.status)
    || manifest.distribution !== 'internal-review'
    || manifest.output_license !== 'UNRELEASED'
  ) {
    throw new Error(`${manifestPath} must remain a non-release art-review record.`);
  }

  const rasters = manifest.rasters ?? [manifest];
  for (const raster of rasters) {
    if (
      typeof raster.path !== 'string'
      || raster.path.includes('\\')
      || raster.path.startsWith('/')
      || raster.path.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      throw new Error(`${manifestPath} contains an unsafe sample path.`);
    }
    const png = await readFile(resolve(raster.path));
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (png.length < 24 || !png.subarray(0, 8).equals(pngSignature)) {
      throw new Error(`${raster.path} is not a valid PNG payload.`);
    }
    const actual = {
      bytes: png.length,
      width: readPngDimension(png, 16),
      height: readPngDimension(png, 20),
      sha256: createHash('sha256').update(png).digest('hex'),
    };
    for (const field of ['bytes', 'width', 'height', 'sha256']) {
      if (raster[field] !== actual[field]) {
        throw new Error(`${raster.path} ${field} does not match its review record.`);
      }
    }
    console.log(`MAPSOO_PRODUCTION_ART_RASTER_OK ${manifest.id}:${raster.stage ?? 'sample'}:${actual.width}x${actual.height}:${actual.sha256}`);
  }
  if (manifest.grid) {
    if (manifest.grid.cell_width !== undefined) {
      if (
        manifest.grid.columns * manifest.grid.cell_width !== rasters[0].width
        || manifest.grid.rows * manifest.grid.cell_height !== rasters[0].height
        || new Set(manifest.grid.column_actions).size !== manifest.grid.columns
      ) {
        throw new Error(`${manifestPath} grid does not exactly cover its raster.`);
      }
    } else {
      const declaredRoles = manifest.grid.column_roles_top_row ?? manifest.grid.ordered_roles;
      if (
        manifest.grid.sampling !== 'proportional-source-grid'
        || manifest.grid.columns !== 8
        || manifest.grid.rows !== 4
        || !Array.isArray(declaredRoles)
        || declaredRoles.length < 8
      ) {
        throw new Error(`${manifestPath} proportional source grid is invalid.`);
      }
    }
  }
  if (manifest.schema_version === 'mapsoo-runtime-character-atlas/1.0') {
    if (
      manifest.profile !== 'side-platformer'
      || manifest.role !== 'character.player.atlas'
      || manifest.width !== 1024
      || manifest.height !== 768
      || manifest.frame_width !== 128
      || manifest.frame_height !== 128
      || JSON.stringify(manifest.pivot) !== '[64,120]'
      || manifest.frames.length !== 12
      || manifest.automated_checks.green_spill_pixels !== 0
      || manifest.automated_checks.godot_runtime !== 'pass'
      || manifest.godot_evidence !== 'docs/visual-qa/production-art/side-platformer-character-godot-v1.json'
    ) {
      throw new Error(`${manifestPath} runtime atlas geometry or review status is invalid.`);
    }
    const keys = new Set(manifest.frames.map((frame) => `${frame.action}.${frame.direction}`));
    const expected = ['idle', 'run', 'jump', 'fall', 'land', 'hurt']
      .flatMap((action) => ['right', 'left'].map((direction) => `${action}.${direction}`));
    if (keys.size !== expected.length || expected.some((key) => !keys.has(key))) {
      throw new Error(`${manifestPath} does not contain the exact side-platformer clip set.`);
    }
  }
  if (manifest.schema_version === 'mapsoo-runtime-terrain-atlas/1.0') {
    const roles = [
      'terrain.solid',
      'terrain.one-way',
      'terrain.slope-up',
      'terrain.slope-down',
      'terrain.wall',
      'terrain.ceiling',
    ];
    if (
      manifest.profile !== 'side-platformer'
      || manifest.width !== 384
      || manifest.height !== 192
      || manifest.cell_width !== 48
      || manifest.cell_height !== 48
      || manifest.alpha_policy !== 'straight-alpha'
      || JSON.stringify(manifest.role_mappings.map((mapping) => mapping.role)) !== JSON.stringify(roles)
      || manifest.seam_checks.some((check) => check.mismatches !== 0)
      || manifest.background_removed_pixels.some((entry) => entry.pixels < 32)
      || manifest.automated_checks.opaque_source !== 'pass'
      || manifest.automated_checks.exact_target_grid !== 'pass'
      || manifest.automated_checks.bounded_background_removal !== 'pass'
      || manifest.automated_checks.reserved_cells_transparent !== 'pass'
      || manifest.automated_checks.godot_runtime !== 'pending'
    ) {
      throw new Error(`${manifestPath} terrain atlas geometry, roles or seam gate is invalid.`);
    }
  }
  if (manifest.schema_version === 'mapsoo-runtime-prop-atlas/1.0') {
    const roles = [
      'hazard.spikes',
      'hazard.pit',
      'hazard.moving-platform',
      'prop.crate',
      'prop.rock',
      'prop.plant',
      'prop.sign',
      'prop.lamp',
      'prop.breakable',
      'structure.entrance',
      'structure.exit',
      'structure.checkpoint',
      'collectible.primary',
      'collectible.health',
    ];
    if (
      manifest.profile !== 'side-platformer'
      || manifest.width !== 512
      || manifest.height !== 512
      || manifest.cell_width !== 64
      || manifest.cell_height !== 64
      || JSON.stringify(manifest.pivot) !== '[32,64]'
      || JSON.stringify(manifest.role_mappings.map((mapping) => mapping.role)) !== JSON.stringify(roles)
      || manifest.role_mappings.some((mapping) => mapping.visible_pixels < 32 || mapping.chroma_edge_pixels !== 0)
      || manifest.sanitation.mapped_cells !== 14
      || manifest.sanitation.unmapped_cells !== 50
      || manifest.sanitation.nonempty_unmapped_cells_cleared !== 18
      || manifest.sanitation.visible_pixels_cleared !== 11725
      || manifest.sanitation.cleared_cells.length !== 18
      || manifest.sanitation.cleared_cells.some((cell) => (
        cell.source_visible_pixels < 1
        || roles.some((_, index) => (
          cell.column === index % 8 && cell.row === Math.floor(index / 8)
        ))
      ))
      || manifest.automated_checks.required_cells_nonempty !== 'pass'
      || manifest.automated_checks.all_unmapped_cells_transparent !== 'pass'
      || manifest.automated_checks.reserved_cells_transparent !== 'pass'
      || manifest.automated_checks.godot_runtime !== 'pending'
    ) {
      throw new Error(`${manifestPath} prop atlas geometry, roles, alpha or review gate is invalid.`);
    }
  }
  if (manifest.schema_version === 'mapsoo-production-world-preview/1.0') {
    if (
      manifest.profile !== 'side-platformer'
      || manifest.width !== 1280
      || manifest.height !== 720
      || manifest.source_bindings.terrain_sha256 !== '4bf5b5fab1214a53a445147f60190d9cb7b6b1801586b263385644f6e8f552bd'
      || manifest.source_bindings.prop_sha256 !== '8e93cd07742fe271d1317adbaa123d94a2c7b003591d955cc77bc0d6316b5a47'
      || manifest.source_bindings.character_manifest !== 'docs/visual-qa/production-art/side-platformer-character-atlas-v2.json'
      || manifest.source_bindings.character_sha256 !== 'e712f5a80c238b57e52447d301ea8530a1114eb885d45fe61c37d8a20d743639'
      || manifest.source_bindings.character_clip_count !== 12
      || manifest.source_bindings.character_frame_count !== 28
      || manifest.source_bindings.character_frame_origin !== 'deterministic-postprocess-variant'
      || manifest.source_bindings.runtime_background_manifest !== 'docs/visual-qa/production-art/side-platformer-background-runtime-1280x720-v1.json'
      || manifest.source_bindings.capture_background_manifest !== 'docs/visual-qa/production-art/side-platformer-background-runtime-640x360-v1.json'
      || manifest.terrain_layout.runs.reduce((sum, run) => sum + run.count, 0) + manifest.terrain_layout.singles.length !== 89
      || JSON.stringify(manifest.runtime_layout.player.spawn_anchor) !== '{"x":144,"y":576}'
      || JSON.stringify(manifest.runtime_layout.player.collision_offset) !== '{"x":0,"y":-30}'
      || JSON.stringify(manifest.runtime_layout.player.visual_offset) !== '{"x":0,"y":-56}'
      || JSON.stringify(manifest.runtime_layout.exit) !== '{"id":"exit-node","x":1116,"y":576,"radius":20}'
      || manifest.runtime_layout.collision_shapes.length !== 5
      || JSON.stringify(manifest.runtime_layout.collision_shapes.slice(2).map((shape) => shape.role)) !== '["terrain.slope-up","terrain.slope-down","terrain.wall"]'
      || manifest.runtime_layout.collision_shapes.slice(2).some((shape) => (
        !shape.visual_binding
        || shape.visual_binding.terrain_single_index < 0
        || JSON.stringify(manifest.terrain_layout.singles[shape.visual_binding.terrain_single_index].atlas_cell)
          !== JSON.stringify(shape.visual_binding.atlas_cell)
      ))
      || manifest.runtime_layout.unbound_visible_collision_roles.length !== 0
      || manifest.runtime_layout.navigation.nodes.length !== 7
      || manifest.runtime_layout.navigation.edges.length !== 6
      || manifest.runtime_layout.navigation.spawn_node_id !== 'spawn-node'
      || manifest.runtime_layout.navigation.exit_node_id !== 'exit-node'
      || manifest.placements.length < 10
      || JSON.stringify(manifest.critical_role_thresholds) !== '{"minimum_visible_fraction":0.9,"maximum_near_opaque_foreground_coverage":0.1,"minimum_exit_mean_color_distance":0.14}'
      || JSON.stringify(manifest.critical_role_visibility.map((entry) => entry.role)) !== '["structure.entrance","structure.exit"]'
      || manifest.critical_role_visibility.some((entry) => (
        entry.visible_fraction < manifest.critical_role_thresholds.minimum_visible_fraction
        || entry.foreground_coverage > manifest.critical_role_thresholds.maximum_near_opaque_foreground_coverage
        || entry.near_opaque_alpha_threshold !== 230
      ))
      || manifest.critical_role_visibility.find(({ role }) => role === 'structure.exit')?.mean_color_distance
        < manifest.critical_role_thresholds.minimum_exit_mean_color_distance
      || manifest.automated_checks.preview_from_exported_assets !== 'pass'
      || manifest.automated_checks.fully_opaque_composite !== 'pass'
      || manifest.automated_checks.quantized_colors < 64
      || manifest.automated_checks.critical_structure_visibility !== 'pass'
      || manifest.automated_checks.foreground_occlusion !== 'pass'
      || manifest.automated_checks.exit_visual_contrast !== 'pass'
      || manifest.automated_checks.collision_alignment !== 'candidate-pass'
      || manifest.automated_checks.navigation_alignment !== 'candidate-pass'
      || manifest.automated_checks.multi_frame_character_binding !== 'candidate-pass'
      || manifest.automated_checks.godot_runtime !== 'candidate-pass'
      || manifest.automated_checks.godot_headless_world_smoke !== 'pass'
      || manifest.automated_checks.godot_headless_world_smoke_evidence !== 'docs/visual-qa/production-art/side-platformer-production-world-godot-v1.json'
      || manifest.automated_checks.human_art_review !== 'pending'
    ) {
      throw new Error(`${manifestPath} production world preview binding or review status is invalid.`);
    }
  }
  if (!Array.isArray(manifest.not_accepted_for) || !manifest.not_accepted_for.includes('public asset-pack release')) {
    throw new Error(`${manifestPath} must explicitly forbid release as a finished asset pack.`);
  }
}

const godotQaPath = 'docs/visual-qa/production-art/side-platformer-character-godot-v1.json';
const godotQa = JSON.parse(await readFile(resolve(godotQaPath), 'utf8'));
if (
  godotQa.schema_version !== 'mapsoo-production-art-godot-qa/1.0'
  || godotQa.status !== 'technical-runtime-pass'
  || godotQa.atlas_sha256 !== '437974ee2e4ffd3d4e127916bd98e515a90001190972ee5f0c5b593c7a9c21d2'
  || godotQa.frames !== 12
  || godotQa.visible_pixels !== 67800
  || !/^[a-f0-9]{64}$/.test(godotQa.preview_pixels_sha256)
  || JSON.stringify(godotQa.runs.map((run) => run.godot)) !== '["4.3","4.7"]'
) {
  throw new Error(`${godotQaPath} does not prove the exact dual-version technical runtime gate.`);
}
const previewHashes = new Set();
for (const run of godotQa.runs) {
  const preview = await readFile(resolve(run.preview_path));
  const actualHash = createHash('sha256').update(preview).digest('hex');
  if (preview.length !== run.preview_bytes || actualHash !== run.preview_sha256) {
    throw new Error(`${run.preview_path} does not match the Godot QA record.`);
  }
  previewHashes.add(actualHash);
}
if (previewHashes.size !== 1) {
  throw new Error('Godot 4.3 and 4.7 production-character previews are not byte-identical.');
}
console.log(
  `MAPSOO_PRODUCTION_CHARACTER_GODOT_EVIDENCE_OK versions=4.3,4.7 pixels=${godotQa.preview_pixels_sha256} png=${[...previewHashes][0]}`,
);

const backgroundManifestPath = 'docs/visual-qa/production-art/side-platformer-background-runtime-v1.json';
const backgroundManifest = JSON.parse(await readFile(resolve(backgroundManifestPath), 'utf8'));
const backgroundRoles = [
  'background.sky',
  'background.far',
  'background.mid',
  'background.near',
  'foreground.overlay',
];
if (
  backgroundManifest.schema_version !== 'mapsoo-runtime-background-layers/1.0'
  || backgroundManifest.status !== 'runtime-candidate'
  || backgroundManifest.distribution !== 'internal-review'
  || backgroundManifest.output_license !== 'UNRELEASED'
  || JSON.stringify(backgroundManifest.layers.map((layer) => layer.role)) !== JSON.stringify(backgroundRoles)
  || backgroundManifest.automated_checks.exact_target_dimensions !== 'pass'
  || backgroundManifest.automated_checks.alpha_policy !== 'pass'
  || backgroundManifest.automated_checks.horizontal_seam !== 'pass'
  || backgroundManifest.automated_checks.godot_runtime !== 'pending'
) {
  throw new Error(`${backgroundManifestPath} layer contract or review status is invalid.`);
}
for (const [index, layer] of backgroundManifest.layers.entries()) {
  const bytes = await readFile(resolve(layer.path));
  if (
    bytes.length !== layer.bytes
    || createHash('sha256').update(bytes).digest('hex') !== layer.sha256
    || layer.width !== 1920
    || layer.height !== 1080
    || layer.horizontal_seam_mismatches !== 0
    || layer.chroma_edge_pixels !== 0
    || layer.alpha_policy !== (index === 0 ? 'opaque' : 'straight-alpha')
  ) {
    throw new Error(`${layer.path} does not satisfy its normalized parallax record.`);
  }
}
console.log('MAPSOO_PRODUCTION_BACKGROUND_LAYERS_OK layers=5 dimensions=1920x1080 seam=0');

for (const target of [
  { dimensions: '1280x720', width: 1280, height: 720 },
  { dimensions: '640x360', width: 640, height: 360 },
]) {
  const runtimePath = `docs/visual-qa/production-art/side-platformer-background-runtime-${target.dimensions}-v1.json`;
  const runtimeBytes = await readFile(resolve(runtimePath));
  const runtime = JSON.parse(runtimeBytes.toString('utf8'));
  if (
    runtime.schema_version !== 'mapsoo-runtime-background-layers/1.1'
    || runtime.status !== 'runtime-candidate'
    || runtime.distribution !== 'internal-review'
    || runtime.output_license !== 'UNRELEASED'
    || runtime.source_manifest !== backgroundManifestPath
    || runtime.source_manifest_sha256 !== createHash('sha256').update(await readFile(resolve(backgroundManifestPath))).digest('hex')
    || runtime.target.width !== target.width
    || runtime.target.height !== target.height
    || runtime.layers.length !== 5
  ) {
    throw new Error(`${runtimePath} is not a bound ${target.dimensions} runtime-layer candidate.`);
  }
  for (const [index, layer] of runtime.layers.entries()) {
    const bytes = await readFile(resolve(layer.path));
    if (
      layer.role !== backgroundRoles[index]
      || layer.width !== target.width
      || layer.height !== target.height
      || layer.bytes !== bytes.length
      || layer.sha256 !== createHash('sha256').update(bytes).digest('hex')
      || layer.source_sha256 !== backgroundManifest.layers[index].sha256
      || layer.resize !== 'nearest-neighbor-precomputed'
    ) {
      throw new Error(`${layer.path} is not a deterministic bound runtime layer.`);
    }
  }
  console.log(`MAPSOO_PRODUCTION_RUNTIME_BACKGROUND_OK dimensions=${target.dimensions} layers=5 manifest=${createHash('sha256').update(runtimeBytes).digest('hex')}`);
}

const worldGodotQaPath = 'docs/visual-qa/production-art/side-platformer-production-world-godot-v1.json';
const worldGodotQa = JSON.parse(await readFile(resolve(worldGodotQaPath), 'utf8'));
const smokeScriptBytes = await readFile(resolve(worldGodotQa.source_bindings.smoke_script));
const backgroundManifestBytes = await readFile(resolve(backgroundManifestPath));
if (
  worldGodotQa.schema_version !== 'mapsoo-production-world-godot-qa/1.0'
  || worldGodotQa.status !== 'technical-smoke-pass'
  || worldGodotQa.evidence_type !== 'headless-asset-controller-smoke'
  || worldGodotQa.distribution !== 'internal-review'
  || worldGodotQa.output_license !== 'UNRELEASED'
  || worldGodotQa.source_bindings.background_manifest !== backgroundManifestPath
  || createHash('sha256').update(backgroundManifestBytes).digest('hex') !== worldGodotQa.source_bindings.background_manifest_sha256
  || worldGodotQa.source_bindings.terrain_sha256 !== '4bf5b5fab1214a53a445147f60190d9cb7b6b1801586b263385644f6e8f552bd'
  || worldGodotQa.source_bindings.prop_sha256 !== '1a313f2c83aca3fefb14da383afb9275a1ebe85789b5464f309488e407546458'
  || worldGodotQa.source_bindings.character_sha256 !== '437974ee2e4ffd3d4e127916bd98e515a90001190972ee5f0c5b593c7a9c21d2'
  || createHash('sha256').update(smokeScriptBytes).digest('hex') !== worldGodotQa.source_bindings.smoke_script_sha256
  || JSON.stringify(worldGodotQa.runs.map((run) => run.godot)) !== '["4.3","4.7"]'
  || worldGodotQa.runs.some((run) => (
    run.backgrounds_loaded !== 5
    || run.atlas_cells_sliced !== 20
    || run.floor_collision !== 'pass'
    || run.run_animation !== 'run_right'
    || run.jump_animation !== 'jump_right'
    || run.exit_reached !== 'exit-node'
  ))
  || !worldGodotQa.does_not_prove.includes('art-to-collision alignment')
  || !worldGodotQa.does_not_prove.includes('navigation or route traversal')
  || !worldGodotQa.does_not_prove.includes('rendered world composition')
  || !worldGodotQa.does_not_prove.includes('human art approval')
  || !worldGodotQa.does_not_prove.includes('physical Raspberry Pi 4B performance')
  || !worldGodotQa.not_accepted_for.includes('public asset-pack release')
) {
  throw new Error(`${worldGodotQaPath} does not prove the bounded dual-version world smoke.`);
}
console.log('MAPSOO_PRODUCTION_WORLD_GODOT_EVIDENCE_OK scope=headless-asset-controller-smoke versions=4.3,4.7 backgrounds=5 cells=20 floor=pass run=run_right jump=jump_right exit-trigger=exit-node');

const renderedCandidateQaPath = 'docs/visual-qa/production-art/side-platformer-production-candidate-godot-render-v1.json';
const renderedCandidateQa = JSON.parse(await readFile(resolve(renderedCandidateQaPath), 'utf8'));
const renderedSourceBindings = renderedCandidateQa.source_bindings;
const actualBoundHashes = Object.fromEntries(await Promise.all([
  ['preview_manifest', renderedSourceBindings.preview_manifest],
  ['character_manifest', renderedSourceBindings.character_manifest],
  ['capture_background_manifest', renderedSourceBindings.capture_background_manifest],
  ['capture_script', renderedSourceBindings.capture_script],
  ['verification_script', renderedSourceBindings.verification_script],
].map(async ([key, path]) => [
  `${key}_sha256`,
  createHash('sha256').update(await readFile(resolve(path))).digest('hex'),
])));
if (
  renderedCandidateQa.schema_version !== 'mapsoo-production-candidate-godot-render-qa/1.0'
  || renderedCandidateQa.status !== 'technical-candidate-pass'
  || renderedCandidateQa.distribution !== 'internal-review'
  || renderedCandidateQa.output_license !== 'UNRELEASED'
  || Object.entries(actualBoundHashes).some(([field, hash]) => renderedSourceBindings[field] !== hash)
  || JSON.stringify(renderedCandidateQa.runs.map((run) => run.godot)) !== '["4.3","4.7"]'
  || renderedCandidateQa.runtime_layout.backgrounds !== 5
  || renderedCandidateQa.runtime_layout.terrain_cells !== 89
  || renderedCandidateQa.runtime_layout.prop_placements !== 10
  || renderedCandidateQa.runtime_layout.collision_shapes !== 5
  || JSON.stringify(renderedCandidateQa.runtime_layout.bound_collision_roles) !== '["terrain.slope-up","terrain.slope-down","terrain.wall"]'
  || renderedCandidateQa.runtime_layout.navigation_nodes !== 7
  || renderedCandidateQa.runtime_layout.navigation_edges !== 6
  || renderedCandidateQa.runtime_layout.character_clips !== 12
  || renderedCandidateQa.runtime_layout.character_frames !== 28
  || renderedCandidateQa.runtime_layout.route !== 'walk-slope-jump'
  || JSON.stringify(renderedCandidateQa.runtime_layout.spawn_anchor) !== '[144,576]'
  || renderedCandidateQa.runtime_layout.exit_id !== 'exit-node'
  || !renderedCandidateQa.does_not_prove.includes('human or user art approval')
  || !renderedCandidateQa.does_not_prove.includes('Raspberry Pi 4B performance or rendering equivalence')
  || !renderedCandidateQa.does_not_prove.includes('hazard behavior or collision alignment for non-terrain gameplay roles')
) {
  throw new Error(`${renderedCandidateQaPath} does not prove the bounded rendered candidate.`);
}
const candidateRenderHashes = new Set();
const candidatePixelHashes = new Set();
for (const run of renderedCandidateQa.runs) {
  const bytes = await readFile(resolve(run.render_path));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (
    run.renderer !== 'gl_compatibility'
    || run.render_bytes !== bytes.length
    || run.render_sha256 !== hash
    || run.quantized_colors < 64
    || run.exit_reached !== 'exit-node'
    || run.slope_min_y > 548
    || run.slope_traversal !== 'pass'
    || run.wall_jump !== 'pass'
    || run.character_clips !== 12
    || run.character_frames !== 28
    || run.final_animation !== 'run_right'
  ) {
    throw new Error(`${run.render_path} does not match its rendered-candidate record.`);
  }
  candidateRenderHashes.add(hash);
  candidatePixelHashes.add(run.pixel_sha256);
}
if (candidateRenderHashes.size !== 1 || candidatePixelHashes.size !== 1) {
  throw new Error('Godot 4.3 and 4.7 rendered-candidate evidence is not stable on the recorded host.');
}
console.log(`MAPSOO_PRODUCTION_CANDIDATE_RENDER_EVIDENCE_OK versions=4.3,4.7 render=${[...candidateRenderHashes][0]} route=walk-slope-jump collisions=5 navigation=7/6`);
