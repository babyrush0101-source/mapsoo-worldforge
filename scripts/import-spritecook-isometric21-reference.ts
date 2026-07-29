import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import {
  normalizeSpriteCookIsometric21Reference,
} from '../src/adapters/spritecook/normalize-spritecook-isometric21-reference';

const VALUE_FLAGS = new Set(['--source', '--out', '--report']);

interface Arguments {
  readonly help: boolean;
  readonly source: string;
  readonly out: string;
  readonly report: string;
}

function usage(): string {
  return [
    'Mapsoo Worldforge — SpriteCook 2:1 isometric reference adapter',
    '',
    'Validate one native SpriteCook 2:1 reference-grid PNG and independently',
    'render the exact 8x8 / 96x48 geometry guide used by the isometric-action',
    'terrain-sheet production task. No source pixels are copied.',
    '',
    '  pnpm production-art:spritecook:isometric-reference -- \\',
    '    --source <spritecook-isometric-2-1.png> \\',
    '    --out <worldforge-isometric-terrain-geometry.png> \\',
    '    --report <worldforge-isometric-terrain-geometry.json>',
    '',
    'Accepted source widths: 32 or 64 pixels per diamond; 1-16 columns/rows.',
    'The native 2px gaps and 2px inset are validated exactly.',
    'Top-down, 1024-upscale, malformed, or spilled-cell exports are rejected.',
    '',
    'The output is a CC0 geometry reference, not a runtime asset or final art.',
    'Use it as the optional environment reference for isometric terrain-sheet',
    'generation together with an approved scene-direction style reference.',
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
  if (
    argv.length !== VALUE_FLAGS.size * 2
    || [...VALUE_FLAGS].some((flag) => !values.has(flag))
  ) {
    throw new Error('--source, --out, and --report are required exactly once.');
  }
  return {
    help: false,
    source: values.get('--source')!,
    out: values.get('--out')!,
    report: values.get('--report')!,
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
  const normalized = await normalizeSpriteCookIsometric21Reference(sourceBytes);
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
    status: 'isometric-geometry-reference-written',
    remote_request_count: 0,
    source_format: normalized.report.source.convention,
    output_format: normalized.report.output.convention,
    source_pixels_copied: false,
    source_sha256: normalized.report.source.sha256,
    output_sha256: normalized.report.output.sha256,
    output: relative(process.cwd(), outputPath).replaceAll('\\', '/'),
    report: relative(process.cwd(), reportPath).replaceAll('\\', '/'),
    runtime_asset: false,
    human_review: 'required',
    public_release: 'reference-only',
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error
    ? error.message
    : 'SpriteCook isometric reference normalization failed.';
  console.error(`MAPSOO_SPRITECOOK_ISOMETRIC_REFERENCE_ERROR ${message}`);
  process.exitCode = 1;
});
