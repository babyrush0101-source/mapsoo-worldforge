const REPOSITORY_URL = 'https://github.com/babyrush0101-source/mapsoo-worldforge';
export const CURRENT_PUBLIC_RELEASE_VERSION = '0.1.0-alpha.9' as const;
const tag = `v${CURRENT_PUBLIC_RELEASE_VERSION}`;
const compatibilityPackTag = 'v0.1.0-alpha.7' as const;
const releaseDownloadUrl = `${REPOSITORY_URL}/releases/download/${tag}`;

function publicPack(id: string, filename: string, sha256: string) {
  return Object.freeze({ id, filename, url: `${releaseDownloadUrl}/${filename}`, sha256 });
}

const sunnyMeadowPack = publicPack(
  'sunny-meadow',
  `mapsoo-sunny-meadow-${compatibilityPackTag}.zip`,
  '6113b30fec3615b72730d8d775919aa3c5552285c614b6916a109b887ab8012c',
);
const dustwindOutpostPack = publicPack(
  'dustwind-outpost',
  `mapsoo-dustwind-outpost-${compatibilityPackTag}.zip`,
  'd6dd38a47522f45d24184d9b6869d92b89cc2ae3ad1c2ca1eab0b9cf4b13a502',
);
const frostwatchValePack = publicPack(
  'frostwatch-vale',
  `mapsoo-frostwatch-vale-${compatibilityPackTag}.zip`,
  '35a49edd901becae1422731a132803eebaf07659fc3d69efa7d39cd1e87b9e12',
);

export const CURRENT_PUBLIC_RELEASE = Object.freeze({
  version: CURRENT_PUBLIC_RELEASE_VERSION,
  tag,
  releaseUrl: `${REPOSITORY_URL}/releases/tag/${tag}`,
  assetPack: sunnyMeadowPack,
  assetPacks: Object.freeze([sunnyMeadowPack, dustwindOutpostPack, frostwatchValePack]),
  godotImporter: Object.freeze({
    filename: `mapsoo-godot-importer-${tag}.zip`,
    url: `${releaseDownloadUrl}/mapsoo-godot-importer-${tag}.zip`,
    sha256: 'bfb736d044818b01955feb35d84b438fe6c139e77764907847a1f4d89ea7b526',
  }),
  completeFarmPack: Object.freeze({
    filename: `mapsoo-alpha9-godot-smoke-${tag}.zip`,
    url: `${releaseDownloadUrl}/mapsoo-alpha9-godot-smoke-${tag}.zip`,
    sha256: '10d89c7888b70215a14af2b6552fc5237d799df9cd3092aee99541961d9e480c',
  }),
  firstImportGuideUrl: `${REPOSITORY_URL}/blob/main/docs/releases/v0.1.0-alpha.9.md`,
  feedbackFormUrl: `${REPOSITORY_URL}/issues/new?template=first-import-feedback.yml`,
  feedbackIndexUrl: `${REPOSITORY_URL}/issues/12`,
} as const);
