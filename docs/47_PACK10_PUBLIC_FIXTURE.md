# Pack 1.0 public synthetic fixture

`tests/fixtures/pack10-public/` is the neutral, deterministic Pack 1.0
conformance fixture. It is deliberately separate from production-art review
material.

The fixture contains only fixed-palette procedural PNG files, small runtime
JSON documents, a synthetic recipe record, a CC0 notice, the Pack 1.0
manifest, and a deterministic ZIP. It contains no input references, raw
prompts, generative-AI output, private integration identity, absolute path,
URL, script, executable, or shader.

All animation frames are explicitly marked
`declared-synthetic-variant`. The manifest is `public`, uses `CC0-1.0`, and
records passing human-art, rights, runtime, and Raspberry Pi contract gates.
This `pass` belongs only to the deliberately tiny synthetic conformance
fixture; it is not evidence that the separate production-art candidate has
passed a physical-device benchmark.

Build the committed fixture:

```text
node scripts/build-pack10-public-fixture.mjs
```

Verify schema conformance, file hashes, every reference, runtime route,
synthetic provenance, content hygiene, ZIP inventory, and two-build byte
reproducibility:

```text
node scripts/verify-pack10-public-fixture.mjs
```

The validator requires the checked-in source directory to match a fresh build
byte for byte, then builds the ignored release ZIP twice and requires identical
archive bytes. A clean clone therefore needs no committed ZIP. Production-art
files are neither read nor copied.
