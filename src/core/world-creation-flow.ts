import { type WorldAssetProfile } from './asset-profile';

export const WORLD_CREATION_STAGES = Object.freeze([
  'world-brief',
  'art-direction',
  'map-layout',
  'style-sample',
  'asset-generation',
  'godot-map',
  'playtest',
] as const);

export type WorldCreationStage = typeof WORLD_CREATION_STAGES[number];
export type CreationCapabilityLevel = 'available' | 'prototype' | 'planned';

export interface WorldCreationStageDescriptor {
  readonly id: WorldCreationStage;
  readonly label: string;
  readonly question: string;
  readonly confirmation: string;
  readonly output: string;
}

export interface ProfileCreationCapability {
  readonly profile: WorldAssetProfile;
  readonly dialoguePlanning: true;
  readonly styleSample: CreationCapabilityLevel;
  readonly completeAssetProvider: boolean;
  readonly godotSceneImporter: boolean;
  readonly playerController: boolean;
  readonly interactiveRuntime: boolean;
}

export const WORLD_CREATION_STAGE_DESCRIPTORS: Readonly<Record<WorldCreationStage, WorldCreationStageDescriptor>> =
  Object.freeze({
    'world-brief': Object.freeze({
      id: 'world-brief',
      label: 'World brief',
      question: 'Describe the premise, worldview, terrain, geography, inhabitants, culture, ecology, and intended player feeling.',
      confirmation: 'Confirm the world premise and selected camera profile.',
      output: 'A versioned, consumer-neutral world intake with confirmed facts, references, target device, and seed.',
    }),
    'art-direction': Object.freeze({
      id: 'art-direction',
      label: 'Art direction',
      question: 'Which palette, materials, lighting, scale, and character treatment should define the world?',
      confirmation: 'Confirm the art direction before layout or image generation.',
      output: 'A frozen art-direction checkpoint.',
    }),
    'map-layout': Object.freeze({
      id: 'map-layout',
      label: 'Map layout',
      question: 'Where are spawn, the main route, landmarks, hazards or interactions, and the exit?',
      confirmation: 'Confirm the navigable layout and gameplay landmarks.',
      output: 'A profile-specific layout plan with collision and navigation intent.',
    }),
    'style-sample': Object.freeze({
      id: 'style-sample',
      label: 'Style sample',
      question: 'Does the combined scene, character, terrain, and lighting sample match the intended world?',
      confirmation: 'Approve the sample or request a targeted revision.',
      output: 'A reviewed sample sheet and visual-QA report.',
    }),
    'asset-generation': Object.freeze({
      id: 'asset-generation',
      label: 'Complete assets',
      question: 'Should the approved sample expand into the complete role and animation contract?',
      confirmation: 'Freeze an immutable asset revision after structural and visual QA.',
      output: 'A complete Mapsoo pack pinned by manifest and archive hashes.',
    }),
    'godot-map': Object.freeze({
      id: 'godot-map',
      label: 'Godot map',
      question: 'Should the frozen assets be assembled into a new Godot map revision?',
      confirmation: 'Approve the imported scene after headless smoke verification.',
      output: 'A generated TileSet, SpriteFrames, collision, navigation, and world scene.',
    }),
    'playtest': Object.freeze({
      id: 'playtest',
      label: 'Enter the world',
      question: 'Launch the confirmed map with the selected player character?',
      confirmation: 'Record playtest feedback, then return to any earlier checkpoint for a new revision.',
      output: 'A running desktop, Raspberry Pi, or web play session.',
    }),
  });

export const PROFILE_CREATION_CAPABILITIES: Readonly<Record<WorldAssetProfile, ProfileCreationCapability>> =
  Object.freeze({
    'topdown-farm': Object.freeze({
      profile: 'topdown-farm',
      dialoguePlanning: true,
      styleSample: 'available',
      completeAssetProvider: true,
      godotSceneImporter: true,
      playerController: true,
      interactiveRuntime: true,
    }),
    'side-platformer': Object.freeze({
      profile: 'side-platformer',
      dialoguePlanning: true,
      styleSample: 'available',
      completeAssetProvider: true,
      godotSceneImporter: true,
      playerController: true,
      interactiveRuntime: true,
    }),
    'isometric-action': Object.freeze({
      profile: 'isometric-action',
      dialoguePlanning: true,
      styleSample: 'available',
      completeAssetProvider: true,
      godotSceneImporter: true,
      playerController: true,
      interactiveRuntime: true,
    }),
    'layered-depth-2d': Object.freeze({
      profile: 'layered-depth-2d',
      dialoguePlanning: true,
      styleSample: 'available',
      completeAssetProvider: true,
      godotSceneImporter: true,
      playerController: true,
      interactiveRuntime: true,
    }),
  });

export function canEnterWorldCreationStage(profile: WorldAssetProfile, stage: WorldCreationStage): boolean {
  const capability = PROFILE_CREATION_CAPABILITIES[profile];
  if (stage === 'asset-generation') return capability.completeAssetProvider;
  if (stage === 'godot-map') return capability.completeAssetProvider && capability.godotSceneImporter;
  if (stage === 'playtest') return capability.completeAssetProvider && capability.godotSceneImporter && capability.interactiveRuntime;
  return true;
}

export function nextWorldCreationStage(stage: WorldCreationStage): WorldCreationStage | null {
  const index = WORLD_CREATION_STAGES.indexOf(stage);
  return WORLD_CREATION_STAGES[index + 1] ?? null;
}

export function assertCanEnterWorldCreationStage(profile: WorldAssetProfile, stage: WorldCreationStage): void {
  if (!canEnterWorldCreationStage(profile, stage)) {
    throw new Error(`${profile} cannot enter ${stage}: the required provider, importer, or interactive runtime is not available.`);
  }
}
