import {
  LAYERED_DEPTH_DIRECTIONS,
  LAYERED_DEPTH_NPC_ACTIONS,
  LAYERED_DEPTH_PLAYER_ACTIONS,
  LAYERED_DEPTH_REQUIRED_ROLES,
} from './layered-depth-asset-bundle';
import {
  validateWorldLayoutPackBinding,
  type WorldLayoutPackBinding,
} from './world-layout-pack-binding';
import {
  validateWorldMaterialPalettePackBinding,
  type WorldMaterialPalettePackBinding,
} from './world-material-palette';

export const PACK_1_0_SCHEMA_VERSION = '1.0.0-draft.1' as const;
export const PACK_1_0_PLANE_BINDINGS = Object.freeze([
  ['sky', 'background.sky'],
  ['far', 'background.far'],
  ['mid', 'background.mid'],
  ['depth-fog', 'background.depth-fog'],
  ['near', 'near.overlay'],
  ['ambient-light', 'lighting.ambient'],
  ['local-light', 'lighting.local'],
  ['foreground', 'foreground.overlay'],
] as const);

export type Pack10Distribution = 'internal-review' | 'private' | 'public';
export type Pack10ReviewGate = 'pending' | 'pass' | 'rejected';
export type Pack10MediaType =
  | 'image/png'
  | 'application/json'
  | 'application/schema+json'
  | 'text/markdown';
export type Pack10FrameProvenance =
  | 'independent-generated-pose'
  | 'declared-synthetic-variant'
  | 'artist-authored';

export interface Pack10FileRecord {
  readonly path: string;
  readonly media_type: Pack10MediaType;
  readonly bytes: number;
  readonly sha256: string;
}

export interface Pack10RoleBinding {
  readonly role: string;
  readonly binding:
    | Readonly<{ kind: 'file'; path: string }>
    | Readonly<{
      kind: 'atlas-region';
      atlas: string;
      region: Readonly<{ x: number; y: number; width: number; height: number }>;
    }>;
}

export interface Pack10Manifest {
  readonly schema_version: typeof PACK_1_0_SCHEMA_VERSION;
  readonly pack: Readonly<{
    id: string;
    title: string;
    version: string;
    generator: Readonly<{ name: 'Mapsoo Worldsmith'; version: string }>;
    created_at: string;
  }>;
  readonly profile: 'layered-depth-2d';
  readonly distribution: Pack10Distribution;
  readonly review: Readonly<{
    human_art: Pack10ReviewGate;
    rights: Pack10ReviewGate;
    runtime: Pack10ReviewGate;
    raspberry_pi: Pack10ReviewGate;
  }>;
  readonly compatibility: Readonly<{
    godot_min: string;
    projection: 'layered-depth-stage';
    art_style: 'pixel_art';
    importer: Readonly<{ id: 'mapsoo_importer'; min_version: string }>;
  }>;
  readonly planes: readonly Readonly<{
    id: string;
    role: string;
    path: string;
    layer: string;
    blend: 'mix' | 'add' | 'multiply';
  }>[];
  readonly atlases: readonly Readonly<{
    id: string;
    path: string;
    cell_size: readonly [number, number];
  }>[];
  readonly roles: readonly Pack10RoleBinding[];
  readonly characters: readonly Readonly<{
    id: string;
    atlas: string;
    frame_size: readonly [number, number];
    pivot: readonly [number, number];
    clips: readonly Readonly<{
      id: string;
      action: string;
      direction: string;
      frames: readonly Readonly<{
        x: number;
        y: number;
        duration_ms: number;
        provenance: Pack10FrameProvenance;
      }>[];
    }>[];
  }>[];
  readonly runtime: Readonly<{
    scene: Readonly<{ path: string }>;
    collision: Readonly<{ path: string }>;
    navigation: Readonly<{ path: string }>;
    spawn: Readonly<{ x: number; y: number }>;
  }>;
  readonly layout?: Readonly<WorldLayoutPackBinding>;
  readonly material_palette?: Readonly<WorldMaterialPalettePackBinding>;
  readonly files: readonly Pack10FileRecord[];
  readonly license: Readonly<{
    output: Readonly<{
      id: string;
      notice_path: string;
      permits_redistribution: boolean;
      permits_commercial_use: boolean;
    }>;
  }>;
  readonly provenance: Readonly<{
    output_provenance: 'procedural' | 'generative-ai' | 'hybrid' | 'artist-authored';
    contains_generative_ai: boolean;
    model_provider: string | null;
    model: string | null;
    human_curated: boolean;
    source_manifest_hashes: readonly string[];
  }>;
  readonly reference_policy: Readonly<{
    embedded: false;
    original_references_excluded: true;
    raw_prompts_excluded: true;
    only_one_way_audit_hashes_retained: true;
  }>;
}

export interface Pack10ManifestIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\)[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FORBIDDEN_PATH_SEGMENTS = new Set([
  'reference',
  'references',
  'source-reference',
  'source-references',
  'prompt',
  'prompts',
  'raw-prompt',
  'raw-prompts',
]);
const FORBIDDEN_SOURCE_KEYS = new Set([
  'reference',
  'references',
  'referencePath',
  'reference_path',
  'referenceHash',
  'reference_hash',
  'sourceReferenceIds',
  'source_reference_ids',
  'sourceReferencePath',
  'source_reference_path',
  'originalPath',
  'original_path',
  'originalHash',
  'original_hash',
  'sourceImage',
  'source_image',
  'prompt',
  'prompts',
  'rawPrompt',
  'raw_prompt',
  'generationPrompt',
  'generation_prompt',
]);
const MEDIA_TYPES = new Set<Pack10MediaType>([
  'image/png',
  'application/json',
  'application/schema+json',
  'text/markdown',
]);
const FRAME_PROVENANCE = new Set<Pack10FrameProvenance>([
  'independent-generated-pose',
  'declared-synthetic-variant',
  'artist-authored',
]);
const PUBLIC_OUTPUT_LICENSES = new Set([
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'MIT',
]);
const LICENSE_ID = /^(?:[A-Za-z0-9.+-]+|LicenseRef-[A-Za-z0-9.+-]+)$/;

function safePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 240
    && SAFE_PATH.test(value);
}

function safeInteger(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function forbiddenSourcePath(path: string): boolean {
  return path.split('/').some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment.toLowerCase()));
}

function scanForbiddenSourceFields(
  value: unknown,
  issues: Pack10ManifestIssue[],
  location = 'manifest',
): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenSourceFields(item, issues, `${location}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_SOURCE_KEYS.has(key)) {
      issues.push({
        code: 'privacy.source-material',
        message: `Pack 1.0 forbids source-reference and raw-prompt fields: ${key}.`,
        path: location,
      });
    }
    scanForbiddenSourceFields(child, issues, `${location}.${key}`);
  }
}

function addIssue(
  issues: Pack10ManifestIssue[],
  code: string,
  message: string,
  path?: string,
): void {
  issues.push(path === undefined ? { code, message } : { code, message, path });
}

/** Strict semantic validation layered on top of the Pack 1.0 JSON Schema draft. */
export function validatePack10Manifest(manifest: Pack10Manifest): Pack10ManifestIssue[] {
  const issues: Pack10ManifestIssue[] = [];
  scanForbiddenSourceFields(manifest, issues);

  if (manifest.schema_version !== PACK_1_0_SCHEMA_VERSION) {
    addIssue(issues, 'manifest.schema-version', 'Pack 1.0 must identify draft schema 1.0.0-draft.1.');
  }
  if (manifest.profile !== 'layered-depth-2d') {
    addIssue(issues, 'manifest.profile', 'This Pack 1.0 draft accepts only layered-depth-2d.');
  }
  if (!SAFE_ID.test(manifest.pack.id)
    || manifest.pack.generator.name !== 'Mapsoo Worldsmith'
    || manifest.pack.generator.version !== manifest.pack.version) {
    addIssue(issues, 'manifest.pack', 'Pack identity must be safe and generator version must match pack version.');
  }

  const files = new Map<string, Pack10FileRecord>();
  for (const file of manifest.files) {
    if (!safePath(file.path) || files.has(file.path)) {
      addIssue(issues, 'file.path', 'Files require unique safe relative paths.', file.path);
    }
    if (safePath(file.path) && forbiddenSourcePath(file.path)) {
      addIssue(
        issues,
        'privacy.source-material',
        'Source references and raw prompts must not be embedded in Pack files.',
        file.path,
      );
    }
    if (!MEDIA_TYPES.has(file.media_type)) {
      addIssue(issues, 'file.media-type', 'Pack file has an unsupported media type.', file.path);
    }
    if (!safeInteger(file.bytes, 1) || !SHA256.test(file.sha256)) {
      addIssue(issues, 'file.integrity', 'Pack files require a positive byte count and SHA-256.', file.path);
    }
    if (!files.has(file.path)) files.set(file.path, file);
  }
  const requireFile = (
    path: string,
    mediaType: Pack10MediaType | readonly Pack10MediaType[],
    code: string,
  ): Pack10FileRecord | undefined => {
    const file = files.get(path);
    const allowed = Array.isArray(mediaType) ? mediaType : [mediaType];
    if (!safePath(path) || !file) {
      addIssue(issues, 'file.missing-reference', 'Referenced Pack file is absent.', path);
    } else if (!(allowed as readonly Pack10MediaType[]).includes(file.media_type)) {
      addIssue(issues, code, `Referenced file has the wrong media type: ${file.media_type}.`, path);
    }
    return file;
  };

  const planePaths = new Set<string>();
  if (manifest.planes.length !== PACK_1_0_PLANE_BINDINGS.length) {
    addIssue(issues, 'manifest.planes', 'Pack 1.0 requires eight independent canonical planes.');
  }
  for (let index = 0; index < PACK_1_0_PLANE_BINDINGS.length; index += 1) {
    const plane = manifest.planes[index];
    const [expectedId, expectedRole] = PACK_1_0_PLANE_BINDINGS[index];
    if (!plane || plane.id !== expectedId || plane.role !== expectedRole) {
      addIssue(
        issues,
        'manifest.planes',
        `Plane ${index} must bind ${expectedId} to ${expectedRole}.`,
      );
      continue;
    }
    if (planePaths.has(plane.path)) {
      addIssue(issues, 'plane.alias', 'Every Pack 1.0 depth plane requires an independent file.', plane.path);
    }
    planePaths.add(plane.path);
    requireFile(plane.path, 'image/png', 'plane.media-type');
  }

  const atlases = new Map<string, Pack10Manifest['atlases'][number]>();
  const atlasPaths = new Set<string>();
  for (const atlas of manifest.atlases) {
    if (!SAFE_ID.test(atlas.id) || atlases.has(atlas.id) || atlasPaths.has(atlas.path)) {
      addIssue(issues, 'atlas.identity', 'Atlas IDs and file paths must be unique.', atlas.path);
    }
    if (!safeInteger(atlas.cell_size[0], 1, 8192)
      || !safeInteger(atlas.cell_size[1], 1, 8192)) {
      addIssue(issues, 'atlas.geometry', 'Atlas cell size must be bounded positive integers.', atlas.path);
    }
    if (!atlases.has(atlas.id)) atlases.set(atlas.id, atlas);
    atlasPaths.add(atlas.path);
    requireFile(atlas.path, 'image/png', 'atlas.media-type');
  }

  const roles = new Map<string, Pack10RoleBinding>();
  const regions = new Set<string>();
  for (const binding of manifest.roles) {
    if (roles.has(binding.role)) {
      addIssue(issues, 'role.duplicate', 'Role names must be unique.', binding.role);
    } else {
      roles.set(binding.role, binding);
    }
    if (binding.binding.kind === 'file') {
      requireFile(
        binding.binding.path,
        ['image/png', 'application/json'],
        'role.media-type',
      );
      if (binding.role.startsWith('terrain.')
        || binding.role.startsWith('prop.')
        || binding.role.startsWith('structure.')
        || binding.role.startsWith('collectible.')
        || binding.role.startsWith('effect.')) {
        addIssue(
          issues,
          'role.binding-kind',
          'Environment gameplay roles require explicit, independent atlas regions.',
          binding.role,
        );
      }
    } else {
      const atlas = atlases.get(binding.binding.atlas);
      const { x, y, width, height } = binding.binding.region;
      if (!atlas) {
        addIssue(issues, 'role.missing-atlas', 'Atlas-region binding references a missing atlas.', binding.role);
      }
      if (!safeInteger(x, 0, 131071)
        || !safeInteger(y, 0, 131071)
        || !safeInteger(width, 1, 8192)
        || !safeInteger(height, 1, 8192)
        || (atlas && (width > atlas.cell_size[0] || height > atlas.cell_size[1]))) {
        addIssue(issues, 'role.region', 'Role atlas region is invalid or larger than its atlas cell.', binding.role);
      }
      const regionKey = `${binding.binding.atlas}:${x},${y},${width},${height}`;
      if (regions.has(regionKey)) {
        addIssue(issues, 'role.alias', 'Pack 1.0 roles must not alias one physical atlas region.', binding.role);
      }
      regions.add(regionKey);
    }
  }
  const requiredRoles = LAYERED_DEPTH_REQUIRED_ROLES as readonly string[];
  for (const role of requiredRoles) {
    if (!roles.has(role)) {
      addIssue(issues, 'role.missing', `Required layered-depth role is absent: ${role}.`, role);
    }
  }
  for (const role of roles.keys()) {
    if (!requiredRoles.includes(role)) {
      addIssue(issues, 'role.unexpected', `Unexpected layered-depth role: ${role}.`, role);
    }
  }
  for (const [planeId, planeRole] of PACK_1_0_PLANE_BINDINGS) {
    const plane = manifest.planes.find(({ id }) => id === planeId);
    const binding = roles.get(planeRole)?.binding;
    if (!plane || binding?.kind !== 'file' || binding.path !== plane.path) {
      addIssue(issues, 'plane.role-binding', `Plane role ${planeRole} must bind its exact plane file.`, planeRole);
    }
  }

  const expectedCharacters = [
    { id: 'player', role: 'character.player.atlas', actions: LAYERED_DEPTH_PLAYER_ACTIONS },
    { id: 'npc', role: 'character.npc.atlas', actions: LAYERED_DEPTH_NPC_ACTIONS },
  ] as const;
  if (manifest.characters.length !== expectedCharacters.length) {
    addIssue(issues, 'character.count', 'Pack 1.0 requires exactly one player and one NPC.');
  }
  for (const expected of expectedCharacters) {
    const character = manifest.characters.find(({ id }) => id === expected.id);
    if (!character) {
      addIssue(issues, 'character.missing', `Required character is absent: ${expected.id}.`);
      continue;
    }
    const atlas = [...atlases.values()].find(({ path }) => path === character.atlas);
    const roleBinding = roles.get(expected.role)?.binding;
    if (!atlas
      || roleBinding?.kind !== 'file'
      || roleBinding.path !== character.atlas
      || requireFile(character.atlas, 'image/png', 'character.media-type') === undefined) {
      addIssue(issues, 'character.atlas', `${expected.id} must reference its declared PNG atlas.`);
    }
    if (character.frame_size[0] !== 48
      || character.frame_size[1] !== 72
      || character.pivot[0] !== 24
      || character.pivot[1] !== 67
      || (atlas && (atlas.cell_size[0] !== 48 || atlas.cell_size[1] !== 72))) {
      addIssue(issues, 'character.geometry', 'Characters require 48x72 frames and pivot 24,67.');
    }
    const clips = new Map<string, typeof character.clips[number]>();
    const characterFrameOrigins = new Set<string>();
    for (const clip of character.clips) {
      const expectedClipId = `${clip.action}.${clip.direction}`;
      if (clip.id !== expectedClipId || clips.has(clip.id)) {
        addIssue(issues, 'character.clip', 'Clip IDs must be unique action.direction bindings.', clip.id);
      } else {
        clips.set(clip.id, clip);
      }
      if (!(expected.actions as readonly string[]).includes(clip.action)
        || !(LAYERED_DEPTH_DIRECTIONS as readonly string[]).includes(clip.direction)
        || clip.frames.length < 2
        || clip.frames.length > 64) {
        addIssue(issues, 'character.clip', 'Clip action, direction or multi-frame inventory is invalid.', clip.id);
      }
      const frameOrigins = new Set<string>();
      for (const frame of clip.frames) {
        const key = `${frame.x},${frame.y}`;
        if (!safeInteger(frame.x, 0, 131071)
          || !safeInteger(frame.y, 0, 131071)
          || frame.x % character.frame_size[0] !== 0
          || frame.y % character.frame_size[1] !== 0
          || !safeInteger(frame.duration_ms, 16, 10000)
          || !FRAME_PROVENANCE.has(frame.provenance)
          || frameOrigins.has(key)
          || characterFrameOrigins.has(key)) {
          addIssue(issues, 'character.frame', 'Frame coordinates, duration, provenance and identity must be valid.', clip.id);
          break;
        }
        frameOrigins.add(key);
        characterFrameOrigins.add(key);
      }
    }
    for (const action of expected.actions) {
      for (const direction of LAYERED_DEPTH_DIRECTIONS) {
        const clipId = `${action}.${direction}`;
        if (!clips.has(clipId)) {
          addIssue(issues, 'character.missing-clip', `Required clip is absent: ${expected.id}/${clipId}.`);
        }
      }
    }
  }

  const worldFileBindings = [
    ['world.scene', manifest.runtime.scene.path, 'application/json'],
    ['world.collision', manifest.runtime.collision.path, 'application/json'],
    ['world.navigation', manifest.runtime.navigation.path, 'application/json'],
  ] as const;
  for (const [role, path, mediaType] of worldFileBindings) {
    requireFile(path, mediaType, 'runtime.media-type');
    const binding = roles.get(role)?.binding;
    if (binding?.kind !== 'file' || binding.path !== path) {
      addIssue(issues, 'runtime.role-binding', `${role} must bind its exact runtime sidecar.`, role);
    }
  }
  issues.push(...validateWorldLayoutPackBinding(manifest.layout, manifest.files));
  issues.push(...validateWorldMaterialPalettePackBinding(
    manifest.material_palette,
    manifest.layout,
    manifest.files,
  ));
  const previewBinding = roles.get('world.preview')?.binding;
  if (previewBinding?.kind !== 'file') {
    addIssue(issues, 'preview.role-binding', 'world.preview must bind a PNG file.');
  } else {
    requireFile(previewBinding.path, 'image/png', 'preview.media-type');
  }

  requireFile(manifest.license.output.notice_path, 'text/markdown', 'license.notice');
  const outputLicense = manifest.license.output;
  if (!LICENSE_ID.test(outputLicense.id)) {
    addIssue(issues, 'license.id', 'Output license must be an SPDX-like ID or explicit LicenseRef.');
  }
  if (manifest.distribution === 'internal-review') {
    if (outputLicense.id !== 'LicenseRef-UNRELEASED'
      || outputLicense.permits_redistribution
      || outputLicense.permits_commercial_use) {
      addIssue(
        issues,
        'authorization.internal-review',
        'Internal review must remain UNRELEASED, non-redistributable and non-commercial.',
      );
    }
  } else if (manifest.distribution === 'private') {
    if (manifest.review.human_art !== 'pass'
      || manifest.review.rights !== 'pass'
      || manifest.review.runtime !== 'pass'
      || outputLicense.id === 'LicenseRef-UNRELEASED'
      || outputLicense.permits_redistribution) {
      addIssue(
        issues,
        'authorization.private',
        'Private distribution requires human, rights and runtime approval plus an explicit non-redistributable license.',
      );
    }
  } else if (manifest.distribution === 'public') {
    if (Object.values(manifest.review).some((gate) => gate !== 'pass')
      || !PUBLIC_OUTPUT_LICENSES.has(outputLicense.id)
      || !outputLicense.permits_redistribution
      || !outputLicense.permits_commercial_use
      || (manifest.provenance.contains_generative_ai && !manifest.provenance.human_curated)) {
      addIssue(
        issues,
        'authorization.public',
        'Public distribution requires every review gate, redistribution rights and human curation for generative output.',
      );
    }
  } else {
    addIssue(issues, 'authorization.distribution', 'Unknown Pack 1.0 distribution mode.');
  }

  const referencePolicy = manifest.reference_policy;
  if (referencePolicy.embedded !== false
    || referencePolicy.original_references_excluded !== true
    || referencePolicy.raw_prompts_excluded !== true
    || referencePolicy.only_one_way_audit_hashes_retained !== true) {
    addIssue(
      issues,
      'privacy.reference-policy',
      'Pack 1.0 must exclude original references and raw prompts, retaining only one-way audit hashes.',
    );
  }
  if (manifest.provenance.source_manifest_hashes.length < 1
    || new Set(manifest.provenance.source_manifest_hashes).size
      !== manifest.provenance.source_manifest_hashes.length
    || manifest.provenance.source_manifest_hashes.some((hash) => !SHA256.test(hash))) {
    addIssue(issues, 'provenance.hashes', 'Source manifest audit hashes must be unique SHA-256 values.');
  }
  if ((manifest.provenance.contains_generative_ai
    && !['generative-ai', 'hybrid'].includes(manifest.provenance.output_provenance))
    || (!manifest.provenance.contains_generative_ai
      && ['generative-ai', 'hybrid'].includes(manifest.provenance.output_provenance))) {
    addIssue(
      issues,
      'provenance.ai-consistency',
      'Generative-AI disclosure must agree with output provenance.',
    );
  }
  if (manifest.provenance.contains_generative_ai
    && manifest.distribution === 'public'
    && (!manifest.provenance.model_provider?.trim() || !manifest.provenance.model?.trim())) {
    addIssue(
      issues,
      'provenance.model',
      'Public generative output must disclose its model provider and model.',
    );
  }
  return issues;
}

export function assertPack10Manifest(manifest: Pack10Manifest): void {
  const issues = validatePack10Manifest(manifest);
  if (issues.length > 0) {
    throw new Error(`Invalid Pack 1.0 manifest: ${issues.map(({ code }) => code).join(', ')}.`);
  }
}
