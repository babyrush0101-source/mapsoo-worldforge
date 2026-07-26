import { describe, expect, it } from 'vitest';
import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import { bindGenerationRequestV2 } from '../core/generation-request-v2';
import { SIDE_PLATFORMER_REQUIRED_ROLES } from '../core/side-platformer-asset-bundle';
import { extractCharacterIdentitySignature } from '../core/character-identity-signature';
import { runWorldAssetProvider } from '../core/world-asset-provider';
import { PROCEDURAL_SIDE_PLATFORMER_PROVIDER } from './procedural-side-platformer-provider';

async function hash(bytes: Uint8Array) { const d = await crypto.subtle.digest('SHA-256', bytes.slice().buffer); return [...new Uint8Array(d)].map((v) => v.toString(16).padStart(2, '0')).join(''); }
async function job(description = 'A luminous forest ruin.', envMarker = 40, characterMarker = 170) {
  const env = encodeRgbaPng(2, 2, Uint8Array.from([envMarker, 120, 80, 255, 80, 90, 150, 255, 30, 50, 70, 255, 200, 170, 90, 255]));
  const characterRgba = Uint8Array.from([characterMarker, 50, 100, 255, 230, 180, 130, 255, 50, 60, 130, 255, 20, 25, 35, 255]);
  const character = encodeRgbaPng(2, 2, characterRgba);
  const descriptor = async (role: 'environment-style' | 'character', bytes: Uint8Array) => ({ id: `${role}-ref`, role, path: `references/${role}.png`, mediaType: 'image/png' as const, byteLength: bytes.byteLength, width: 2, height: 2, sha256: await hash(bytes), rights: { basis: 'owned' as const, license: 'LicenseRef-User-Owned', allowGenerativeAdaptation: true as const, allowOutputRedistribution: true as const, allowOutputCc0Dedication: true as const } });
  const bound = await bindGenerationRequestV2({ schemaVersion: '1.0.0', id: 'side-world-job', profile: 'side-platformer', description, seed: 'side-seed-010', references: [await descriptor('environment-style', env), await descriptor('character', character)] }, [{ path: 'references/environment-style.png', bytes: env }, { path: 'references/character.png', bytes: character }]);
  return Object.freeze({
    ...bound,
    characterIdentity: await extractCharacterIdentitySignature({ width: 2, height: 2, rgba: characterRgba }),
  });
}
function bytes(result: Awaited<ReturnType<typeof runWorldAssetProvider>>, id: string) { return result.payloads.find((p) => p.assetId === id)!.readBytes(); }

describe('procedural side-platformer provider', () => {
  it('emits the complete role/animation contract and real runtime payloads', async () => {
    const result = await runWorldAssetProvider(PROCEDURAL_SIDE_PLATFORMER_PROVIDER, await job());
    expect(result.bundle.roles.map((r) => r.role).sort()).toEqual([...SIDE_PLATFORMER_REQUIRED_ROLES].sort());
    expect(result.bundle.characters[0].clips).toHaveLength(12);
    expect(bytes(result, 'platform-atlas').slice(0, 8)).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(JSON.parse(new TextDecoder().decode(bytes(result, 'scene-data'))).placements).toHaveLength(4);
    expect(JSON.parse(new TextDecoder().decode(bytes(result, 'collision-map'))).surfaces).toHaveLength(3);
    expect(JSON.parse(new TextDecoder().decode(bytes(result, 'navigation-map'))).edges).toHaveLength(2);
    expect(result.bundle.assets.find((a) => a.id === 'character-atlas')?.sourceReferenceIds).toEqual(['character-ref']);
    expect(PROCEDURAL_SIDE_PLATFORMER_PROVIDER.capabilities.supportedProfiles).toEqual(['side-platformer']);
  });
  it('is byte-identical for the same request', async () => { const input = await job(); const a = await runWorldAssetProvider(PROCEDURAL_SIDE_PLATFORMER_PROVIDER, input); const b = await runWorldAssetProvider(PROCEDURAL_SIDE_PLATFORMER_PROVIDER, input); expect(a.payloads.map((p) => p.readBytes())).toEqual(b.payloads.map((p) => p.readBytes())); });
  it('binds environment, description, and character inputs into output', async () => {
    const baseline = await runWorldAssetProvider(PROCEDURAL_SIDE_PLATFORMER_PROVIDER, await job());
    const environment = await runWorldAssetProvider(PROCEDURAL_SIDE_PLATFORMER_PROVIDER, await job('A luminous forest ruin.', 41));
    const description = await runWorldAssetProvider(PROCEDURAL_SIDE_PLATFORMER_PROVIDER, await job('A frozen moonlit fortress.'));
    const character = await runWorldAssetProvider(PROCEDURAL_SIDE_PLATFORMER_PROVIDER, await job('A luminous forest ruin.', 40, 210));
    expect(bytes(baseline, 'platform-atlas')).not.toEqual(bytes(environment, 'platform-atlas'));
    expect(bytes(baseline, 'platform-atlas')).not.toEqual(bytes(description, 'platform-atlas'));
    expect(bytes(baseline, 'character-atlas')).not.toEqual(bytes(character, 'character-atlas'));
    expect(bytes(baseline, 'character-atlas')).toEqual(bytes(environment, 'character-atlas'));
    expect(bytes(baseline, 'character-atlas')).toEqual(bytes(description, 'character-atlas'));
  });
});
