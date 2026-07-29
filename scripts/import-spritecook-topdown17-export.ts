import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import {
  normalizeSpriteCookTopdown17Export,
  type SpriteCookTopdown17TileSize,
} from '../src/adapters/spritecook/normalize-spritecook-topdown17-export';

const VALUE_FLAGS = new Set(['--source', '--out', '--report', '--target-cell']);

interface Arguments {
  readonly help: boolean;
  readonly source: string;
  readonly out: string;
  readonly report: string;
  readonly targetCell?: SpriteCookTopdown17TileSize;
}

function usage(): string {
  return [
    'Mapsoo Worldforge — SpriteCook 17-piece local export adapter',
    '',
    'Normalize one native 5x5 top-down 17-piece PNG into the neutral 4x4',
    'WorldForge edge-mask-16 order. No network request is made.',
    '',
    '  pnpm terrain-autotile:spritecook:import -- \\',
    '    --source <spritecook-17-piece.png> \\',
    '    --out <worldforge-edge-mask-16.png> \\',
    '    --report <worldforge-edge-mask-16.json> \\',
    '    --target-cell 32',
    '',
    'Accepted source cells: 16, 32, or 64 pixels; black 1px grid optional.',
    'The SpriteCook 15-piece corner-mask and 1024-upscale modes are rejected.',
    'Output remains an internal-review candidate until art and rights review.',
  ].join('\n');
}

function parseArguments(argv: readonly string[]): Arguments {
  if (argv.length === 1 && argv[0] === '--help') {
    return { help: true, source: '', out: '', report: '' };
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!VALUE_FLAGS.has(flag)) throw new Error('Unknown or unsupported CLI flag.');
    if (values.has(flag)) throw new Error('Duplicate CLI flag.');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('CLI flag value is missing.');
    values.set(flag, value);
    index += 1;
  }
  if (['--source', '--out', '--report'].some((flag) => !values.has(flag))) {
    throw new Error('--source, --out, and --report are required.');
  }
  const targetValue = values.get('--target-cell');
  const targetCell = targetValue === undefined ? undefined : Number(targetValue);
  if (
    targetCell !== undefined
    && ![16, 32, 64].includes(targetCell)
  ) {
    throw new Error('--target-cell must be 16, 32, or 64.');
  }
  return {
    help: false,
    source: values.get('--source')!,
    out: values.get('--out')!,
    report: values.get('--report')!,
    ...(targetCell === undefined
      ? {}
      : { targetCell: targetCell as SpriteCookTopdown17TileSize }),
  };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const sourcePath = resolve(args.source);
  const outputPath = resolve(args.out);
  const reportPath = resolve(args.report);
  if (
    !sourcePath.toLowerCase().endsWith('.png')
    || !outputPath.toLowerCase().endsWith('.png')
    || !reportPath.toLowerCase().endsWith('.json')
    || new Set([sourcePath, outputPath, reportPath]).size !== 3
  ) {
    throw new Error('Source/output/report extensions or paths are invalid.');
  }
  const sourceBytes = Uint8Array.from(await readFile(sourcePath));
  const normalized = await normalizeSpriteCookTopdown17Export(sourceBytes, {
    ...(args.targetCell === undefined
      ? {}
      : { targetCellSize: args.targetCell }),
  });
  await Promise.all([
    mkdir(dirname(outputPath), { recursive: true }),
    mkdir(dirname(reportPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(outputPath, normalized.png.readBytes(), { flag: 'wx' }),
    writeFile(
      reportPath,
      `${JSON.stringify(normalized.report, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    ),
  ]);
  console.log(JSON.stringify({
    status: 'normalized-local-export-written',
    remote_request_count: 0,
    source_format: normalized.report.source.convention,
    output_format: normalized.report.output.convention,
    cell: normalized.report.output.cell_width,
    source_sha256: normalized.report.source.sha256,
    output_sha256: normalized.report.output.sha256,
    output: relative(process.cwd(), outputPath).replaceAll('\\', '/'),
    report: relative(process.cwd(), reportPath).replaceAll('\\', '/'),
    human_review: 'required',
    public_release: 'not-authorized',
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error
    ? error.message
    : 'SpriteCook local export normalization failed.';
  console.error(`MAPSOO_SPRITECOOK_IMPORT_ERROR ${message}`);
  process.exitCode = 1;
});
