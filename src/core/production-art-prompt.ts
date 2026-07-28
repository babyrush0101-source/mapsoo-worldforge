import type {
  ProductionArtProviderJob,
  ProductionArtProviderJobV1_1,
} from './production-art-provider';
import type {
  ProductionArtTask,
} from './production-art-contract';
import type { ProductionArtTaskV1_1 } from './production-art-contract-v1-1';
import {
  compileCharacterIdentitySemanticsPrompt,
} from './character-identity-semantics';

const NAMED_IMITATION =
  /\b(?:in\s+the\s+style\s+of|hades|stardew(?:\s+valley)?|octopath(?:\s+traveler)?)\b|(?:哈迪斯|星露谷物语|八方旅人)/iu;

function boundedPromptText(
  value: string,
  label: string,
  maximum: number,
): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  if (NAMED_IMITATION.test(value)) {
    throw new Error(
      `${label} must describe original visual traits instead of naming a commercial game, franchise, or artist style.`,
    );
  }
  return value;
}

function gridDescription(task: ProductionArtTask | ProductionArtTaskV1_1): string {
  const columns = task.target.width / task.target.cell_width;
  const rows = task.target.height / task.target.cell_height;
  return `${columns} columns by ${rows} rows`;
}

function declaredMappingPrompt(
  task: ProductionArtTask | ProductionArtTaskV1_1,
): string {
  if ('slot_mappings' in task) {
    return `Declared slots: ${task.slot_mappings.map((slot) =>
      `slot_id=${slot.slot_id}, requirement_id=${slot.requirement_id}, `
      + `variant_id=${slot.variant_id}, role=${slot.role}`).join('; ')}.`;
  }
  return `Declared roles: ${task.role_mappings.map(({ role }) => role).join(', ')}.`;
}

/**
 * Provider-neutral visual contract. Adapters may choose transport and model
 * settings, but may not weaken the identity, grid, alpha, or originality rules.
 */
export function compileProductionArtPrompt(
  job: ProductionArtProviderJob | ProductionArtProviderJobV1_1,
): string {
  const worldBrief = boundedPromptText(
    job.worldBrief,
    'World brief',
    2_000,
  );
  const styleBible = boundedPromptText(
    job.styleBible,
    'Style bible',
    4_000,
  );
  const characterIdentity = job.task.reference_roles.includes('character')
    ? compileCharacterIdentitySemanticsPrompt(
      job.characterIdentitySemantics,
      job.plan.profile,
    )
    : undefined;
  const alphaInstructions = job.task.alpha_policy === 'straight-alpha'
    ? [
      'Render on one perfectly solid #00FF00 green chroma background connected to all four outer image borders.',
      'Do not use green in any subject, prop, costume, effect, terrain, or lighting.',
      'Keep every subject fully isolated from neighboring cells.',
      'Keep every undeclared grid cell entirely chroma green.',
      job.task.seam_policy === 'transparent-cell-padding'
        ? 'Leave a clean empty chroma border on all four edges of every grid cell.'
        : 'Preserve the declared cell boundaries exactly.',
    ]
    : [
      'Render a fully opaque image with no transparent or empty pixels.',
    ];
  return [
    'Create one original production source image for a Godot 2D world asset pipeline.',
    `Profile: ${job.plan.profile}. Task: ${job.task.kind}.`,
    `World brief: ${worldBrief}`,
    `Approved style bible: ${styleBible}`,
    ...(characterIdentity
      ? [`Human-confirmed character preservation contract:\n${characterIdentity}`]
      : []),
    `Canvas grid: ${gridDescription(job.task)}. Preserve the declared role order exactly.`,
    `Reference images in upload order: ${job.references.map(
      ({ descriptor }, index) =>
        `image-${index + 1}=${descriptor.id} (${descriptor.role})`,
    ).join('; ')}.`,
    declaredMappingPrompt(job.task),
    ...(job.task.pose_mappings
      ? [
        `Semantic pose cells: ${job.task.pose_mappings.map((pose) =>
          `${pose.grid_cell.column},${pose.grid_cell.row}=`
          + `${pose.action}.${pose.direction}.frame-${pose.frame_index}`).join('; ')}.`,
        'Every declared pose cell is an independently rendered animation frame, not a mirrored or shifted duplicate.',
      ]
      : []),
    job.task.prompt,
    ...alphaInstructions,
    ...job.task.negative_constraints,
    'Do not imitate any named game, franchise, living artist, studio, logo, or existing protected character.',
    'Use a single coherent original palette, camera, pixel density, silhouette language, and material treatment.',
  ].join('\n');
}
