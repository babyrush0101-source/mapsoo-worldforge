# Product identity and Pack compatibility

Status: **active**

The current open-source product and repository are named **Mapsoo WorldForge**
and **`mapsoo-worldforge`**.

Published Alpha Packs identify their generator as **Mapsoo Worldsmith**. That
string is a protocol value, not the current product name. It remains embedded
in immutable manifests, schemas, receipts, release filenames, video evidence,
archive hashes, and Godot validators.

## Rules

Current product-facing surfaces use **Mapsoo WorldForge**:

- repository and package name;
- README and contributor/governance documents;
- browser title, Workbench header, and footer;
- Godot project/plugin display text;
- new application and outreach material.

Compatibility surfaces retain **Mapsoo Worldsmith**:

- every already-published Pack manifest and generated Pack README;
- Pack schema literals and receipt verification;
- Godot importer generator checks;
- immutable release ZIP/video names and release evidence;
- historical release notes, captures, fixtures, and itch drafts.

Do not globally replace the legacy string. A future Pack generator identity
change requires:

1. a new schema version;
2. an importer that accepts both identities only for their declared versions;
3. new fixtures and negative tests;
4. a migration note;
5. no change to existing tag assets or registered hashes.

`pnpm product-identity:verify` checks both sides: current surfaces must use
WorldForge, while the Pack validator, Godot importer, and Alpha release naming
must keep the legacy identity.
