import { encodeRgbaPng } from './encode-png';
import {
  WORLD_ASSET_PROFILE_DESCRIPTORS,
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from '../../core/asset-profile';

type Color = readonly [number, number, number, number?];

export type VisualImplementationStatus = 'implemented' | 'visual-prototype';

export interface ProfileVisualAcceptanceContract {
  readonly profile: WorldAssetProfile;
  readonly label: string;
  readonly status: VisualImplementationStatus;
  readonly cameraGrammar: string;
  readonly requiredLayers: readonly string[];
  readonly manualChecks: readonly string[];
  readonly minimums: Readonly<{
    distinctColorBuckets: number;
    luminanceRange: number;
    edgeDensity: number;
  }>;
}

export interface ProfileReferenceScene {
  readonly profile: WorldAssetProfile;
  readonly width: 320;
  readonly height: 180;
  readonly pngBytes: Uint8Array;
  readonly pixels: Uint8Array;
  readonly metrics: Readonly<{
    distinctColorBuckets: number;
    luminanceRange: number;
    edgeDensity: number;
  }>;
}

export const PROFILE_VISUAL_ACCEPTANCE: Readonly<Record<WorldAssetProfile, ProfileVisualAcceptanceContract>> =
  Object.freeze({
    'side-platformer': Object.freeze({
      profile: 'side-platformer',
      label: WORLD_ASSET_PROFILE_DESCRIPTORS['side-platformer'].label,
      status: 'implemented',
      cameraGrammar: 'Orthogonal side view with an uninterrupted readable traversal silhouette.',
      requiredLayers: Object.freeze(['sky', 'far', 'mid', 'playfield', 'near', 'foreground']),
      manualChecks: Object.freeze([
        'Walkable ledges, hazards, checkpoints, and exits remain distinguishable at gameplay scale.',
        'The player silhouette is readable against every traversable surface.',
        'Foreground decoration never hides more than a small part of the playable lane.',
      ]),
      minimums: Object.freeze({ distinctColorBuckets: 18, luminanceRange: 120, edgeDensity: 0.012 }),
    }),
    'topdown-farm': Object.freeze({
      profile: 'topdown-farm',
      label: WORLD_ASSET_PROFILE_DESCRIPTORS['topdown-farm'].label,
      status: 'implemented',
      cameraGrammar: 'Orthogonal top-down tile field with consistent object anchoring and no false horizon.',
      requiredLayers: Object.freeze(['ground', 'water', 'paths', 'soil', 'structures', 'props', 'characters']),
      manualChecks: Object.freeze([
        'Grass, water, paths, and tilled soil are separable without relying on color alone.',
        'Buildings, crops, fences, and trees share a consistent ground-contact convention.',
        'The player and interaction targets remain readable over patterned terrain.',
      ]),
      minimums: Object.freeze({ distinctColorBuckets: 20, luminanceRange: 115, edgeDensity: 0.03 }),
    }),
    'isometric-action': Object.freeze({
      profile: 'isometric-action',
      label: WORLD_ASSET_PROFILE_DESCRIPTORS['isometric-action'].label,
      status: 'implemented',
      cameraGrammar: 'Original 2:1 diamond-grid arena with height cues, Y sorting, and combat-safe silhouettes.',
      requiredLayers: Object.freeze(['void', 'floor', 'elevation', 'walls', 'props', 'actors', 'effects']),
      manualChecks: Object.freeze([
        'The walkable arena boundary and elevation changes can be read before combat begins.',
        'Actors, attacks, and hazards have distinct value groups and do not merge into floor decoration.',
        'Occluding walls and props obey a consistent front-to-back ordering rule.',
      ]),
      minimums: Object.freeze({ distinctColorBuckets: 18, luminanceRange: 135, edgeDensity: 0.013 }),
    }),
    'layered-depth-2d': Object.freeze({
      profile: 'layered-depth-2d',
      label: WORLD_ASSET_PROFILE_DESCRIPTORS['layered-depth-2d'].label,
      status: 'implemented',
      cameraGrammar: 'Original layered 2D stage with restrained depth fog, lighting, and a crisp gameplay plane.',
      requiredLayers: Object.freeze(['sky', 'far', 'mid', 'gameplay', 'near', 'lighting', 'foreground']),
      manualChecks: Object.freeze([
        'Depth treatment strengthens staging without making the gameplay plane look out of focus.',
        'Sprite scale and pixel density remain consistent within the gameplay plane.',
        'Lighting directs attention to traversal and interaction targets instead of decorative noise.',
      ]),
      minimums: Object.freeze({ distinctColorBuckets: 20, luminanceRange: 130, edgeDensity: 0.008 }),
    }),
  });

class Surface {
  readonly pixels: Uint8Array;

  constructor(readonly width: number, readonly height: number, background: Color) {
    this.pixels = new Uint8Array(width * height * 4);
    this.rect(0, 0, width, height, background);
  }

  pixel(x: number, y: number, color: Color): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const offset = (py * this.width + px) * 4;
    const alpha = (color[3] ?? 255) / 255;
    if (alpha >= 1) {
      this.pixels.set([color[0], color[1], color[2], 255], offset);
      return;
    }
    const inverse = 1 - alpha;
    this.pixels[offset] = Math.round(color[0] * alpha + this.pixels[offset] * inverse);
    this.pixels[offset + 1] = Math.round(color[1] * alpha + this.pixels[offset + 1] * inverse);
    this.pixels[offset + 2] = Math.round(color[2] * alpha + this.pixels[offset + 2] * inverse);
    this.pixels[offset + 3] = 255;
  }

  rect(x: number, y: number, width: number, height: number, color: Color): void {
    for (let py = Math.floor(y); py < Math.ceil(y + height); py += 1) {
      for (let px = Math.floor(x); px < Math.ceil(x + width); px += 1) this.pixel(px, py, color);
    }
  }

  circle(cx: number, cy: number, radius: number, color: Color): void {
    for (let y = cy - radius; y <= cy + radius; y += 1) {
      for (let x = cx - radius; x <= cx + radius; x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) this.pixel(x, y, color);
      }
    }
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Color, thickness = 1): void {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
    for (let step = 0; step <= steps; step += 1) {
      const x = x1 + ((x2 - x1) * step) / steps;
      const y = y1 + ((y2 - y1) * step) / steps;
      if (thickness === 1) this.pixel(x, y, color);
      else this.circle(Math.round(x), Math.round(y), Math.floor(thickness / 2), color);
    }
  }

  polygon(points: readonly (readonly [number, number])[], color: Color): void {
    const minimumY = Math.floor(Math.min(...points.map((point) => point[1])));
    const maximumY = Math.ceil(Math.max(...points.map((point) => point[1])));
    for (let y = minimumY; y <= maximumY; y += 1) {
      const intersections: number[] = [];
      for (let index = 0; index < points.length; index += 1) {
        const start = points[index];
        const end = points[(index + 1) % points.length];
        if ((start[1] <= y && end[1] > y) || (end[1] <= y && start[1] > y)) {
          intersections.push(start[0] + ((y - start[1]) * (end[0] - start[0])) / (end[1] - start[1]));
        }
      }
      intersections.sort((a, b) => a - b);
      for (let index = 0; index < intersections.length; index += 2) {
        const end = intersections[index + 1];
        if (end === undefined) continue;
        this.rect(Math.ceil(intersections[index]), y, Math.floor(end) - Math.ceil(intersections[index]) + 1, 1, color);
      }
    }
  }

  diamond(cx: number, cy: number, radiusX: number, radiusY: number, color: Color): void {
    this.polygon([[cx, cy - radiusY], [cx + radiusX, cy], [cx, cy + radiusY], [cx - radiusX, cy]], color);
  }
}

function fingerprint(value: string): number {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function accent(seed: string): Color {
  const hash = fingerprint(seed);
  return [150 + (hash % 85), 70 + ((hash >>> 8) % 120), 80 + ((hash >>> 16) % 130)];
}

function drawPixelCharacter(surface: Surface, x: number, y: number, color: Color, direction: 'left' | 'right' = 'right'): void {
  const outline: Color = [24, 24, 35];
  const skin: Color = [239, 188, 139];
  surface.circle(x, y - 12, 6, outline);
  surface.circle(x, y - 13, 5, skin);
  surface.rect(x - 5, y - 8, 10, 13, outline);
  surface.rect(x - 4, y - 7, 8, 11, color);
  surface.rect(x - 5, y + 4, 4, 8, outline);
  surface.rect(x + 1, y + 4, 4, 8, outline);
  surface.rect(direction === 'right' ? x + 4 : x - 7, y - 5, 4, 3, [245, 205, 92]);
}

function drawSidePlatformer(surface: Surface, seed: string): void {
  const hero = accent(`${seed}:hero`);
  const sky: readonly Color[] = [[19, 27, 62], [29, 45, 83], [49, 73, 104], [88, 111, 119]];
  sky.forEach((color, index) => surface.rect(0, index * 45, 320, 45, color));
  surface.circle(262, 34, 17, [246, 224, 166]);
  surface.circle(256, 30, 14, [29, 45, 83]);
  surface.polygon([[0, 112], [52, 53], [84, 106], [125, 59], [178, 112]], [32, 47, 72]);
  surface.polygon([[96, 116], [163, 47], [210, 102], [247, 60], [320, 116]], [27, 40, 62]);
  for (let x = 0; x < 320; x += 22) {
    const height = 29 + ((x * 7 + fingerprint(seed)) % 30);
    surface.polygon([[x, 132], [x + 10, 132 - height], [x + 20, 132]], [22, 55, 59]);
  }
  surface.rect(0, 135, 320, 45, [32, 37, 48]);
  surface.rect(0, 132, 320, 6, [104, 144, 84]);
  surface.rect(0, 138, 320, 5, [61, 81, 63]);
  surface.rect(70, 105, 86, 12, [50, 50, 59]);
  surface.rect(70, 102, 86, 5, [126, 165, 91]);
  surface.rect(194, 83, 74, 12, [50, 50, 59]);
  surface.rect(194, 80, 74, 5, [126, 165, 91]);
  surface.polygon([[166, 135], [173, 119], [180, 135]], [231, 77, 64]);
  surface.polygon([[181, 135], [188, 119], [195, 135]], [241, 101, 64]);
  surface.circle(219, 75, 4, [255, 209, 93, 180]);
  surface.rect(217, 72, 5, 8, [255, 218, 111]);
  surface.rect(247, 48, 20, 32, [49, 47, 61]);
  surface.rect(251, 55, 12, 25, [18, 27, 40]);
  surface.rect(253, 61, 8, 13, [98, 203, 190]);
  drawPixelCharacter(surface, 42, 120, hero);
  surface.rect(0, 169, 320, 11, [15, 23, 29, 210]);
  for (let x = 5; x < 320; x += 37) surface.circle(x, 170, 18, [10, 28, 28, 190]);
}

function drawTopdownFarm(surface: Surface, seed: string): void {
  const hero = accent(`${seed}:hero`);
  surface.rect(0, 0, 320, 180, [78, 139, 76]);
  for (let index = 0; index < 180; index += 1) {
    const x = (index * 47 + fingerprint(seed)) % 320;
    const y = (index * 29 + (fingerprint(seed) >>> 8)) % 180;
    surface.rect(x, y, 2, 1, index % 3 === 0 ? [112, 164, 87] : [60, 121, 69]);
  }
  surface.polygon([[224, 0], [320, 0], [320, 180], [267, 180], [250, 130], [260, 82]], [43, 105, 148]);
  surface.line(225, 2, 260, 82, [93, 172, 188], 3);
  surface.line(260, 82, 267, 178, [93, 172, 188], 3);
  for (let y = 12; y < 176; y += 18) surface.line(268, y, 294, y + 4, [123, 195, 203], 2);
  surface.line(160, 180, 167, 113, [199, 166, 111], 17);
  surface.line(167, 113, 145, 76, [199, 166, 111], 15);
  surface.line(145, 76, 164, 45, [199, 166, 111], 13);
  surface.rect(20, 103, 104, 58, [111, 70, 47]);
  for (let row = 0; row < 4; row += 1) {
    surface.line(25, 111 + row * 12, 116, 111 + row * 12, [73, 45, 38], 2);
    for (let column = 0; column < 8; column += 1) {
      surface.circle(31 + column * 12, 108 + row * 12, 3, row % 2 ? [219, 177, 73] : [75, 157, 74]);
    }
  }
  surface.polygon([[36, 41], [76, 22], [116, 41], [76, 62]], [157, 61, 55]);
  surface.polygon([[42, 40], [76, 25], [110, 40], [76, 55]], [201, 83, 61]);
  surface.rect(46, 40, 60, 35, [224, 193, 137]);
  surface.rect(72, 54, 13, 21, [102, 66, 48]);
  surface.rect(51, 49, 11, 9, [97, 171, 185]);
  surface.polygon([[151, 36], [182, 20], [213, 36], [182, 51]], [91, 53, 53]);
  surface.rect(156, 36, 52, 31, [178, 70, 57]);
  surface.rect(176, 48, 15, 19, [235, 214, 164]);
  for (const [x, y] of [[17, 27], [128, 20], [295, 34], [212, 132], [136, 143]] as const) {
    surface.circle(x + 3, y + 5, 11, [37, 92, 54]);
    surface.circle(x - 3, y, 9, [52, 126, 61]);
    surface.circle(x + 6, y - 3, 7, [81, 151, 72]);
    surface.rect(x, y + 8, 4, 11, [92, 59, 42]);
  }
  for (let x = 9; x < 138; x += 13) {
    surface.rect(x, 84, 3, 13, [112, 73, 47]);
    surface.rect(x, 86, 10, 3, [137, 91, 52]);
  }
  drawPixelCharacter(surface, 176, 122, hero);
  surface.circle(196, 132, 3, [245, 227, 112]);
  surface.circle(204, 128, 3, [242, 142, 150]);
}

function drawIsometricAction(surface: Surface, seed: string): void {
  const hero = accent(`${seed}:hero`);
  surface.rect(0, 0, 320, 180, [12, 17, 29]);
  surface.circle(55, 30, 24, [62, 35, 78, 100]);
  surface.circle(275, 38, 30, [28, 76, 83, 90]);
  const originX = 160;
  const originY = 30;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 9; column += 1) {
      const x = originX + (column - row) * 18;
      const y = originY + (column + row) * 9;
      const edge = row === 0 || column === 0 || row === 7 || column === 8;
      surface.diamond(x, y, 18, 9, edge ? [65, 55, 73] : (row + column) % 2 ? [76, 62, 82] : [70, 59, 77]);
      surface.line(x - 18, y, x, y + 9, [37, 34, 51]);
    }
  }
  surface.polygon([[16, 101], [160, 173], [304, 101], [304, 111], [160, 180], [16, 111]], [28, 27, 41]);
  surface.polygon([[70, 74], [106, 56], [142, 74], [106, 92]], [93, 79, 101]);
  surface.polygon([[70, 74], [106, 92], [106, 111], [70, 93]], [47, 41, 59]);
  surface.polygon([[142, 74], [106, 92], [106, 111], [142, 93]], [56, 46, 64]);
  for (const [x, y] of [[92, 83], [238, 84], [146, 127], [205, 111]] as const) {
    surface.diamond(x, y, 8, 4, [42, 35, 52]);
    surface.rect(x - 3, y - 14, 6, 14, [78, 61, 72]);
    surface.circle(x, y - 16, 6, [255, 118, 71, 130]);
    surface.circle(x, y - 17, 3, [255, 216, 112]);
  }
  surface.diamond(188, 71, 21, 10, [31, 103, 111]);
  surface.diamond(188, 71, 12, 6, [68, 196, 177]);
  surface.circle(188, 67, 5, [176, 250, 209, 180]);
  drawPixelCharacter(surface, 162, 112, hero);
  surface.circle(131, 111, 7, [27, 30, 40]);
  surface.circle(131, 108, 5, [218, 72, 87]);
  surface.rect(126, 114, 10, 7, [58, 37, 51]);
  surface.line(168, 96, 184, 86, [250, 219, 117], 2);
  surface.circle(185, 85, 4, [255, 223, 119, 160]);
}

function drawLayeredDepth(surface: Surface, seed: string): void {
  const hero = accent(`${seed}:hero`);
  const sky: readonly Color[] = [[24, 29, 54], [35, 47, 75], [59, 72, 91], [113, 103, 103]];
  sky.forEach((color, index) => surface.rect(0, index * 45, 320, 45, color));
  surface.circle(247, 35, 20, [255, 224, 174, 210]);
  surface.polygon([[0, 109], [54, 56], [93, 105], [153, 49], [211, 108]], [45, 53, 73, 210]);
  surface.polygon([[112, 111], [195, 57], [245, 101], [282, 69], [320, 105], [320, 126], [112, 126]], [35, 49, 65, 235]);
  for (let x = 0; x < 320; x += 34) {
    const height = 34 + ((x + fingerprint(seed)) % 30);
    surface.rect(x + 13, 116 - height, 5, height, [28, 54, 53]);
    surface.circle(x + 15, 112 - height, 14, [26, 68, 60]);
  }
  surface.rect(0, 126, 320, 54, [26, 31, 39]);
  surface.rect(0, 121, 320, 8, [76, 91, 74]);
  surface.rect(89, 99, 118, 23, [63, 59, 67]);
  for (let x = 95; x < 205; x += 22) surface.rect(x, 104, 14, 18, [37, 39, 50]);
  surface.rect(103, 92, 6, 29, [87, 73, 69]);
  surface.rect(188, 88, 7, 33, [87, 73, 69]);
  surface.circle(106, 90, 7, [255, 178, 92, 150]);
  surface.circle(191, 86, 7, [255, 178, 92, 150]);
  surface.circle(106, 90, 3, [255, 225, 133]);
  surface.circle(191, 86, 3, [255, 225, 133]);
  surface.rect(0, 151, 320, 29, [19, 39, 45]);
  for (let x = 0; x < 320; x += 23) surface.line(x, 161, x + 15, 159, [41, 77, 80], 1);
  drawPixelCharacter(surface, 153, 110, hero);
  surface.circle(153, 100, 18, [255, 188, 94, 25]);
  for (let x = -5; x < 325; x += 29) {
    surface.circle(x, 176, 17, [10, 30, 28, 225]);
    surface.circle(x + 10, 167, 10, [17, 48, 39, 220]);
  }
  surface.rect(0, 177, 320, 3, [8, 18, 22]);
}

function metrics(pixels: Uint8Array, width: number, height: number) {
  const buckets = new Set<number>();
  let minimum = 255;
  let maximum = 0;
  let edges = 0;
  let comparisons = 0;
  const luminanceAt = (offset: number) =>
    Math.round(pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const luminance = luminanceAt(offset);
      minimum = Math.min(minimum, luminance);
      maximum = Math.max(maximum, luminance);
      buckets.add((pixels[offset] >> 4) << 8 | (pixels[offset + 1] >> 4) << 4 | (pixels[offset + 2] >> 4));
      if (x > 0) {
        comparisons += 1;
        if (Math.abs(luminance - luminanceAt(offset - 4)) >= 28) edges += 1;
      }
      if (y > 0) {
        comparisons += 1;
        if (Math.abs(luminance - luminanceAt(offset - width * 4)) >= 28) edges += 1;
      }
    }
  }
  return Object.freeze({
    distinctColorBuckets: buckets.size,
    luminanceRange: maximum - minimum,
    edgeDensity: Number((edges / comparisons).toFixed(4)),
  });
}

export function renderProfileReferenceScene(profile: WorldAssetProfile, seed = 'mapsoo-visual-baseline-001'): ProfileReferenceScene {
  if (!WORLD_ASSET_PROFILES.includes(profile)) throw new Error(`Unsupported visual profile: ${String(profile)}.`);
  const surface = new Surface(320, 180, [0, 0, 0]);
  if (profile === 'side-platformer') drawSidePlatformer(surface, seed);
  else if (profile === 'topdown-farm') drawTopdownFarm(surface, seed);
  else if (profile === 'isometric-action') drawIsometricAction(surface, seed);
  else drawLayeredDepth(surface, seed);
  return Object.freeze({
    profile,
    width: 320,
    height: 180,
    pngBytes: encodeRgbaPng(320, 180, surface.pixels),
    pixels: surface.pixels.slice(),
    metrics: metrics(surface.pixels, 320, 180),
  });
}

export function assertProfileReferenceScene(scene: ProfileReferenceScene): void {
  const contract = PROFILE_VISUAL_ACCEPTANCE[scene.profile];
  const failures: string[] = [];
  if (scene.metrics.distinctColorBuckets < contract.minimums.distinctColorBuckets) {
    failures.push(`color buckets ${scene.metrics.distinctColorBuckets} < ${contract.minimums.distinctColorBuckets}`);
  }
  if (scene.metrics.luminanceRange < contract.minimums.luminanceRange) {
    failures.push(`luminance range ${scene.metrics.luminanceRange} < ${contract.minimums.luminanceRange}`);
  }
  if (scene.metrics.edgeDensity < contract.minimums.edgeDensity) {
    failures.push(`edge density ${scene.metrics.edgeDensity} < ${contract.minimums.edgeDensity}`);
  }
  if (failures.length > 0) throw new Error(`${scene.profile} visual baseline failed: ${failures.join(', ')}.`);
}
