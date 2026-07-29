# Lanternmere Crossing: Layered-Depth Production Layers v1

## Scope and status

This package supplies eight original production-art candidate layers for the
`layered-depth-2d` profile. Every runtime layer is exactly 1280 x 720 pixels.
The integrated contract is:

`docs/visual-qa/production-art/layered-depth-2d-production-layers-v1.json`

Its status is `runtime-candidate`, `internal-review`, and `UNRELEASED`.
Human art review, Godot integration, and Raspberry Pi 4B runtime review remain
pending.

This is not a complete world asset pack. It also makes no claim that the
flattened visual-direction image was automatically separated into layers.

## Honest source provenance

The project-owned
`docs/visual-qa/production-art/layered-depth-2d-direction-v1.png` was used only
as a reference for palette, pixel-painting finish, dusk lighting, architecture,
and material language.

Each role was generated independently with Codex built-in image generation.
Each default generated original was retained, and a copy of every selected
source was placed in the project. No layer was extracted from the flattened
direction image.

| Role | Project source | Source treatment |
| --- | --- | --- |
| `background.sky` | `layered-depth-2d-background-sky-source-v1.png` | Opaque original dusk sky |
| `background.far` | `layered-depth-2d-background-far-source-v1.png` | Independent skyline on flat magenta |
| `background.mid` | `layered-depth-2d-background-mid-source-v1.png` | Independent bridge and market band on flat magenta |
| `background.depth-fog` | `layered-depth-2d-background-depth-fog-source-v1.png` | Independent lavender mist on pure black intensity background |
| `near.overlay` | `layered-depth-2d-near-overlay-source-v1.png` | Independent near masonry and foliage on flat magenta |
| `foreground.overlay` | `layered-depth-2d-foreground-overlay-source-v1.png` | Independent dark front framing on flat magenta |
| `lighting.ambient` | `layered-depth-2d-lighting-ambient-source-v1.png` | Opaque abstract color-grade texture |
| `lighting.local` | `layered-depth-2d-lighting-local-source-v1.png` | Independent amber and teal light pools on pure black intensity background |

All paths in the table are under
`docs/visual-qa/production-art/`. Exact source bytes and SHA-256 values are
recorded in the integrated manifest.

Prompt intent was kept role-specific:

- sky: empty mauve-indigo blue-hour sky with sparse clouds and a peach horizon;
- far: distant slate-roof canal-town skyline with sparse warm windows;
- mid: mossy bridge, canal masonry, market roofs, posts, and lanterns;
- depth fog: separated cool lavender canal-mist banks;
- near: parapet fragments, reeds, flowers, mooring posts, and short rails,
  leaving the center clear;
- foreground: dark reeds, vines, flowers, and cropped masonry framing the
  lower corners while leaving the center clear;
- ambient: non-representational indigo/violet/teal full-frame grade;
- local light: five amber pools and one restrained teal pool.

Every prompt prohibited characters, text, logos, trademarks, watermarks, UI,
and borders.

## Runtime files and render contract

Runtime files follow one stable rule:

`layered-depth-2d-<role-slug>-runtime-v1.png`

The role slugs are `background-sky`, `background-far`, `background-mid`,
`background-depth-fog`, `near-overlay`, `foreground-overlay`,
`lighting-ambient`, and `lighting-local`.

Suggested ordering and blending are recorded per layer:

| Role | Z | Blend | Alpha | Parallax |
| --- | ---: | --- | --- | ---: |
| `background.sky` | 0 | mix | opaque | 0.05 |
| `background.far` | 10 | mix | straight-alpha | 0.18 |
| `background.mid` | 20 | mix | straight-alpha | 0.38 |
| `background.depth-fog` | 30 | mix | straight-alpha | 0.50 |
| `near.overlay` | 70 | mix | straight-alpha | 1.08 |
| `foreground.overlay` | 80 | mix | straight-alpha | 1.22 |
| `lighting.ambient` | 90 | multiply | opaque | 0 |
| `lighting.local` | 100 | add | straight-alpha | 0 |

These are proposed integration values, not evidence of a completed Godot test.

## Horizontal edge and repeat policy

The generated sources are authored single-screen compositions, not seamless
textures. Every layer therefore declares:

- repeat strategy: `clamp-no-repeat`;
- authored viewport: 1280 pixels wide;
- horizontal policy: clamp at the authored boundary;
- no seamless-repeat claim.

The manifest records four-column alpha and RGB measurements for both
horizontal edges. Those measurements detect stale outputs but do not turn a
non-seamless image into a repeatable texture. A later scrolling world should
commission wider overscan sources or dedicated seamless variants instead of
silently repeating these files.

## Alpha conversion

Sky and ambient lighting are forced fully opaque.

Magenta sources use the image-generation skill's chroma workflow:

1. sample the border median;
2. calculate a soft max-channel-distance matte;
3. combine it with key-channel dominance;
4. apply bounded spill cleanup;
5. contract alpha by one source pixel;
6. clear RGB whenever alpha reaches zero;
7. nearest-neighbour normalize to 1280 x 720.

Fog and local lighting are not described as native-transparent model outputs.
They are separately generated black-background intensity sources. The builder
uses maximum RGB intensity as alpha and reconstructs straight RGB before
normalization.

## Character-route gate

The front-of-character layers are checked against a conservative central
route:

- x: 544 through 735;
- y: 360 through 647;
- size: 192 x 288 pixels.

For `near.overlay` and `foreground.overlay`:

- alpha of 128 or more may cover at most 1% of the route;
- mean route alpha may not exceed 3/255.

This protects a practical center lane for the player sprite. It does not prove
all camera layouts or character sizes are readable.

## Build and strict verification

Run from the repository root:

```powershell
node scripts/build-layered-depth-2d-production-layers.mjs
node scripts/verify-layered-depth-2d-production-layers.mjs
```

The builder pins all eight generated sources by exact dimensions, bytes, and
SHA-256; performs deterministic conversion and normalization; records alpha,
edge, route, and runtime hash metrics; and refuses to overwrite changed output
by default.

`--replace-generated` is reserved for an intentional reviewed change to the
source or conversion algorithm. Routine builds and CI must omit it.

The strict verifier independently checks:

- safe repository-relative paths;
- exact source identities and retained-generation provenance;
- eight required roles in canonical order;
- exact 1280 x 720 runtime dimensions;
- bytes and SHA-256 for every source and runtime PNG;
- opaque and straight-alpha contracts;
- zero hidden RGB and zero opaque chroma spill;
- alpha coverage and horizontal-edge metrics;
- front-plane character-route limits;
- unreleased status and pending human/Godot/Pi approvals.

Automated success means the files are internally consistent and sanitized. A
human must still review each layer alone and in composition, followed by a
Godot camera/parallax test and a measured Raspberry Pi 4B run.
