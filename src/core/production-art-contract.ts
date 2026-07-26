import {
  TOPDOWN_FARM_REQUIRED_ROLES,
  type CharacterAction,
  type CharacterDirection,
} from './generated-asset-bundle';
import {
  SIDE_PLATFORMER_ACTIONS,
  SIDE_PLATFORMER_DIRECTIONS,
  SIDE_PLATFORMER_REQUIRED_ROLES,
} from './side-platformer-asset-bundle';
import {
  ISOMETRIC_ACTION_DIRECTIONS,
  ISOMETRIC_ENEMY_ACTIONS,
  ISOMETRIC_PLAYER_ACTIONS,
  ISOMETRIC_ACTION_REQUIRED_ROLES,
} from './isometric-action-asset-bundle';
import {
  LAYERED_DEPTH_DIRECTIONS,
  LAYERED_DEPTH_NPC_ACTIONS,
  LAYERED_DEPTH_PLAYER_ACTIONS,
  LAYERED_DEPTH_REQUIRED_ROLES,
} from './layered-depth-asset-bundle';
import {
  isWorldAssetProfile,
  type WorldAssetProfile,
} from './asset-profile';

export const PRODUCTION_ART_CONTRACT_VERSION = '1.0.0' as const;

export const PRODUCTION_ART_TASK_KINDS = Object.freeze([
  'scene-direction',
  'opaque-tile-sheet',
  'transparent-prop-sheet',
  'character-animation-sheet',
  'background-layer',
  'effect-sheet',
] as const);
export type ProductionArtTaskKind = typeof PRODUCTION_ART_TASK_KINDS[number];

export const PRODUCTION_ART_ALPHA_POLICIES = Object.freeze([
  'opaque',
  'straight-alpha',
] as const);
export type ProductionArtAlphaPolicy = typeof PRODUCTION_ART_ALPHA_POLICIES[number];

export const PRODUCTION_ART_SEAM_POLICIES = Object.freeze([
  'none',
  'tileable-cells',
  'transparent-cell-padding',
  'horizontal-parallax',
] as const);
export type ProductionArtSeamPolicy = typeof PRODUCTION_ART_SEAM_POLICIES[number];

export const PRODUCTION_ART_DISTRIBUTIONS = Object.freeze([
  'private',
  'internal-review',
  'public',
] as const);
export type ProductionArtDistribution = typeof PRODUCTION_ART_DISTRIBUTIONS[number];

export const PRODUCTION_ART_LICENSES = Object.freeze([
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'LicenseRef-Proprietary',
] as const);
export type ProductionArtLicense = typeof PRODUCTION_ART_LICENSES[number];

export interface ProductionArtRights {
  readonly distribution: ProductionArtDistribution;
  readonly license: ProductionArtLicense;
  readonly attribution?: string;
}

export interface ProductionArtGridRect {
  readonly column: number;
  readonly row: number;
  readonly column_span: number;
  readonly row_span: number;
}

export interface ProductionArtRoleMapping {
  readonly role: string;
  readonly grid_rect: ProductionArtGridRect;
}

export interface ProductionArtPoseMapping {
  readonly role: string;
  readonly action: CharacterAction;
  readonly direction: CharacterDirection;
  readonly frame_index: number;
  readonly duration_ms: number;
  readonly grid_cell: {
    readonly column: number;
    readonly row: number;
  };
}

export interface ProductionArtTarget {
  readonly width: number;
  readonly height: number;
  readonly cell_width: number;
  readonly cell_height: number;
}

export interface ProductionArtPivot {
  readonly x: number;
  readonly y: number;
  readonly unit: 'pixels';
}

export interface ProductionArtTask {
  readonly task_id: string;
  readonly kind: ProductionArtTaskKind;
  readonly expected_output_path: string;
  readonly target: ProductionArtTarget;
  readonly alpha_policy: ProductionArtAlphaPolicy;
  readonly seam_policy: ProductionArtSeamPolicy;
  readonly pivot: ProductionArtPivot;
  readonly reference_roles: readonly ('environment-style' | 'character')[];
  readonly role_mappings: readonly ProductionArtRoleMapping[];
  readonly pose_mappings?: readonly ProductionArtPoseMapping[];
  readonly prompt: string;
  readonly negative_constraints: readonly string[];
}

export interface ProductionArtPlan {
  readonly schema_version: typeof PRODUCTION_ART_CONTRACT_VERSION;
  readonly document_type: 'production-art-plan';
  readonly plan_id: string;
  readonly profile: WorldAssetProfile;
  readonly rights: ProductionArtRights;
  readonly tasks: readonly ProductionArtTask[];
}

export interface ProductionArtOutput {
  readonly schema_version: typeof PRODUCTION_ART_CONTRACT_VERSION;
  readonly document_type: 'production-art-output';
  readonly plan_id: string;
  readonly profile: WorldAssetProfile;
  readonly task_id: string;
  readonly asset_id: string;
  readonly path: string;
  readonly media_type: 'image/png';
  readonly bytes: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly alpha_policy: ProductionArtAlphaPolicy;
  readonly pivot: ProductionArtPivot;
  readonly roles: readonly string[];
  readonly source_reference_ids: readonly string[];
  readonly rights: ProductionArtRights;
}

export interface ProductionArtIssue {
  readonly code: string;
  readonly message: string;
  readonly task_id?: string;
  readonly role?: string;
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_REFERENCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const RUNTIME_ROLES = new Set(['world.collision', 'world.navigation', 'world.scene']);
const NEGATIVE_CONSTRAINTS = Object.freeze([
  'No text, logo, watermark, signature, or user interface.',
  'No copyrighted character, franchise likeness, or imitation of a named commercial game.',
  'Keep one coherent palette, material language, outline treatment, and pixel density.',
] as const);

const PROFILE_LABELS: Readonly<Record<WorldAssetProfile, string>> = Object.freeze({
  'side-platformer': 'original side-view platform world',
  'topdown-farm': 'original orthogonal top-down farm world',
  'isometric-action': 'original diamond-grid isometric action world',
  'layered-depth-2d': 'original shallow-depth layered 2D exploration world',
});

function safeRelativePath(path: string): boolean {
  return path.length > 0
    && path.length <= 240
    && SAFE_PATH.test(path)
    && !path.includes('\\')
    && !path.startsWith('/')
    && !/^[A-Za-z]:/.test(path)
    && path.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function requiredRoles(profile: WorldAssetProfile): readonly string[] {
  if (profile === 'side-platformer') return SIDE_PLATFORMER_REQUIRED_ROLES;
  if (profile === 'topdown-farm') return TOPDOWN_FARM_REQUIRED_ROLES;
  if (profile === 'isometric-action') return ISOMETRIC_ACTION_REQUIRED_ROLES;
  return LAYERED_DEPTH_REQUIRED_ROLES;
}

export function requiredProductionArtRoles(profile: WorldAssetProfile): readonly string[] {
  return Object.freeze(requiredRoles(profile).filter((role) => !RUNTIME_ROLES.has(role)));
}

function roleCategory(role: string): 'preview' | 'tile' | 'prop' | 'character' | 'background' | 'effect' {
  if (role === 'world.preview') return 'preview';
  if (role.startsWith('terrain.')) return 'tile';
  if (role.startsWith('character.')) return 'character';
  if (role.startsWith('background.')
    || role.startsWith('foreground.')
    || role.startsWith('near.')
    || role.startsWith('lighting.')) return 'background';
  if (role.startsWith('effect.')) return 'effect';
  return 'prop';
}

function expectedTaskKind(role: string): ProductionArtTaskKind {
  const category = roleCategory(role);
  if (category === 'preview') return 'scene-direction';
  if (category === 'tile') return 'opaque-tile-sheet';
  if (category === 'prop') return 'transparent-prop-sheet';
  if (category === 'character') return 'character-animation-sheet';
  if (category === 'background') return 'background-layer';
  return 'effect-sheet';
}

function gridMappings(
  roles: readonly string[],
  columns: number,
  rows: number,
  fullSheet = false,
): readonly ProductionArtRoleMapping[] {
  return Object.freeze(roles.map((role, index) => Object.freeze({
    role,
    grid_rect: Object.freeze(fullSheet
      ? { column: 0, row: 0, column_span: columns, row_span: rows }
      : { column: index % columns, row: Math.floor(index / columns), column_span: 1, row_span: 1 }),
  })));
}

interface TaskGeometry {
  readonly width: number;
  readonly height: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly pivotX: number;
  readonly pivotY: number;
}

const TOPDOWN_PRODUCTION_ACTIONS = Object.freeze([
  'idle', 'walk',
] as const satisfies readonly CharacterAction[]);
const TOPDOWN_PRODUCTION_DIRECTIONS = Object.freeze([
  'north', 'east', 'south', 'west',
] as const satisfies readonly CharacterDirection[]);

interface CharacterAnimationSpec {
  readonly actions: readonly CharacterAction[];
  readonly directions: readonly CharacterDirection[];
}

function characterAnimationSpec(
  profile: WorldAssetProfile,
  role: string,
): CharacterAnimationSpec | undefined {
  if (profile === 'side-platformer' && role === 'character.player.atlas') {
    return { actions: SIDE_PLATFORMER_ACTIONS, directions: SIDE_PLATFORMER_DIRECTIONS };
  }
  if (profile === 'topdown-farm' && role === 'character.player.atlas') {
    return { actions: TOPDOWN_PRODUCTION_ACTIONS, directions: TOPDOWN_PRODUCTION_DIRECTIONS };
  }
  if (profile === 'isometric-action' && role === 'character.player.atlas') {
    return { actions: ISOMETRIC_PLAYER_ACTIONS, directions: ISOMETRIC_ACTION_DIRECTIONS };
  }
  if (
    profile === 'isometric-action'
    && (role === 'character.enemy-melee.atlas' || role === 'character.enemy-ranged.atlas')
  ) {
    return { actions: ISOMETRIC_ENEMY_ACTIONS, directions: ISOMETRIC_ACTION_DIRECTIONS };
  }
  if (profile === 'layered-depth-2d' && role === 'character.player.atlas') {
    return { actions: LAYERED_DEPTH_PLAYER_ACTIONS, directions: LAYERED_DEPTH_DIRECTIONS };
  }
  if (profile === 'layered-depth-2d' && role === 'character.npc.atlas') {
    return { actions: LAYERED_DEPTH_NPC_ACTIONS, directions: LAYERED_DEPTH_DIRECTIONS };
  }
  return undefined;
}

function productionFrameCount(profile: WorldAssetProfile, action: CharacterAction): number {
  if (profile === 'side-platformer' && action === 'run') return 4;
  if (profile === 'topdown-farm' && action === 'walk') return 4;
  return 2;
}

function productionFrameDuration(action: CharacterAction): number {
  if (action === 'idle' || action === 'talk') return 250;
  if (action === 'walk' || action === 'interact') return 150;
  if (action === 'run' || action === 'move') return 100;
  if (action === 'attack-primary' || action === 'dash') return 80;
  if (action === 'defeat') return 180;
  return 120;
}

function characterPoseMappings(
  profile: WorldAssetProfile,
  role: string,
  geometry: TaskGeometry,
): readonly ProductionArtPoseMapping[] {
  const spec = characterAnimationSpec(profile, role);
  if (!spec) return Object.freeze([]);
  const columns = geometry.width / geometry.cellWidth;
  const rows = geometry.height / geometry.cellHeight;
  const framesPerRow = Math.floor(columns / spec.directions.length);
  if (framesPerRow < 1) {
    throw new Error(`Character production grid is too narrow for ${profile}/${role}.`);
  }
  const mappings: ProductionArtPoseMapping[] = [];
  let row = 0;
  for (const action of spec.actions) {
    const frameCount = productionFrameCount(profile, action);
    for (let frameStart = 0; frameStart < frameCount; frameStart += framesPerRow) {
      const frameEnd = Math.min(frameStart + framesPerRow, frameCount);
      for (let frameIndex = frameStart; frameIndex < frameEnd; frameIndex += 1) {
        for (let directionIndex = 0; directionIndex < spec.directions.length; directionIndex += 1) {
          mappings.push(Object.freeze({
            role,
            action,
            direction: spec.directions[directionIndex],
            frame_index: frameIndex,
            duration_ms: productionFrameDuration(action),
            grid_cell: Object.freeze({
              column: (frameIndex - frameStart) * spec.directions.length + directionIndex,
              row,
            }),
          }));
        }
      }
      row += 1;
    }
  }
  if (row > rows) {
    throw new Error(`Character production grid is too short for ${profile}/${role}.`);
  }
  return Object.freeze(mappings);
}

function profileGeometry(profile: WorldAssetProfile): Readonly<Record<'tile' | 'prop' | 'character' | 'effect', TaskGeometry>> {
  if (profile === 'side-platformer') {
    return {
      tile: { width: 384, height: 192, cellWidth: 48, cellHeight: 48, pivotX: 24, pivotY: 48 },
      prop: { width: 512, height: 512, cellWidth: 64, cellHeight: 64, pivotX: 32, pivotY: 64 },
      character: { width: 1024, height: 768, cellWidth: 128, cellHeight: 128, pivotX: 64, pivotY: 120 },
      effect: { width: 512, height: 512, cellWidth: 64, cellHeight: 64, pivotX: 32, pivotY: 32 },
    };
  }
  if (profile === 'topdown-farm') {
    return {
      tile: { width: 256, height: 128, cellWidth: 32, cellHeight: 32, pivotX: 16, pivotY: 32 },
      prop: { width: 512, height: 512, cellWidth: 64, cellHeight: 64, pivotX: 32, pivotY: 60 },
      character: { width: 1024, height: 768, cellWidth: 128, cellHeight: 128, pivotX: 64, pivotY: 120 },
      effect: { width: 512, height: 512, cellWidth: 64, cellHeight: 64, pivotX: 32, pivotY: 32 },
    };
  }
  if (profile === 'isometric-action') {
    return {
      tile: { width: 768, height: 384, cellWidth: 96, cellHeight: 48, pivotX: 48, pivotY: 48 },
      prop: { width: 768, height: 768, cellWidth: 96, cellHeight: 96, pivotX: 48, pivotY: 88 },
      character: { width: 1536, height: 1536, cellWidth: 192, cellHeight: 128, pivotX: 96, pivotY: 120 },
      effect: { width: 768, height: 512, cellWidth: 96, cellHeight: 64, pivotX: 48, pivotY: 32 },
    };
  }
  return {
    tile: { width: 512, height: 256, cellWidth: 64, cellHeight: 64, pivotX: 32, pivotY: 64 },
    prop: { width: 768, height: 768, cellWidth: 96, cellHeight: 96, pivotX: 48, pivotY: 88 },
    character: { width: 1024, height: 1152, cellWidth: 128, cellHeight: 192, pivotX: 64, pivotY: 180 },
    effect: { width: 512, height: 512, cellWidth: 64, cellHeight: 64, pivotX: 32, pivotY: 32 },
  };
}

export function requiredProductionCharacterPoseMappings(
  profile: WorldAssetProfile,
  role: string,
): readonly ProductionArtPoseMapping[] {
  return characterPoseMappings(profile, role, profileGeometry(profile).character);
}

function slugRole(role: string): string {
  return role.replaceAll('.', '-');
}

function makeTask(
  profile: WorldAssetProfile,
  taskId: string,
  kind: ProductionArtTaskKind,
  roles: readonly string[],
  geometry: TaskGeometry,
  alphaPolicy: ProductionArtAlphaPolicy,
  seamPolicy: ProductionArtSeamPolicy,
  referenceRoles: readonly ('environment-style' | 'character')[],
): ProductionArtTask {
  const columns = geometry.width / geometry.cellWidth;
  const rows = geometry.height / geometry.cellHeight;
  const fullSheet = kind === 'scene-direction' || kind === 'background-layer' || kind === 'character-animation-sheet';
  return Object.freeze({
    task_id: taskId,
    kind,
    expected_output_path: `production-art/${profile}/${taskId}.png`,
    target: Object.freeze({
      width: geometry.width,
      height: geometry.height,
      cell_width: geometry.cellWidth,
      cell_height: geometry.cellHeight,
    }),
    alpha_policy: alphaPolicy,
    seam_policy: seamPolicy,
    pivot: Object.freeze({ x: geometry.pivotX, y: geometry.pivotY, unit: 'pixels' as const }),
    reference_roles: Object.freeze([...referenceRoles]),
    role_mappings: gridMappings(roles, columns, rows, fullSheet),
    prompt: `Create a production source image for an ${PROFILE_LABELS[profile]}. Task: ${kind}. `
      + `Respect the declared ${columns} by ${rows} grid exactly, populate only mapped cells, `
      + 'and preserve the declared role order. '
      + 'Use an original, internally consistent art direction suitable for deterministic Godot post-processing.',
    negative_constraints: NEGATIVE_CONSTRAINTS,
  });
}

function backgroundTask(profile: WorldAssetProfile, role: string): ProductionArtTask {
  return makeTask(
    profile,
    `background-${slugRole(role)}`,
    'background-layer',
    [role],
    { width: 1920, height: 1080, cellWidth: 1920, cellHeight: 1080, pivotX: 0, pivotY: 0 },
    role === 'background.sky' ? 'opaque' : 'straight-alpha',
    'horizontal-parallax',
    ['environment-style'],
  );
}

function characterTask(profile: WorldAssetProfile, role: string, geometry: TaskGeometry): ProductionArtTask {
  const base = makeTask(
    profile,
    `character-${slugRole(role)}`,
    'character-animation-sheet',
    [role],
    geometry,
    'straight-alpha',
    'transparent-cell-padding',
    ['environment-style', 'character'],
  );
  const poseMappings = characterPoseMappings(profile, role, geometry);
  return Object.freeze({
    ...base,
    pose_mappings: poseMappings,
    prompt: `${base.prompt} Populate only the ${poseMappings.length} declared semantic pose cells, `
      + 'with independently rendered model-native frames; keep every undeclared cell empty.',
  });
}

export function createProductionArtPlan(
  profile: WorldAssetProfile,
  rights: ProductionArtRights,
): ProductionArtPlan {
  const roles = requiredProductionArtRoles(profile);
  const geometry = profileGeometry(profile);
  const byCategory = (category: ReturnType<typeof roleCategory>) => roles.filter((role) => roleCategory(role) === category);
  const tasks: ProductionArtTask[] = [
    makeTask(
      profile,
      'scene-direction',
      'scene-direction',
      byCategory('preview'),
      { width: 1536, height: 1024, cellWidth: 1536, cellHeight: 1024, pivotX: 0, pivotY: 0 },
      'opaque',
      'none',
      ['environment-style', 'character'],
    ),
    makeTask(
      profile,
      'terrain-sheet',
      'opaque-tile-sheet',
      byCategory('tile'),
      geometry.tile,
      'straight-alpha',
      'tileable-cells',
      ['environment-style'],
    ),
    makeTask(
      profile,
      'prop-sheet',
      'transparent-prop-sheet',
      byCategory('prop'),
      geometry.prop,
      'straight-alpha',
      'transparent-cell-padding',
      ['environment-style'],
    ),
    ...byCategory('character').map((role) => characterTask(profile, role, geometry.character)),
    ...byCategory('background').map((role) => backgroundTask(profile, role)),
  ];
  const effects = byCategory('effect');
  if (effects.length > 0) {
    tasks.push(makeTask(
      profile,
      'effect-sheet',
      'effect-sheet',
      effects,
      geometry.effect,
      'straight-alpha',
      'transparent-cell-padding',
      ['environment-style'],
    ));
  }
  return Object.freeze({
    schema_version: PRODUCTION_ART_CONTRACT_VERSION,
    document_type: 'production-art-plan',
    plan_id: `${profile}-production-art-v1`,
    profile,
    rights: Object.freeze({ ...rights }),
    tasks: Object.freeze(tasks),
  });
}

function validateRights(rights: ProductionArtRights, issues: ProductionArtIssue[], taskId?: string): void {
  if (!PRODUCTION_ART_DISTRIBUTIONS.includes(rights.distribution)
    || !PRODUCTION_ART_LICENSES.includes(rights.license)) {
    issues.push({ code: 'rights.invalid', message: 'Distribution and license must use supported values.', task_id: taskId });
  }
  if (rights.distribution === 'public' && rights.license === 'LicenseRef-Proprietary') {
    issues.push({ code: 'rights.public-proprietary', message: 'Public output cannot use the proprietary license marker.', task_id: taskId });
  }
  if ((rights.license === 'CC-BY-4.0' || rights.license === 'CC-BY-SA-4.0')
    && (!rights.attribution || rights.attribution.trim() !== rights.attribution || rights.attribution.length > 500)) {
    issues.push({ code: 'rights.attribution', message: 'Attribution licenses require bounded, trimmed attribution text.', task_id: taskId });
  }
  if (rights.attribution !== undefined
    && (rights.attribution.length < 1 || rights.attribution.length > 500 || rights.attribution.trim() !== rights.attribution)) {
    issues.push({ code: 'rights.attribution', message: 'Attribution text must be non-empty, bounded, and trimmed.', task_id: taskId });
  }
}

export function validateProductionArtPlan(plan: ProductionArtPlan): ProductionArtIssue[] {
  const issues: ProductionArtIssue[] = [];
  if (plan.schema_version !== PRODUCTION_ART_CONTRACT_VERSION || plan.document_type !== 'production-art-plan') {
    issues.push({ code: 'plan.schema', message: 'Production art plan schema or document type is unsupported.' });
  }
  if (!SAFE_ID.test(plan.plan_id) || plan.plan_id.length > 100) {
    issues.push({ code: 'plan.id', message: 'Plan id must be a bounded safe identifier.' });
  }
  validateRights(plan.rights, issues);
  if (!isWorldAssetProfile(plan.profile)) {
    issues.push({ code: 'plan.profile', message: 'Production art profile is unsupported.' });
    return issues;
  }
  const expectedRoles = new Set(requiredProductionArtRoles(plan.profile));
  const mappedRoles = new Set<string>();
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const task of plan.tasks) {
    if (!SAFE_ID.test(task.task_id) || task.task_id.length > 100 || ids.has(task.task_id)) {
      issues.push({ code: 'task.id', message: 'Task ids must be unique bounded safe identifiers.', task_id: task.task_id });
    }
    ids.add(task.task_id);
    if (!PRODUCTION_ART_TASK_KINDS.includes(task.kind)) {
      issues.push({ code: 'task.kind', message: 'Production art task kind is unsupported.', task_id: task.task_id });
    }
    if (!safeRelativePath(task.expected_output_path) || paths.has(task.expected_output_path) || !task.expected_output_path.endsWith('.png')) {
      issues.push({ code: 'task.path', message: 'Expected output path must be a unique safe PNG path.', task_id: task.task_id });
    }
    paths.add(task.expected_output_path);
    const { width, height, cell_width: cellWidth, cell_height: cellHeight } = task.target;
    if (!integer(width, 1, 8192) || !integer(height, 1, 8192)
      || !integer(cellWidth, 1, 2048) || !integer(cellHeight, 1, 2048)
      || width % cellWidth !== 0 || height % cellHeight !== 0) {
      issues.push({ code: 'task.target', message: 'Target and cell dimensions must be bounded integer grids.', task_id: task.task_id });
      continue;
    }
    if (!PRODUCTION_ART_ALPHA_POLICIES.includes(task.alpha_policy)
      || !PRODUCTION_ART_SEAM_POLICIES.includes(task.seam_policy)) {
      issues.push({ code: 'task.render-policy', message: 'Alpha and seam policies must be supported.', task_id: task.task_id });
    }
    if (task.pivot.unit !== 'pixels'
      || !integer(task.pivot.x, 0, width)
      || !integer(task.pivot.y, 0, height)) {
      issues.push({ code: 'task.pivot', message: 'Pivot must be a bounded pixel coordinate.', task_id: task.task_id });
    }
    const columns = width / cellWidth;
    const rows = height / cellHeight;
    const occupied = new Set<string>();
    for (const mapping of task.role_mappings) {
      const rect = mapping.grid_rect;
      if (!expectedRoles.has(mapping.role) || mappedRoles.has(mapping.role)) {
        issues.push({ code: 'task.role', message: 'Role mappings must be expected and globally unique.', task_id: task.task_id, role: mapping.role });
      }
      if (expectedTaskKind(mapping.role) !== task.kind) {
        issues.push({ code: 'task.role-kind', message: 'Role is assigned to the wrong production art task kind.', task_id: task.task_id, role: mapping.role });
      }
      mappedRoles.add(mapping.role);
      if (!integer(rect.column, 0, columns - 1)
        || !integer(rect.row, 0, rows - 1)
        || !integer(rect.column_span, 1, columns)
        || !integer(rect.row_span, 1, rows)
        || rect.column + rect.column_span > columns
        || rect.row + rect.row_span > rows) {
        issues.push({ code: 'task.grid-bounds', message: 'Role mapping is outside the target grid.', task_id: task.task_id, role: mapping.role });
        continue;
      }
      for (let row = rect.row; row < rect.row + rect.row_span; row += 1) {
        for (let column = rect.column; column < rect.column + rect.column_span; column += 1) {
          const cell = `${column}:${row}`;
          if (occupied.has(cell)) {
            issues.push({ code: 'task.grid-overlap', message: 'Role mappings cannot overlap within a task.', task_id: task.task_id, role: mapping.role });
          }
          occupied.add(cell);
        }
      }
    }
    if (task.kind === 'character-animation-sheet') {
      const characterRoleMapping = task.role_mappings.length === 1
        ? task.role_mappings[0]
        : undefined;
      const characterRole = characterRoleMapping?.role;
      const canonicalGeometry = profileGeometry(plan.profile).character;
      const canonicalColumns = canonicalGeometry.width / canonicalGeometry.cellWidth;
      const canonicalRows = canonicalGeometry.height / canonicalGeometry.cellHeight;
      const canonicalRect = characterRoleMapping?.grid_rect;
      const geometryMatches = width === canonicalGeometry.width
        && height === canonicalGeometry.height
        && cellWidth === canonicalGeometry.cellWidth
        && cellHeight === canonicalGeometry.cellHeight
        && task.pivot.x === canonicalGeometry.pivotX
        && task.pivot.y === canonicalGeometry.pivotY
        && canonicalRect?.column === 0
        && canonicalRect.row === 0
        && canonicalRect.column_span === canonicalColumns
        && canonicalRect.row_span === canonicalRows;
      let expectedPoses: readonly ProductionArtPoseMapping[] = [];
      try {
        expectedPoses = characterRole
          ? characterPoseMappings(plan.profile, characterRole, canonicalGeometry)
          : [];
      } catch {
        expectedPoses = [];
      }
      if (
        !characterRole
        || !geometryMatches
        || expectedPoses.length < 1
        || !Array.isArray(task.pose_mappings)
        || JSON.stringify(task.pose_mappings) !== JSON.stringify(expectedPoses)
      ) {
        issues.push({
          code: 'task.pose-mappings',
          message: 'Character tasks require the exact canonical action, direction, frame, duration, and grid-cell inventory.',
          task_id: task.task_id,
          ...(characterRole ? { role: characterRole } : {}),
        });
      }
    } else if (task.pose_mappings !== undefined) {
      issues.push({
        code: 'task.pose-mappings',
        message: 'Only character animation tasks may declare semantic pose mappings.',
        task_id: task.task_id,
      });
    }
    if (task.role_mappings.length < 1) {
      issues.push({ code: 'task.roles-empty', message: 'Every production art task must map at least one role.', task_id: task.task_id });
    }
    if (task.prompt.trim() !== task.prompt || task.prompt.length < 40 || task.prompt.length > 4000) {
      issues.push({ code: 'task.prompt', message: 'Prompt must be bounded, descriptive, and trimmed.', task_id: task.task_id });
    }
    if (task.negative_constraints.length < 1
      || new Set(task.negative_constraints).size !== task.negative_constraints.length
      || task.negative_constraints.some((constraint) =>
        constraint.length < 1
        || constraint.length > 500
        || constraint.trim() !== constraint)
      || task.reference_roles.length < 1
      || new Set(task.reference_roles).size !== task.reference_roles.length
      || task.reference_roles.some((role) => role !== 'environment-style' && role !== 'character')
      || !task.reference_roles.includes('environment-style')
      || ((task.kind === 'scene-direction' || task.kind === 'character-animation-sheet')
        && !task.reference_roles.includes('character'))) {
      issues.push({ code: 'task.constraints', message: 'Constraints and reference roles must be non-empty and unique.', task_id: task.task_id });
    }
  }
  for (const role of expectedRoles) {
    if (!mappedRoles.has(role)) {
      issues.push({ code: 'plan.missing-role', message: `Production art role is not assigned: ${role}.`, role });
    }
  }
  return issues;
}

function sameRights(left: ProductionArtRights, right: ProductionArtRights): boolean {
  return left.distribution === right.distribution
    && left.license === right.license
    && left.attribution === right.attribution;
}

export function validateProductionArtOutput(
  output: ProductionArtOutput,
  plan: ProductionArtPlan,
): ProductionArtIssue[] {
  const issues = validateProductionArtPlan(plan);
  if (output.schema_version !== PRODUCTION_ART_CONTRACT_VERSION || output.document_type !== 'production-art-output') {
    issues.push({ code: 'output.schema', message: 'Production art output schema or document type is unsupported.' });
  }
  if (output.plan_id !== plan.plan_id || output.profile !== plan.profile) {
    issues.push({ code: 'output.plan-reference', message: 'Output must reference the exact plan and profile.', task_id: output.task_id });
  }
  const task = plan.tasks.find(({ task_id: taskId }) => taskId === output.task_id);
  if (!task) {
    issues.push({ code: 'output.task-reference', message: 'Output references an unknown production art task.', task_id: output.task_id });
    return issues;
  }
  if (!SAFE_ID.test(output.asset_id) || output.asset_id.length > 100) {
    issues.push({ code: 'output.asset-id', message: 'Output asset id must be a bounded safe identifier.', task_id: output.task_id });
  }
  if (!safeRelativePath(output.path) || output.path !== task.expected_output_path || !output.path.endsWith('.png')) {
    issues.push({ code: 'output.path', message: 'Output path must exactly match the task safe PNG path.', task_id: output.task_id });
  }
  if (output.media_type !== 'image/png'
    || !integer(output.bytes, 1, 64 * 1024 * 1024)
    || !SHA256.test(output.sha256)) {
    issues.push({ code: 'output.integrity', message: 'Output requires PNG media type, byte count, and SHA-256.', task_id: output.task_id });
  }
  if (output.width !== task.target.width || output.height !== task.target.height) {
    issues.push({ code: 'output.dimensions', message: 'Output dimensions must exactly match the production art task.', task_id: output.task_id });
  }
  if (output.alpha_policy !== task.alpha_policy
    || output.pivot.x !== task.pivot.x
    || output.pivot.y !== task.pivot.y
    || output.pivot.unit !== task.pivot.unit) {
    issues.push({ code: 'output.render-policy', message: 'Output alpha and pivot must exactly match the task.', task_id: output.task_id });
  }
  const expectedRoles = task.role_mappings.map(({ role }) => role);
  if (output.roles.length !== expectedRoles.length
    || output.roles.some((role, index) => role !== expectedRoles[index])) {
    issues.push({ code: 'output.roles', message: 'Output roles must exactly preserve declared task order.', task_id: output.task_id });
  }
  if (output.source_reference_ids.length < 1
    || output.source_reference_ids.length > 8
    || new Set(output.source_reference_ids).size !== output.source_reference_ids.length
    || output.source_reference_ids.some((id) => !SAFE_REFERENCE_ID.test(id) || id.length > 80)) {
    issues.push({ code: 'output.references', message: 'Output requires 1 to 8 unique safe source reference ids.', task_id: output.task_id });
  }
  validateRights(output.rights, issues, output.task_id);
  if (!sameRights(output.rights, plan.rights)) {
    issues.push({ code: 'output.rights', message: 'Output rights must exactly match the approved plan.', task_id: output.task_id });
  }
  return issues;
}

export function assertValidProductionArtOutput(output: ProductionArtOutput, plan: ProductionArtPlan): void {
  const issues = validateProductionArtOutput(output, plan);
  if (issues.length > 0) {
    throw new Error(`Invalid production art output: ${issues.map(({ code }) => code).join(', ')}.`);
  }
}
