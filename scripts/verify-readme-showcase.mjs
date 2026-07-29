import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(
  root,
  'docs/visual-qa/production-art/showcase-manifest.json',
);
const readmePath = resolve(root, 'README.md');
const reviewPath = resolve(
  root,
  'docs/visual-qa/production-art/ai-assisted-art-review-v1.md',
);
const noticePath = resolve(
  root,
  'docs/visual-qa/production-art/SHOWCASE_LICENSE.md',
);

function fail(message) {
  throw new Error(`README showcase verification failed: ${message}`);
}

function assertSafeRelativePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('\\')
    || value.startsWith('/')
    || /^[A-Za-z]:/.test(value)
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    fail(`unsafe showcase path ${JSON.stringify(value)}`);
  }
}

function readPngDimensions(bytes, path) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) {
    fail(`${path} is not a PNG`);
  }
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') {
    fail(`${path} has no leading IHDR chunk`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (
  manifest.schema !== 'mapsoo-readme-showcase-1.0'
  || manifest.status !== 'documentation-display-approved'
  || manifest.contains_generative_ai !== true
  || manifest.cross_version_result !== 'byte-identical'
  || manifest.asset_pack_distribution !== 'internal-review'
  || manifest.asset_pack_redistribution_approved !== false
  || manifest.physical_raspberry_pi_4b_tested !== false
) {
  fail('manifest claim boundary changed');
}
if (
  !Array.isArray(manifest.godot_versions)
  || manifest.godot_versions.join(',') !== '4.3,4.7'
  || !Array.isArray(manifest.files)
  || manifest.files.length !== 4
) {
  fail('manifest inventory changed');
}

const readme = await readFile(readmePath, 'utf8');
const review = await readFile(reviewPath, 'utf8');
const notice = await readFile(noticePath, 'utf8');
if (!/not covered by the repository\s+MIT\s+license/.test(notice)) {
  fail('showcase license exclusion is missing');
}
if (!review.includes('Status: `revise`') || !review.includes('`blocked`')) {
  fail('AI pre-review no longer records its blocked release status');
}

const profiles = new Set();
for (const file of manifest.files) {
  if (
    typeof file.profile !== 'string'
    || profiles.has(file.profile)
    || !Number.isInteger(file.width)
    || !Number.isInteger(file.height)
    || !/^[0-9a-f]{64}$/.test(file.sha256)
  ) {
    fail('invalid file record');
  }
  profiles.add(file.profile);
  assertSafeRelativePath(file.path);
  if (!readme.includes(`(${file.path})`)) {
    fail(`${file.path} is not referenced by README.md`);
  }

  const absolute = resolve(root, ...file.path.split('/'));
  if (!absolute.startsWith(`${root}${sep}`)) {
    fail(`${file.path} escapes the repository`);
  }
  const bytes = await readFile(absolute);
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== file.sha256) {
    fail(`${file.path} SHA-256 mismatch`);
  }
  const dimensions = readPngDimensions(bytes, file.path);
  if (dimensions.width !== file.width || dimensions.height !== file.height) {
    fail(`${file.path} dimensions changed`);
  }
  if (!review.includes(file.sha256)) {
    fail(`${file.path} is not bound by the public pre-review`);
  }

  const ascii = bytes.toString('ascii').toLowerCase();
  for (const forbidden of ['stoyo', 'babyr', 'api_key', 'authorization: bearer']) {
    if (ascii.includes(forbidden)) {
      fail(`${file.path} contains forbidden embedded text`);
    }
  }
}

console.log(`MAPSOO_README_SHOWCASE_OK files=${manifest.files.length}`);
