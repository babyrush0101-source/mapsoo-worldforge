import type { WorldAssetProfile } from './asset-profile';
import {
  fingerprintAssetRequirementsV1_1,
  materializeAssetRequirementsV1_1,
  supportedProductionArtRolesV1_1,
  type AssetRequirementV1_1,
  type AssetRequirementsV1_1,
} from './asset-requirements-v1-1';
import {
  PRODUCTION_ART_DISTRIBUTIONS,
  PRODUCTION_ART_LICENSES,
  requiredProductionCharacterPoseMappings,
  type ProductionArtAlphaPolicy,
  type ProductionArtGridRect,
  type ProductionArtPivot,
  type ProductionArtRights,
  type ProductionArtSeamPolicy,
  type ProductionArtTarget,
  type ProductionArtTaskKind,
} from './production-art-contract';
import type { CharacterAction, CharacterDirection } from './generated-asset-bundle';

export const PRODUCTION_ART_CONTRACT_V1_1_VERSION = '1.1.0' as const;

export type ProductionArtAssignmentStrategyV1_1 =
  | 'one-cell-per-variant'
  | 'composite-sheet'
  | 'pose-grid';

export interface ProductionArtSlotMappingV1_1 {
  readonly slot_id: string;
  readonly requirement_id: string;
  readonly variant_id: string;
  readonly role: string;
  readonly grid_rect: ProductionArtGridRect;
}

export interface ProductionArtRequirementAssignmentV1_1 {
  readonly requirement_id: string;
  readonly role: string;
  readonly strategy: ProductionArtAssignmentStrategyV1_1;
  readonly required_variant_count: number;
  readonly slot_ids: readonly string[];
}

export interface ProductionArtPoseMappingV1_1 {
  readonly slot_id: string;
  readonly requirement_id: string;
  readonly variant_id: string;
  readonly role: string;
  readonly action: CharacterAction;
  readonly direction: CharacterDirection;
  readonly frame_index: number;
  readonly duration_ms: number;
  readonly grid_cell: Readonly<{
    column: number;
    row: number;
  }>;
}

export interface ProductionArtTaskV1_1 {
  readonly task_id: string;
  readonly kind: ProductionArtTaskKind;
  readonly expected_output_path: string;
  readonly target: ProductionArtTarget;
  readonly alpha_policy: ProductionArtAlphaPolicy;
  readonly seam_policy: ProductionArtSeamPolicy;
  readonly pivot: ProductionArtPivot;
  readonly reference_roles: readonly ('environment-style' | 'character')[];
  readonly requirement_assignments: readonly ProductionArtRequirementAssignmentV1_1[];
  readonly slot_mappings: readonly ProductionArtSlotMappingV1_1[];
  readonly pose_mappings?: readonly ProductionArtPoseMappingV1_1[];
  readonly prompt: string;
  readonly negative_constraints: readonly string[];
}

export interface ProductionArtPlanV1_1 {
  readonly schema_version: typeof PRODUCTION_ART_CONTRACT_V1_1_VERSION;
  readonly document_type: 'production-art-plan';
  readonly plan_id: string;
  readonly profile: WorldAssetProfile;
  readonly source: Readonly<{
    requirements_id: string;
    requirements_sha256: string;
  }>;
  readonly rights: ProductionArtRights;
  readonly tasks: readonly ProductionArtTaskV1_1[];
}

export type ProductionArtPlanV1_1ErrorCode =
  | 'production-art-1.1.invalid-shape'
  | 'production-art-1.1.invalid-value'
  | 'production-art-1.1.invalid-rights'
  | 'production-art-1.1.invalid-requirements'
  | 'production-art-1.1.invalid-binding';

export class ProductionArtPlanV1_1Error extends Error {
  constructor(readonly code: ProductionArtPlanV1_1ErrorCode, message: string) {
    super(message);
    this.name = 'ProductionArtPlanV1_1Error';
  }
}

interface TaskGeometry {
  readonly width: number;
  readonly height: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly pivotX: number;
  readonly pivotY: number;
}

type SheetCategory = 'tile' | 'prop' | 'effect';

interface PendingSlot {
  readonly requirement: AssetRequirementV1_1;
  readonly slot: Omit<ProductionArtSlotMappingV1_1, 'grid_rect'>;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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

function fail(code: ProductionArtPlanV1_1ErrorCode, message: string): never {
  throw new ProductionArtPlanV1_1Error(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('production-art-1.1.invalid-shape', `${label} must contain exactly: ${expected.join(', ')}.`);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('production-art-1.1.invalid-value', 'Document contains a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('production-art-1.1.invalid-value', 'Document contains an unsupported value.');
  }
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function validateRights(rights: ProductionArtRights): void {
  if (
    !PRODUCTION_ART_DISTRIBUTIONS.includes(rights.distribution)
    || !PRODUCTION_ART_LICENSES.includes(rights.license)
  ) {
    fail('production-art-1.1.invalid-rights', 'Rights use an unsupported distribution or license.');
  }
  if (rights.distribution === 'public' && rights.license === 'LicenseRef-Proprietary') {
    fail('production-art-1.1.invalid-rights', 'Public output cannot use a proprietary license.');
  }
  const attributionRequired = rights.license === 'CC-BY-4.0'
    || rights.license === 'CC-BY-SA-4.0';
  if (
    (attributionRequired && rights.attribution === undefined)
    || (rights.attribution !== undefined && (
      rights.attribution.length < 1
      || rights.attribution.length > 500
      || rights.attribution.trim() !== rights.attribution
    ))
  ) {
    fail('production-art-1.1.invalid-rights', 'Attribution is missing or invalid.');
  }
}

function profileGeometry(
  profile: WorldAssetProfile,
): Readonly<Record<'tile' | 'prop' | 'character' | 'effect', TaskGeometry>> {
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

function requirementCategory(requirement: AssetRequirementV1_1):
  | 'preview'
  | 'tile'
  | 'prop'
  | 'character'
  | 'background'
  | 'effect' {
  if (requirement.category === 'preview') return 'preview';
  if (requirement.category === 'terrain') return 'tile';
  if (requirement.category === 'character') return 'character';
  if (
    requirement.category === 'background'
    || requirement.category === 'foreground'
    || requirement.category === 'lighting'
  ) return 'background';
  if (requirement.category === 'effect') return 'effect';
  return 'prop';
}

function slug(value: string): string {
  return value.replaceAll('.', '-');
}

function baseSlot(
  requirement: AssetRequirementV1_1,
  variantId: string,
): Omit<ProductionArtSlotMappingV1_1, 'grid_rect'> {
  return Object.freeze({
    slot_id: `${requirement.requirement_id}-${variantId}`,
    requirement_id: requirement.requirement_id,
    variant_id: variantId,
    role: requirement.binding.role,
  });
}

function target(geometry: TaskGeometry): ProductionArtTarget {
  return Object.freeze({
    width: geometry.width,
    height: geometry.height,
    cell_width: geometry.cellWidth,
    cell_height: geometry.cellHeight,
  });
}

function pivot(geometry: TaskGeometry): ProductionArtPivot {
  return Object.freeze({ x: geometry.pivotX, y: geometry.pivotY, unit: 'pixels' as const });
}

function assignment(
  requirement: AssetRequirementV1_1,
  strategy: ProductionArtAssignmentStrategyV1_1,
  slots: readonly ProductionArtSlotMappingV1_1[],
): ProductionArtRequirementAssignmentV1_1 {
  return Object.freeze({
    requirement_id: requirement.requirement_id,
    role: requirement.binding.role,
    strategy,
    required_variant_count: requirement.required_output.count,
    slot_ids: Object.freeze(slots.map(({ slot_id: slotId }) => slotId)),
  });
}

function prompt(profile: WorldAssetProfile, kind: ProductionArtTaskKind): string {
  return `Create a provider-neutral production source image for an ${PROFILE_LABELS[profile]}. `
    + `Task: ${kind}. Respect the declared grid and slot mappings exactly, populate only mapped cells, `
    + 'and use an original, internally consistent art direction suitable for deterministic Godot post-processing.';
}

function makeTask(
  profile: WorldAssetProfile,
  taskId: string,
  kind: ProductionArtTaskKind,
  geometry: TaskGeometry,
  alphaPolicy: ProductionArtAlphaPolicy,
  seamPolicy: ProductionArtSeamPolicy,
  referenceRoles: readonly ('environment-style' | 'character')[],
  assignments: readonly ProductionArtRequirementAssignmentV1_1[],
  slots: readonly ProductionArtSlotMappingV1_1[],
  poseMappings?: readonly ProductionArtPoseMappingV1_1[],
): ProductionArtTaskV1_1 {
  const base = {
    task_id: taskId,
    kind,
    expected_output_path: `production-art/${profile}/${taskId}.png`,
    target: target(geometry),
    alpha_policy: alphaPolicy,
    seam_policy: seamPolicy,
    pivot: pivot(geometry),
    reference_roles: Object.freeze([...referenceRoles]),
    requirement_assignments: Object.freeze([...assignments]),
    slot_mappings: Object.freeze([...slots]),
    prompt: prompt(profile, kind),
    negative_constraints: NEGATIVE_CONSTRAINTS,
  };
  return Object.freeze(poseMappings === undefined
    ? base
    : { ...base, pose_mappings: Object.freeze([...poseMappings]) });
}

function fullSheetTask(
  profile: WorldAssetProfile,
  requirement: AssetRequirementV1_1,
  variantId: string,
  index: number,
  category: 'preview' | 'background' | 'character',
  geometry: TaskGeometry,
): ProductionArtTaskV1_1 {
  const columns = geometry.width / geometry.cellWidth;
  const rows = geometry.height / geometry.cellHeight;
  const slot = Object.freeze({
    ...baseSlot(requirement, variantId),
    grid_rect: Object.freeze({
      column: 0,
      row: 0,
      column_span: columns,
      row_span: rows,
    }),
  });
  const suffix = `${slug(requirement.binding.role)}-${variantId}-${String(index + 1).padStart(3, '0')}`;
  if (category === 'preview') {
    return makeTask(
      profile,
      `scene-direction-${suffix}`,
      'scene-direction',
      geometry,
      'opaque',
      'none',
      ['environment-style', 'character'],
      [assignment(requirement, 'composite-sheet', [slot])],
      [slot],
    );
  }
  if (category === 'background') {
    return makeTask(
      profile,
      `background-${suffix}`,
      'background-layer',
      geometry,
      requirement.binding.role === 'background.sky' ? 'opaque' : 'straight-alpha',
      'horizontal-parallax',
      ['environment-style'],
      [assignment(requirement, 'one-cell-per-variant', [slot])],
      [slot],
    );
  }
  const basePoses = requiredProductionCharacterPoseMappings(profile, requirement.binding.role);
  if (basePoses.length === 0) {
    fail(
      'production-art-1.1.invalid-requirements',
      `Character role ${requirement.binding.role} has no declared pose grid.`,
    );
  }
  const poses = Object.freeze(basePoses.map((pose) => Object.freeze({
    ...pose,
    slot_id: slot.slot_id,
    requirement_id: requirement.requirement_id,
    variant_id: variantId,
  })));
  return makeTask(
    profile,
    `character-${suffix}`,
    'character-animation-sheet',
    geometry,
    'straight-alpha',
    'transparent-cell-padding',
    ['environment-style', 'character'],
    [assignment(requirement, 'pose-grid', [slot])],
    [slot],
    poses,
  );
}

function sheetTasks(
  profile: WorldAssetProfile,
  category: SheetCategory,
  requirements: readonly AssetRequirementV1_1[],
  geometry: TaskGeometry,
): readonly ProductionArtTaskV1_1[] {
  const pending: PendingSlot[] = requirements.flatMap((requirement) =>
    requirement.variants.map((variant) => Object.freeze({
      requirement,
      slot: baseSlot(requirement, variant.variant_id),
    })));
  const columns = geometry.width / geometry.cellWidth;
  const rows = geometry.height / geometry.cellHeight;
  const capacity = columns * rows;
  const pages: ProductionArtTaskV1_1[] = [];
  for (let offset = 0; offset < pending.length; offset += capacity) {
    const page = pending.slice(offset, offset + capacity);
    const slots = Object.freeze(page.map(({ slot }, index) => Object.freeze({
      ...slot,
      grid_rect: Object.freeze({
        column: index % columns,
        row: Math.floor(index / columns),
        column_span: 1,
        row_span: 1,
      }),
    })));
    const pageRequirements = [...new Set(page.map(({ requirement }) => requirement))];
    const assignments = Object.freeze(pageRequirements.map((requirement) =>
      assignment(
        requirement,
        'one-cell-per-variant',
        slots.filter(({ requirement_id: requirementId }) =>
          requirementId === requirement.requirement_id),
      )));
    const pageNumber = String(pages.length + 1).padStart(3, '0');
    const kind: ProductionArtTaskKind = category === 'tile'
      ? 'opaque-tile-sheet'
      : category === 'effect'
        ? 'effect-sheet'
        : 'transparent-prop-sheet';
    pages.push(makeTask(
      profile,
      `${category === 'tile' ? 'terrain' : category}-sheet-${pageNumber}`,
      kind,
      geometry,
      'straight-alpha',
      category === 'tile' ? 'tileable-cells' : 'transparent-cell-padding',
      ['environment-style'],
      assignments,
      slots,
    ));
  }
  return Object.freeze(pages);
}

async function confirmedRequirements(value: unknown): Promise<AssetRequirementsV1_1> {
  try {
    const requirements = await materializeAssetRequirementsV1_1(value);
    const supported = new Set(supportedProductionArtRolesV1_1(requirements.profile));
    const roles = new Set<string>();
    for (const requirement of requirements.requirements) {
      if (!supported.has(requirement.binding.role)) {
        fail(
          'production-art-1.1.invalid-requirements',
          `Role ${requirement.binding.role} is not supported by ${requirements.profile}.`,
        );
      }
      if (roles.has(requirement.binding.role)) {
        fail(
          'production-art-1.1.invalid-requirements',
          `Role ${requirement.binding.role} has more than one requirement.`,
        );
      }
      roles.add(requirement.binding.role);
    }
    return requirements;
  } catch (error) {
    if (error instanceof ProductionArtPlanV1_1Error) throw error;
    fail(
      'production-art-1.1.invalid-requirements',
      `AssetRequirements 1.1 are unresolved or invalid: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}

export async function buildProductionArtPlanV1_1(
  requirementsValue: unknown,
  rights: ProductionArtRights,
): Promise<ProductionArtPlanV1_1> {
  const requirements = await confirmedRequirements(requirementsValue);
  validateRights(rights);
  const requirementsSha256 = await fingerprintAssetRequirementsV1_1(requirements);
  const geometry = profileGeometry(requirements.profile);
  const byCategory = (
    category: ReturnType<typeof requirementCategory>,
  ): readonly AssetRequirementV1_1[] => requirements.requirements.filter((requirement) =>
    requirementCategory(requirement) === category);
  const tasks: ProductionArtTaskV1_1[] = [];
  for (const requirement of byCategory('preview')) {
    requirement.variants.forEach((variant, index) => {
      tasks.push(fullSheetTask(
        requirements.profile,
        requirement,
        variant.variant_id,
        index,
        'preview',
        { width: 1536, height: 1024, cellWidth: 1536, cellHeight: 1024, pivotX: 0, pivotY: 0 },
      ));
    });
  }
  tasks.push(...sheetTasks(requirements.profile, 'tile', byCategory('tile'), geometry.tile));
  tasks.push(...sheetTasks(requirements.profile, 'prop', byCategory('prop'), geometry.prop));
  for (const requirement of byCategory('character')) {
    requirement.variants.forEach((variant, index) => {
      tasks.push(fullSheetTask(
        requirements.profile,
        requirement,
        variant.variant_id,
        index,
        'character',
        geometry.character,
      ));
    });
  }
  for (const requirement of byCategory('background')) {
    requirement.variants.forEach((variant, index) => {
      tasks.push(fullSheetTask(
        requirements.profile,
        requirement,
        variant.variant_id,
        index,
        'background',
        { width: 1920, height: 1080, cellWidth: 1920, cellHeight: 1080, pivotX: 0, pivotY: 0 },
      ));
    });
  }
  tasks.push(...sheetTasks(requirements.profile, 'effect', byCategory('effect'), geometry.effect));
  return Object.freeze({
    schema_version: PRODUCTION_ART_CONTRACT_V1_1_VERSION,
    document_type: 'production-art-plan',
    plan_id: `${requirements.profile}-production-art-${requirementsSha256.slice(0, 16)}`,
    profile: requirements.profile,
    source: Object.freeze({
      requirements_id: requirements.requirements_id,
      requirements_sha256: requirementsSha256,
    }),
    rights: Object.freeze({ ...rights }),
    tasks: Object.freeze(tasks),
  });
}

export async function materializeProductionArtPlanV1_1(
  value: unknown,
  requirementsValue: unknown,
): Promise<ProductionArtPlanV1_1> {
  if (!isRecord(value)) {
    fail('production-art-1.1.invalid-shape', 'Production art plan must be an object.');
  }
  exactKeys(value, [
    'schema_version', 'document_type', 'plan_id', 'profile', 'source', 'rights', 'tasks',
  ], 'Production art plan');
  if (
    value.schema_version !== PRODUCTION_ART_CONTRACT_V1_1_VERSION
    || value.document_type !== 'production-art-plan'
    || typeof value.plan_id !== 'string'
    || !SAFE_ID.test(value.plan_id)
    || !isRecord(value.source)
  ) {
    fail('production-art-1.1.invalid-value', 'Production art plan identity is invalid.');
  }
  exactKeys(value.source, ['requirements_id', 'requirements_sha256'], 'Production art source');
  if (!SHA256.test(String(value.source.requirements_sha256))) {
    fail('production-art-1.1.invalid-value', 'Production art requirements digest is invalid.');
  }
  if (!isRecord(value.rights)) {
    fail('production-art-1.1.invalid-shape', 'Production art rights must be an object.');
  }
  const rightsKeys = value.rights.attribution === undefined
    ? ['distribution', 'license']
    : ['distribution', 'license', 'attribution'];
  exactKeys(value.rights, rightsKeys, 'Production art rights');
  const expected = await buildProductionArtPlanV1_1(
    requirementsValue,
    value.rights as unknown as ProductionArtRights,
  );
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail(
      'production-art-1.1.invalid-binding',
      'Production art plan does not match its confirmed AssetRequirements 1.1 source.',
    );
  }
  return expected;
}

export async function fingerprintProductionArtPlanV1_1(
  value: unknown,
  requirementsValue: unknown,
): Promise<string> {
  return sha256(await materializeProductionArtPlanV1_1(value, requirementsValue));
}

export async function serializeCanonicalProductionArtPlanV1_1(
  value: unknown,
  requirementsValue: unknown,
): Promise<Uint8Array> {
  const plan = await materializeProductionArtPlanV1_1(value, requirementsValue);
  return new TextEncoder().encode(`${canonicalJson(plan)}\n`);
}
