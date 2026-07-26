import {
  projectCharacterIdentity,
  type CharacterIdentityProjection,
  type CharacterIdentitySignature,
} from '../../core/character-identity-signature';
import type { WorldAssetProfile } from '../../core/asset-profile';

type Rgba = readonly [number, number, number, number];

export interface CharacterIdentityPose {
  readonly action: string;
  readonly direction: string;
  readonly frame: number;
}

export interface RenderedCharacterIdentityFrame {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly projection: CharacterIdentityProjection;
}

const TARGET_BODY = Object.freeze({
  'topdown-farm': Object.freeze({ width: 22, height: 28 }),
  'side-platformer': Object.freeze({ width: 22, height: 58 }),
  'isometric-action': Object.freeze({ width: 32, height: 56 }),
  'layered-depth-2d': Object.freeze({ width: 32, height: 65 }),
});

function rgba(hex: string): Rgba {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
    255,
  ];
}

export function decodeCharacterIdentitySilhouette(signature: CharacterIdentitySignature): Uint8Array {
  const mask = new Uint8Array(16 * 16);
  for (let nibbleIndex = 0; nibbleIndex < signature.silhouette_hex.length; nibbleIndex += 1) {
    const nibble = Number.parseInt(signature.silhouette_hex[nibbleIndex], 16);
    for (let bit = 0; bit < 4; bit += 1) {
      mask[nibbleIndex * 4 + bit] = (nibble & (1 << (3 - bit))) !== 0 ? 1 : 0;
    }
  }
  return mask;
}

function maskAt(mask: Uint8Array, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= 16 || y >= 16) return 0;
  return mask[y * 16 + x];
}

function boundary(mask: Uint8Array, x: number, y: number): boolean {
  return maskAt(mask, x - 1, y) === 0
    || maskAt(mask, x + 1, y) === 0
    || maskAt(mask, x, y - 1) === 0
    || maskAt(mask, x, y + 1) === 0;
}

function setPixel(pixels: Uint8Array, width: number, height: number, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  pixels.set(color, (y * width + x) * 4);
}

function poseOffset(profile: WorldAssetProfile, pose: CharacterIdentityPose): readonly [number, number] {
  const active = ['walk', 'run'].includes(pose.action);
  const horizontal = pose.action === 'hurt' ? (pose.frame % 2 === 0 ? -1 : 1) : 0;
  const vertical = pose.action === 'jump'
    ? -3
    : pose.action === 'fall'
      ? 2
      : pose.action === 'land'
        ? 1
        : active && pose.frame % 2 === 1
          ? profile === 'topdown-farm' ? 1 : -1
          : 0;
  return [horizontal, vertical];
}

function lowerBodyStride(sourceX: number, sourceY: number, pose: CharacterIdentityPose): number {
  if (!['walk', 'run'].includes(pose.action) || sourceY < 12) return 0;
  const phase = pose.frame % 2 === 0 ? 1 : -1;
  return sourceX < 8 ? phase : -phase;
}

function isMirrored(direction: string): boolean {
  return direction === 'left' || direction === 'west';
}

export function renderCharacterIdentityFrame(
  signature: CharacterIdentitySignature,
  profile: WorldAssetProfile,
  pose: CharacterIdentityPose,
): RenderedCharacterIdentityFrame {
  const projection = projectCharacterIdentity(signature, profile);
  const [frameWidth, frameHeight] = projection.frame_size;
  const geometry = TARGET_BODY[profile];
  const mask = decodeCharacterIdentitySilhouette(signature);
  const pixels = new Uint8Array(frameWidth * frameHeight * 4);
  const outline = rgba(signature.palette.outline);
  const primary = rgba(signature.palette.primary);
  const secondary = rgba(signature.palette.secondary);
  const accent = rgba(signature.palette.accent);
  const left = Math.round(projection.pivot[0] - geometry.width / 2);
  const top = projection.pivot[1] - geometry.height + 1;
  const mirrored = isMirrored(pose.direction);
  const [poseX, poseY] = poseOffset(profile, pose);
  const headLimit = Math.min(15, Math.round(signature.anchors.head[1] / 1000 * 15) + 2);
  const accessoryAnchor = mirrored ? signature.anchors.left : signature.anchors.right;
  const accessoryX = Math.round(accessoryAnchor[0] / 1000 * 15);
  const accessoryY = Math.round(accessoryAnchor[1] / 1000 * 15);

  for (let targetY = 0; targetY < geometry.height; targetY += 1) {
    const sourceY = Math.min(15, Math.floor(targetY / geometry.height * 16));
    for (let targetX = 0; targetX < geometry.width; targetX += 1) {
      const sampledX = Math.min(15, Math.floor(targetX / geometry.width * 16));
      const sourceX = mirrored ? 15 - sampledX : sampledX;
      if (maskAt(mask, sourceX, sourceY) === 0) continue;
      const accentPixel = Math.abs(sourceX - accessoryX) <= 1 && Math.abs(sourceY - accessoryY) <= 2;
      const color = accentPixel
        ? accent
        : boundary(mask, sourceX, sourceY) || sourceY >= 14
          ? outline
          : sourceY <= headLimit
            ? secondary
            : primary;
      const stride = lowerBodyStride(sourceX, sourceY, pose);
      setPixel(pixels, frameWidth, frameHeight, left + targetX + poseX + stride, top + targetY + poseY, color);
    }
  }

  return Object.freeze({
    width: frameWidth,
    height: frameHeight,
    pixels,
    projection,
  });
}

export function blitCharacterIdentityFrame(
  target: Uint8Array,
  targetWidth: number,
  targetHeight: number,
  frame: RenderedCharacterIdentityFrame,
  originX: number,
  originY: number,
): void {
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const sourceOffset = (y * frame.width + x) * 4;
      if (frame.pixels[sourceOffset + 3] === 0) continue;
      const targetX = originX + x;
      const targetY = originY + y;
      if (targetX < 0 || targetY < 0 || targetX >= targetWidth || targetY >= targetHeight) continue;
      target.set(frame.pixels.subarray(sourceOffset, sourceOffset + 4), (targetY * targetWidth + targetX) * 4);
    }
  }
}
