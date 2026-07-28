# Security Policy

Mapsoo WorldForge processes local project data and may connect to optional image-generation providers. Please do not report credentials, private prompts, or vulnerable deployments in a public issue.

## Supported versions

Security fixes currently target the latest development release until the first stable version is published.

## Reporting

Use GitHub's private vulnerability reporting feature for this repository when available. If private reporting is unavailable, contact the maintainer privately through the contact method on the maintainer's GitHub profile and include only the minimum reproduction details.

## Scope priorities

- Path traversal or unsafe file paths in generated packs.
- ZIP extraction or overwrite vulnerabilities.
- Exposure of provider API keys.
- Cross-site scripting through imported World Specs or manifest metadata.
- Godot importer writes outside the selected project area.
- Malicious images or manifests causing denial of service.
- Supply-chain and release artifact tampering.

Do not include real API keys or children's/private External Host data in a report. Use synthetic fixtures.
