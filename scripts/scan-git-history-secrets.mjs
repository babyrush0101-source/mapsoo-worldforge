import { spawnSync } from 'node:child_process';
import { extname } from 'node:path';

const TEXT_EXTENSIONS = new Set([
  '', '.cjs', '.css', '.env', '.gd', '.html', '.ini', '.js', '.json', '.jsx',
  '.md', '.mjs', '.sql', '.toml', '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);
const MAX_BLOB_BYTES = 2 * 1024 * 1024;
const PLACEHOLDER = /(?:change[-_ ]?me|example|placeholder|replace|your[-_ ]|test[-_ ]|dummy|redacted|process\.env|import\.meta\.env)/i;
const RULES = Object.freeze([
  ['openai-key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['password-assignment', /\b(?:admin[_-]?password|password|passwd)\s*[:=]\s*["']([^"'\r\n]{8,})["']/gi],
  ['secret-assignment', /\b(?:api[_-]?secret|client[_-]?secret|service[_-]?key)\s*[:=]\s*["']([^"'\r\n]{12,})["']/gi],
]);
const REVIEWED_FINDINGS = new Map([
  [
    'password-assignment\u0000src/components/auth/AuthCard.tsx\u00001234f683712dc0ed7f6c7bde871065c09996117a',
    'Multilingual UI labels named "password"; the three matched values are translations, not credentials.',
  ],
]);

function git(args, input) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  }
  return result.stdout;
}

const objectPaths = new Map();
for (const line of git(['rev-list', '--objects', '--all']).split(/\r?\n/)) {
  if (!line) continue;
  const separator = line.indexOf(' ');
  const objectId = separator === -1 ? line : line.slice(0, separator);
  const path = separator === -1 ? '' : line.slice(separator + 1);
  if (!objectPaths.has(objectId) || (!objectPaths.get(objectId) && path)) objectPaths.set(objectId, path);
}

const ids = [...objectPaths.keys()];
const checks = git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], `${ids.join('\n')}\n`)
  .split(/\r?\n/)
  .filter(Boolean);
const findings = [];
const reviewedFindings = [];
let scannedBlobs = 0;

for (const check of checks) {
  const [objectId, type, sizeText] = check.split(' ');
  const size = Number(sizeText);
  const path = objectPaths.get(objectId) ?? '';
  if (
    type !== 'blob'
    || !Number.isSafeInteger(size)
    || size > MAX_BLOB_BYTES
    || !TEXT_EXTENSIONS.has(extname(path).toLowerCase())
  ) continue;
  const bytes = spawnSync('git', ['cat-file', 'blob', objectId], {
    cwd: process.cwd(),
    encoding: null,
    maxBuffer: MAX_BLOB_BYTES + 1024,
  });
  if (bytes.status !== 0 || !bytes.stdout || bytes.stdout.includes(0)) continue;
  const text = bytes.stdout.toString('utf8');
  if (text.includes('\uFFFD')) continue;
  scannedBlobs += 1;
  for (const [rule, expression] of RULES) {
    expression.lastIndex = 0;
    let match;
    while ((match = expression.exec(text)) !== null) {
      const candidate = match[1] ?? match[0];
      if (!PLACEHOLDER.test(candidate)) {
        const finding = { rule, path: path || '(unknown path)', object: objectId };
        const reviewedReason = REVIEWED_FINDINGS.get(`${rule}\0${finding.path}\0${objectId}`);
        if (reviewedReason) {
          reviewedFindings.push({ ...finding, reason: reviewedReason });
        } else {
          findings.push(finding);
        }
      }
      if (match[0].length === 0) expression.lastIndex += 1;
    }
  }
}

const unique = [...new Map(
  findings.map((finding) => [`${finding.rule}\0${finding.path}\0${finding.object}`, finding]),
).values()].sort((left, right) => (
  left.rule.localeCompare(right.rule)
  || left.path.localeCompare(right.path)
  || left.object.localeCompare(right.object)
));
const reviewedUnique = [...new Map(
  reviewedFindings.map((finding) => [`${finding.rule}\0${finding.path}\0${finding.object}`, finding]),
).values()].sort((left, right) => (
  left.rule.localeCompare(right.rule)
  || left.path.localeCompare(right.path)
  || left.object.localeCompare(right.object)
));

console.log(
  `MAPSOO_HISTORY_SECRET_SCAN blobs=${scannedBlobs}`
    + ` findings=${unique.length} reviewed=${reviewedUnique.length}`,
);
for (const finding of reviewedUnique) {
  console.log(
    `reviewed rule=${finding.rule} path=${JSON.stringify(finding.path)}`
      + ` object=${finding.object.slice(0, 12)} reason=${JSON.stringify(finding.reason)}`,
  );
}
for (const finding of unique) {
  console.log(
    `finding rule=${finding.rule} path=${JSON.stringify(finding.path)}`
      + ` object=${finding.object.slice(0, 12)}`,
  );
}
if (unique.length > 0) {
  console.error('Historical candidates require maintainer rotation/remediation confirmation; secret values were intentionally not printed.');
  process.exitCode = 1;
}
