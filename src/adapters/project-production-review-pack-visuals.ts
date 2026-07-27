import { decodeReferenceImageRgba } from './decode-reference-image-rgba';
import { encodeRgbaPng } from './canvas/encode-png';
import type { ProductionArtRunInventory } from './materialize-production-art-run-inventory';
import type {
  ProductionArtPlan,
  ProductionArtRoleMapping,
  ProductionArtTask,
} from '../core/production-art-contract';
import type { WorldAssetProfile } from '../core/asset-profile';
import type { Alpha9PackManifest } from '../core/pack-manifest-alpha9';
import type { Alpha10PackManifest } from '../core/pack-manifest-alpha10';
import type { Alpha11PackManifest } from '../core/pack-manifest-alpha11';

export type ProductionReviewPackProfile = Exclude<WorldAssetProfile, 'layered-depth-2d'>;
export type ProductionReviewBaseManifest =
  | Alpha9PackManifest
  | Alpha10PackManifest
  | Alpha11PackManifest;

interface RuntimeRegion {
  readonly role: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface RuntimeAtlasLayout {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly regions: readonly RuntimeRegion[];
}

interface ProfileLayout {
  readonly profile: ProductionReviewPackProfile;
  readonly atlases: readonly RuntimeAtlasLayout[];
}

export interface ProductionReviewProjectedFile {
  readonly path: string;
  readonly media_type: 'image/png';
  readonly bytes: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly roles: readonly string[];
  readonly source_task_ids: readonly string[];
  readBytes(): Uint8Array;
}

export interface ProductionReviewVisualProjection {
  readonly schema_version: '1.0.0';
  readonly document_type: 'production-art-runtime-projection';
  readonly plan_id: string;
  readonly profile: ProductionReviewPackProfile;
  readonly source_outputs: readonly Readonly<{
    task_id: string;
    sha256: string;
  }>[];
  readonly files: readonly ProductionReviewProjectedFile[];
  readonly review: Readonly<{
    human_art: 'required';
    rights: 'pending';
    runtime: 'pending';
    raspberry_pi: 'pending';
  }>;
}

export class ProductionReviewVisualProjectionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProductionReviewVisualProjectionError';
  }
}

const region = (
  role: string,
  index: number,
  width: number,
  height: number,
): RuntimeRegion => Object.freeze({ role, x: index * width, y: 0, width, height });

const PROFILE_LAYOUTS: Readonly<Record<ProductionReviewPackProfile, ProfileLayout>> = Object.freeze({
  'topdown-farm': {
    profile: 'topdown-farm',
    atlases: Object.freeze([
      {
        path: 'atlases/terrain.png',
        width: 128,
        height: 32,
        regions: Object.freeze([
          'terrain.ground',
          'terrain.water',
          'terrain.path',
          'terrain.soil',
        ].map((role, index) => region(role, index, 32, 32))),
      },
      {
        path: 'atlases/props.png',
        width: 192,
        height: 32,
        regions: Object.freeze([
          'prop.tree',
          'prop.rock',
          'prop.flower',
          'prop.fence',
          'prop.gate',
          'prop.crate',
        ].map((role, index) => region(role, index, 32, 32))),
      },
      {
        path: 'atlases/structures.png',
        width: 128,
        height: 64,
        regions: Object.freeze([
          'structure.house',
          'structure.barn',
        ].map((role, index) => region(role, index, 64, 64))),
      },
      {
        path: 'atlases/crops.png',
        width: 128,
        height: 32,
        regions: Object.freeze([
          'crop.basic.stage-1',
          'crop.basic.stage-2',
          'crop.basic.stage-3',
          'crop.basic.stage-4',
        ].map((role, index) => region(role, index, 32, 32))),
      },
    ]),
  },
  'side-platformer': {
    profile: 'side-platformer',
    atlases: Object.freeze([
      {
        path: 'atlases/platforms.png',
        width: 192,
        height: 64,
        regions: Object.freeze([
          'terrain.solid',
          'terrain.one-way',
          'terrain.slope-up',
          'terrain.slope-down',
          'terrain.wall',
          'terrain.ceiling',
        ].map((role, index) => region(role, index, 32, 32))),
      },
      {
        path: 'atlases/hazards.png',
        width: 96,
        height: 32,
        regions: Object.freeze([
          'hazard.spikes',
          'hazard.pit',
          'hazard.moving-platform',
        ].map((role, index) => region(role, index, 32, 32))),
      },
      {
        path: 'atlases/props.png',
        width: 192,
        height: 32,
        regions: Object.freeze([
          'prop.crate',
          'prop.rock',
          'prop.plant',
          'prop.sign',
          'prop.lamp',
          'prop.breakable',
        ].map((role, index) => region(role, index, 32, 32))),
      },
      {
        path: 'atlases/structures.png',
        width: 96,
        height: 64,
        regions: Object.freeze([
          'structure.entrance',
          'structure.exit',
          'structure.checkpoint',
        ].map((role, index) => region(role, index, 32, 64))),
      },
      {
        path: 'atlases/collectibles.png',
        width: 64,
        height: 32,
        regions: Object.freeze([
          'collectible.primary',
          'collectible.health',
        ].map((role, index) => region(role, index, 32, 32))),
      },
    ]),
  },
  'isometric-action': {
    profile: 'isometric-action',
    atlases: Object.freeze([
      {
        path: 'atlases/terrain.png',
        width: 576,
        height: 64,
        regions: Object.freeze([
          'terrain.void',
          'terrain.floor.base',
          'terrain.floor.variant',
          'terrain.floor.edge',
          'terrain.elevation.top',
          'terrain.elevation.riser-left',
          'terrain.elevation.riser-right',
          'terrain.ramp',
          'terrain.wall',
        ].map((role, index) => region(role, index, 64, 64))),
      },
      {
        path: 'atlases/hazards.png',
        width: 128,
        height: 64,
        regions: Object.freeze([
          'hazard.contact',
          'hazard.telegraph',
        ].map((role, index) => region(role, index, 64, 64))),
      },
      {
        path: 'atlases/props.png',
        width: 320,
        height: 96,
        regions: Object.freeze([
          'prop.blocker',
          'prop.breakable',
          'prop.cover',
          'prop.decoration',
          'prop.light',
        ].map((role, index) => region(role, index, 64, 96))),
      },
      {
        path: 'atlases/structures.png',
        width: 192,
        height: 96,
        regions: Object.freeze([
          'structure.entrance',
          'structure.exit',
          'structure.checkpoint',
        ].map((role, index) => region(role, index, 64, 96))),
      },
      {
        path: 'atlases/collectibles.png',
        width: 64,
        height: 32,
        regions: Object.freeze([
          'collectible.primary',
          'collectible.health',
        ].map((role, index) => region(role, index, 32, 32))),
      },
      {
        path: 'atlases/effects.png',
        width: 448,
        height: 64,
        regions: Object.freeze([
          'effect.player-attack',
          'effect.enemy-attack',
          'effect.projectile',
          'effect.impact',
          'effect.dash',
          'effect.spawn',
          'effect.defeat',
        ].map((role, index) => region(role, index, 64, 64))),
      },
      {
        path: 'atlases/shadows.png',
        width: 64,
        height: 32,
        regions: Object.freeze([region('effect.shadow', 0, 64, 32)]),
      },
    ]),
  },
});

function fail(code: string, message: string): never {
  throw new ProductionReviewVisualProjectionError(code, message);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function manifestRoles(manifest: ProductionReviewBaseManifest): readonly Readonly<{
  role: string;
  path: string;
}>[] {
  return manifest.roles;
}

function taskForRole(
  plan: ProductionArtPlan,
  role: string,
): Readonly<{ task: ProductionArtTask; mapping: ProductionArtRoleMapping }> {
  for (const task of plan.tasks) {
    const mapping = task.role_mappings.find((candidate) => candidate.role === role);
    if (mapping) return { task, mapping };
  }
  return fail('production-review.role-task', `No production task maps runtime role ${role}.`);
}

function crop(
  image: Readonly<{ width: number; height: number; rgba: Uint8Array }>,
  x: number,
  y: number,
  width: number,
  height: number,
): Readonly<{ width: number; height: number; rgba: Uint8Array }> {
  if (
    !Number.isSafeInteger(x)
    || !Number.isSafeInteger(y)
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || x < 0
    || y < 0
    || x + width > image.width
    || y + height > image.height
  ) {
    fail('production-review.crop', 'Production source crop is outside the normalized image.');
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = ((y + row) * image.width + x) * 4;
    rgba.set(
      image.rgba.subarray(sourceOffset, sourceOffset + width * 4),
      row * width * 4,
    );
  }
  return { width, height, rgba };
}

function resizeNearest(
  image: Readonly<{ width: number; height: number; rgba: Uint8Array }>,
  width: number,
  height: number,
): Readonly<{ width: number; height: number; rgba: Uint8Array }> {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor(y * image.height / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(x * image.width / width));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const targetOffset = (y * width + x) * 4;
      rgba.set(image.rgba.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return { width, height, rgba };
}

function composite(
  destination: Uint8Array,
  destinationWidth: number,
  image: Readonly<{ width: number; height: number; rgba: Uint8Array }>,
  x: number,
  y: number,
): void {
  for (let row = 0; row < image.height; row += 1) {
    destination.set(
      image.rgba.subarray(row * image.width * 4, (row + 1) * image.width * 4),
      ((y + row) * destinationWidth + x) * 4,
    );
  }
}

function assertPixelPolicy(
  task: ProductionArtTask,
  image: Readonly<{ rgba: Uint8Array }>,
): void {
  let visible = 0;
  let transparent = 0;
  for (let offset = 0; offset < image.rgba.byteLength; offset += 4) {
    const alpha = image.rgba[offset + 3];
    if (task.alpha_policy === 'opaque') {
      if (alpha !== 255) {
        fail('production-review.alpha', `Opaque task ${task.task_id} contains transparency.`);
      }
      visible += 1;
      continue;
    }
    if (alpha !== 0 && alpha !== 255) {
      fail('production-review.alpha', `Task ${task.task_id} contains partial alpha.`);
    }
    if (alpha === 0) {
      transparent += 1;
      if (image.rgba[offset] !== 0 || image.rgba[offset + 1] !== 0 || image.rgba[offset + 2] !== 0) {
        fail('production-review.transparent-rgb', `Task ${task.task_id} leaks RGB under transparency.`);
      }
    } else {
      visible += 1;
    }
  }
  if (visible === 0 || (task.alpha_policy === 'straight-alpha' && transparent === 0)) {
    fail('production-review.alpha-inventory', `Task ${task.task_id} has an invalid alpha inventory.`);
  }
}

function assertVisible(
  role: string,
  image: Readonly<{ rgba: Uint8Array }>,
): void {
  for (let offset = 3; offset < image.rgba.byteLength; offset += 4) {
    if (image.rgba[offset] > 0) return;
  }
  fail('production-review.empty-role', `Projected runtime role ${role} is empty.`);
}

function mappedCell(
  task: ProductionArtTask,
  mapping: ProductionArtRoleMapping,
  image: Readonly<{ width: number; height: number; rgba: Uint8Array }>,
): Readonly<{ width: number; height: number; rgba: Uint8Array }> {
  const rect = mapping.grid_rect;
  return crop(
    image,
    rect.column * task.target.cell_width,
    rect.row * task.target.cell_height,
    rect.column_span * task.target.cell_width,
    rect.row_span * task.target.cell_height,
  );
}

async function projectedFile(
  path: string,
  width: number,
  height: number,
  roles: readonly string[],
  sourceTaskIds: readonly string[],
  rgba: Uint8Array,
): Promise<ProductionReviewProjectedFile> {
  const png = encodeRgbaPng(width, height, rgba);
  const frozen = Uint8Array.from(png);
  return Object.freeze({
    path,
    media_type: 'image/png' as const,
    bytes: frozen.byteLength,
    sha256: await sha256(frozen),
    width,
    height,
    roles: Object.freeze([...roles]),
    source_task_ids: Object.freeze([...sourceTaskIds]),
    readBytes: () => Uint8Array.from(frozen),
  });
}

function characterRecords(manifest: ProductionReviewBaseManifest): readonly Readonly<{
  id: string;
  atlas: string;
  frame_size: readonly [number, number];
  clips: readonly Readonly<{
    action: string;
    direction: string;
    frames: readonly Readonly<{ x: number; y: number }>[];
  }>[];
}>[] {
  if ('characters' in manifest) return manifest.characters;
  return [manifest.character];
}

async function projectCharacter(
  plan: ProductionArtPlan,
  character: ReturnType<typeof characterRecords>[number],
  images: ReadonlyMap<string, Readonly<{ width: number; height: number; rgba: Uint8Array }>>,
  baseFiles: Readonly<Record<string, Uint8Array>>,
): Promise<ProductionReviewProjectedFile> {
  const role = `character.${character.id}.atlas`;
  const { task } = taskForRole(plan, role);
  if (!task.pose_mappings) {
    fail('production-review.character-poses', `Character task ${task.task_id} has no pose inventory.`);
  }
  const source = images.get(task.task_id);
  if (!source) fail('production-review.missing-task', `Missing decoded task ${task.task_id}.`);
  const baseBytes = baseFiles[character.atlas];
  if (!baseBytes) fail('production-review.base-file', `Base character atlas is missing: ${character.atlas}.`);
  const base = await decodeReferenceImageRgba(baseBytes, 'image/png');
  const [frameWidth, frameHeight] = character.frame_size;
  const rgba = new Uint8Array(base.width * base.height * 4);
  const occupied = new Set<string>();
  const frameDigests = new Set<string>();

  for (const clip of character.clips) {
    for (let frameIndex = 0; frameIndex < clip.frames.length; frameIndex += 1) {
      const target = clip.frames[frameIndex];
      const pose = task.pose_mappings.find((candidate) =>
        candidate.action === clip.action
        && candidate.direction === clip.direction
        && candidate.frame_index === frameIndex);
      if (!pose) {
        fail(
          'production-review.character-pose',
          `No production pose maps ${role}/${clip.action}/${clip.direction}/${frameIndex}.`,
        );
      }
      if (
        target.x < 0
        || target.y < 0
        || target.x + frameWidth > base.width
        || target.y + frameHeight > base.height
      ) {
        fail('production-review.character-frame', `Base character frame is outside ${character.atlas}.`);
      }
      const destinationKey = `${target.x},${target.y},${frameWidth},${frameHeight}`;
      if (occupied.has(destinationKey)) {
        fail('production-review.character-overlap', `Character frames overlap in ${character.atlas}.`);
      }
      occupied.add(destinationKey);
      const sourceCell = crop(
        source,
        pose.grid_cell.column * task.target.cell_width,
        pose.grid_cell.row * task.target.cell_height,
        task.target.cell_width,
        task.target.cell_height,
      );
      assertVisible(role, sourceCell);
      const resized = resizeNearest(sourceCell, frameWidth, frameHeight);
      const digest = await sha256(resized.rgba);
      if (frameDigests.has(digest)) {
        fail('production-review.character-duplicate', `Character runtime poses are duplicated in ${character.atlas}.`);
      }
      frameDigests.add(digest);
      composite(rgba, base.width, resized, target.x, target.y);
    }
  }
  return projectedFile(
    character.atlas,
    base.width,
    base.height,
    [role],
    [task.task_id],
    rgba,
  );
}

/**
 * Projects all non-runtime production roles into the exact PNG paths and
 * dimensions consumed by the existing Pack 0.6, 0.7 and 0.8 Godot importers.
 */
export async function projectProductionReviewPackVisuals(
  plan: ProductionArtPlan,
  inventory: ProductionArtRunInventory,
  manifest: ProductionReviewBaseManifest,
  baseFiles: Readonly<Record<string, Uint8Array>>,
): Promise<ProductionReviewVisualProjection> {
  if (plan.profile === 'layered-depth-2d') {
    fail('production-review.profile', 'Layered-depth uses the specialized Pack 1.0 projector.');
  }
  if (
    inventory.plan_id !== plan.plan_id
    || inventory.profile !== plan.profile
    || manifest.profile !== plan.profile
  ) {
    fail('production-review.binding', 'Plan, run inventory and base pack profile do not match.');
  }
  const layout = PROFILE_LAYOUTS[plan.profile];
  const images = new Map(await Promise.all(inventory.items.map(async (item) => {
    const bytes = item.normalized.readBytes();
    const image = await decodeReferenceImageRgba(bytes, 'image/png');
    assertPixelPolicy(item.task, image);
    return [item.task.task_id, image] as const;
  })));
  const files: ProductionReviewProjectedFile[] = [];
  const atlasRoles = new Set(layout.atlases.flatMap(({ regions }) =>
    regions.map(({ role }) => role)));

  for (const atlas of layout.atlases) {
    const base = baseFiles[atlas.path];
    if (!base) fail('production-review.base-file', `Base runtime atlas is missing: ${atlas.path}.`);
    const decodedBase = await decodeReferenceImageRgba(base, 'image/png');
    if (decodedBase.width !== atlas.width || decodedBase.height !== atlas.height) {
      fail('production-review.base-geometry', `Base runtime atlas geometry changed: ${atlas.path}.`);
    }
    const rgba = new Uint8Array(atlas.width * atlas.height * 4);
    const sourceTaskIds = new Set<string>();
    const roleDigests = new Set<string>();
    for (const destination of atlas.regions) {
      const { task, mapping } = taskForRole(plan, destination.role);
      const source = images.get(task.task_id);
      if (!source) fail('production-review.missing-task', `Missing decoded task ${task.task_id}.`);
      const cell = mappedCell(task, mapping, source);
      assertVisible(destination.role, cell);
      const resized = resizeNearest(cell, destination.width, destination.height);
      const digest = await sha256(resized.rgba);
      if (roleDigests.has(digest)) {
        fail('production-review.role-duplicate', `Runtime role pixels are duplicated in ${atlas.path}.`);
      }
      roleDigests.add(digest);
      composite(rgba, atlas.width, resized, destination.x, destination.y);
      sourceTaskIds.add(task.task_id);
    }
    files.push(await projectedFile(
      atlas.path,
      atlas.width,
      atlas.height,
      atlas.regions.map(({ role }) => role),
      [...sourceTaskIds],
      rgba,
    ));
  }

  for (const character of characterRecords(manifest)) {
    files.push(await projectCharacter(plan, character, images, baseFiles));
  }

  const characterRoles = new Set(characterRecords(manifest).map(({ id }) =>
    `character.${id}.atlas`));
  const roleBindings = new Map(manifestRoles(manifest).map(({ role, path }) => [role, path]));
  const remainingRoles = plan.tasks
    .flatMap(({ role_mappings: mappings }) => mappings.map(({ role }) => role))
    .filter((role) => !atlasRoles.has(role) && !characterRoles.has(role));
  const fullPathRoles = new Map<string, string[]>();
  for (const role of remainingRoles) {
    const path = roleBindings.get(role);
    if (!path) fail('production-review.role-path', `Base manifest omits production role ${role}.`);
    const roles = fullPathRoles.get(path) ?? [];
    roles.push(role);
    fullPathRoles.set(path, roles);
  }
  for (const [path, roles] of fullPathRoles) {
    if (roles.length !== 1) {
      fail('production-review.full-path-alias', `Full-frame production roles alias ${path}.`);
    }
    const role = roles[0];
    const { task, mapping } = taskForRole(plan, role);
    const source = images.get(task.task_id);
    const baseBytes = baseFiles[path];
    if (!source || !baseBytes) {
      fail('production-review.base-file', `Full-frame runtime path is missing: ${path}.`);
    }
    const base = await decodeReferenceImageRgba(baseBytes, 'image/png');
    const cell = mappedCell(task, mapping, source);
    const resized = resizeNearest(cell, base.width, base.height);
    files.push(await projectedFile(
      path,
      base.width,
      base.height,
      [role],
      [task.task_id],
      resized.rgba,
    ));
  }

  const expectedPaths = new Set(manifestRoles(manifest)
    .filter(({ role }) => plan.tasks.some(({ role_mappings: mappings }) =>
      mappings.some((mapping) => mapping.role === role)))
    .map(({ path }) => path));
  const actualPaths = new Set(files.map(({ path }) => path));
  if (
    expectedPaths.size !== actualPaths.size
    || [...expectedPaths].some((path) => !actualPaths.has(path))
    || files.length !== actualPaths.size
  ) {
    fail('production-review.file-inventory', 'Projected visual files do not exactly cover production roles.');
  }

  files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  return Object.freeze({
    schema_version: '1.0.0',
    document_type: 'production-art-runtime-projection',
    plan_id: plan.plan_id,
    profile: plan.profile,
    source_outputs: Object.freeze(inventory.items.map(({ task, output }) => Object.freeze({
      task_id: task.task_id,
      sha256: output.sha256,
    }))),
    files: Object.freeze(files),
    review: Object.freeze({
      human_art: 'required',
      rights: 'pending',
      runtime: 'pending',
      raspberry_pi: 'pending',
    }),
  });
}
