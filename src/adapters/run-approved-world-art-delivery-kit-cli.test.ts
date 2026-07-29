import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

import deliverySchema
  from '../../schemas/mapsoo-world-art-delivery-kit-1.0.schema.json';
import deliveryV1_1Schema
  from '../../schemas/mapsoo-world-art-delivery-kit-1.1.schema.json';
import {
  buildApprovedWorldArtDeliveryKitFromCli,
} from '../../scripts/build-approved-world-art-delivery-kit';
import {
  approvedWorldArtDeliveryKitTestFixture,
} from './approved-world-art-delivery-kit.test-fixture';
import {
  serializeCanonicalWorldLayoutPlan,
} from '../core/world-layout-plan';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

async function workspace(
  version: '1.0.0' | '1.1.0',
  distribution: 'private' | 'public' = 'public',
) {
  const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-delivery-cli-'));
  roots.push(root);
  const fixture = await approvedWorldArtDeliveryKitTestFixture(
    distribution,
    version,
  );
  const input = resolve(root, 'input');
  const evidenceRoot = resolve(input, 'review-workspace');
  const overlayPath = resolve(input, fixture.overlay.filename);
  const approvalPath = resolve(input, 'approved-production-world-review.json');
  const receiptPath = resolve(input, 'canonical-human-art-review.json');
  const layoutPath = resolve(input, 'world-layout-plan.json');
  await mkdir(input, { recursive: true });
  await Promise.all([
    writeFile(overlayPath, fixture.overlay.readBytes(), { flag: 'wx' }),
    writeJson(approvalPath, fixture.approval),
    writeFile(receiptPath, fixture.receiptBytes, { flag: 'wx' }),
    ...fixture.files.map(async (file) => {
      const path = resolve(evidenceRoot, ...file.path.split('/'));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.readBytes(), { flag: 'wx' });
    }),
    ...(version === '1.1.0'
      ? [serializeCanonicalWorldLayoutPlan(fixture.overlay.layoutPlan!)
        .then((bytes) => writeFile(layoutPath, bytes, { flag: 'wx' }))]
      : []),
  ]);
  const output = resolve(root, 'output');
  const args = [
    '--overlay', overlayPath,
    '--approval', approvalPath,
    '--receipt', receiptPath,
    '--evidence-root', evidenceRoot,
    ...(version === '1.1.0' ? ['--layout', layoutPath] : []),
    '--pack-id', `approved-world-${version.replaceAll('.', '-')}`,
    '--title', `Approved World ${version}`,
    '--version', '1.0.0',
    '--contains-generative-ai', 'true',
    '--out', output,
  ];
  return {
    root,
    fixture,
    evidenceRoot,
    layoutPath,
    output,
    args,
  };
}

describe('approved world-art delivery-kit CLI', () => {
  it.each([
    ['1.0.0', 'private'],
    ['1.1.0', 'public'],
  ] as const)(
    'builds and replays one exact %s %s itch-style ZIP',
    async (version, distribution) => {
      const prepared = await workspace(version, distribution);
      const created = await buildApprovedWorldArtDeliveryKitFromCli(
        prepared.args,
      );
      const replay = await buildApprovedWorldArtDeliveryKitFromCli(
        prepared.args,
      );
      expect(created).toMatchObject({
        status: 'delivery-kit-created',
        schema_version: version,
        profile: 'topdown-farm',
        distribution,
        remote_requests: 0,
        uploaded: false,
        published: false,
      });
      expect(replay).toEqual({
        ...created,
        status: 'delivery-kit-unchanged',
      });
      const archive = await JSZip.loadAsync(
        Uint8Array.from(await readFile(created.output)),
        { checkCRC32: true },
      );
      const root = `approved-world-${version.replaceAll('.', '-')}-v1.0.0`;
      const manifest = JSON.parse(await archive.file(
        `${root}/world-art-delivery.json`,
      )!.async('text'));
      const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
        version === '1.1.0' ? deliveryV1_1Schema : deliverySchema,
      );
      expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
      expect(manifest).toMatchObject({
        schema_version: version,
        distribution,
        compatibility: {
          asset_contract:
            `world-art-runtime-overlay-${version === '1.1.0' ? '1.1' : '1.0'}`,
        },
      });
      expect(Object.keys(archive.files).some((path) =>
        path.includes('world-layout-plan.json'))).toBe(false);
    },
    60_000,
  );

  it('fails closed when Overlay 1.1 omits its trusted layout', async () => {
    const prepared = await workspace('1.1.0');
    const layoutIndex = prepared.args.indexOf('--layout');
    const args = [
      ...prepared.args.slice(0, layoutIndex),
      ...prepared.args.slice(layoutIndex + 2),
    ];
    await expect(
      buildApprovedWorldArtDeliveryKitFromCli(args),
    ).rejects.toThrow(/layout/iu);
    await expect(readFile(prepared.output)).rejects.toThrow();
  });

  it('rejects changed evidence before creating output', async () => {
    const prepared = await workspace('1.0.0');
    await writeFile(
      resolve(prepared.evidenceRoot, 'review-evidence/world-capture.png'),
      Uint8Array.from([1, 2, 3, 4]),
    );
    await expect(
      buildApprovedWorldArtDeliveryKitFromCli(prepared.args),
    ).rejects.toThrow(/changed|differs/iu);
  });

  it('rejects evidence hard-link aliases', async () => {
    const prepared = await workspace('1.0.0');
    const source = resolve(
      prepared.evidenceRoot,
      'review-evidence/world-preview.png',
    );
    const target = resolve(
      prepared.evidenceRoot,
      'review-evidence/role-overlay.png',
    );
    await rm(target);
    await link(source, target);
    await expect(
      buildApprovedWorldArtDeliveryKitFromCli(prepared.args),
    ).rejects.toThrow(/hard-link alias/iu);
  });

  it('refuses to overwrite a different delivery ZIP', async () => {
    const prepared = await workspace('1.0.0');
    const created = await buildApprovedWorldArtDeliveryKitFromCli(
      prepared.args,
    );
    await writeFile(created.output, Uint8Array.from([1, 2, 3]));
    await expect(
      buildApprovedWorldArtDeliveryKitFromCli(prepared.args),
    ).rejects.toThrow(/overwrite different existing output/iu);
  });
});
