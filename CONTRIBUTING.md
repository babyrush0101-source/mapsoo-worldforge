# Contributing to Mapsoo Worldsmith

Thanks for helping make world-asset creation more open and useful to Godot creators.

## Before opening a pull request

1. Open or comment on an issue for changes that affect schemas, exported file structures, stable IDs, licenses, or Godot compatibility.
2. Keep pull requests focused on one capability or fix.
3. Do not add private External Host data, production credentials, copyrighted characters, or assets without clear redistribution rights.
4. Run the complete check:

```bash
pnpm install
pnpm check
```

## Project rules

- PNG and JSON manifests are the portable source of truth; Godot resources are derived.
- The offline procedural provider must remain usable without an API key.
- Core generation must be deterministic for a fixed schema version, provider version, spec, and seed.
- Every exported asset needs license and provenance metadata.
- New provider integrations must implement the shared provider contract and must not bypass validation.
- Published source IDs and atlas coordinates are compatibility surfaces; do not reorder them casually.

## Good first contributions

- Documentation and translations.
- New validation rules with tests.
- Small, CC0 example recipes.
- Godot importer fixtures.
- Accessibility and keyboard improvements.
- Reproducible bug reports with a World Spec and seed.

## Commit and PR notes

Explain what changed, why it changed, how it was tested, and whether it changes a schema or exported pack. Include screenshots for visible UI changes and a small fixture for generator/export changes.
