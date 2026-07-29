import {
  createCharacterProfileBindMessage,
  materializeCharacterProfileRevision,
  projectCharacterProfileBindToPortableRuntime,
  type CharacterProfileBindMessage,
} from './character-profile-revision';
import {
  createPortableRuntimeMessage,
  type PortableRuntimeBridgeMessage,
} from './portable-world-runtime-contract';
import {
  materializeWorldRunnerDelivery,
  type WorldRunnerDelivery,
} from './world-runner-delivery';

export interface WorldRunnerLaunchEnvelope {
  readonly delivery: WorldRunnerDelivery;
  readonly prepare: PortableRuntimeBridgeMessage<'runtime.prepare'>;
  readonly character_bind: CharacterProfileBindMessage;
  readonly bind: PortableRuntimeBridgeMessage<'runtime.bind'>;
  readonly launch: PortableRuntimeBridgeMessage<'runtime.launch'>;
}

/**
 * Creates the complete consumer-neutral prepare -> bind -> launch message set.
 * Authorization, transport, persistence, retries, and private host payload
 * translation deliberately stay outside this repository.
 */
export async function createWorldRunnerLaunchEnvelope(input: Readonly<{
  delivery: unknown;
  character_revision: unknown;
  session_id: string;
  entity_id: string;
  idempotency_prefix: string;
}>): Promise<WorldRunnerLaunchEnvelope> {
  const characterRevision = materializeCharacterProfileRevision(input.character_revision);
  const delivery = await materializeWorldRunnerDelivery(input.delivery, characterRevision);
  const contract = delivery.runtime_contract;
  const prepare = await createPortableRuntimeMessage(
    'runtime.prepare',
    `${input.idempotency_prefix}:prepare`,
    { runtime_contract: contract },
  );
  const characterBind = await createCharacterProfileBindMessage(
    `${input.idempotency_prefix}:character-bind`,
    {
      contract_id: contract.contract_id,
      session_id: input.session_id,
      slot_id: delivery.launch.player_slot_id,
      entity_id: input.entity_id,
    },
    characterRevision,
    contract,
  );
  const bindPayload = await projectCharacterProfileBindToPortableRuntime(
    characterBind,
    characterRevision,
    contract,
  );
  const bind = await createPortableRuntimeMessage(
    'runtime.bind',
    `${input.idempotency_prefix}:bind`,
    bindPayload,
    contract,
  );
  const launch = await createPortableRuntimeMessage(
    'runtime.launch',
    `${input.idempotency_prefix}:launch`,
    {
      contract_id: contract.contract_id,
      session_id: input.session_id,
      spawn_id: delivery.launch.spawn_id,
    },
    contract,
  );
  return Object.freeze({
    delivery,
    prepare,
    character_bind: characterBind,
    bind,
    launch,
  });
}
