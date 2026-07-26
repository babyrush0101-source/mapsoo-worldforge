# Governance

Mapsoo Worldsmith is currently maintained by its creator, GitHub user **[babyrush0101-source](https://github.com/babyrush0101-source)**, who acts as the **Primary Maintainer**. This document describes the decisions and response expectations that apply while the project has a single maintainer. It does not imply a larger team, an established user community, or external adoption.

## Responsibilities

The Primary Maintainer is responsible for:

- setting the public roadmap and keeping project claims evidence-based;
- triaging issues and pull requests;
- deciding schema, stable-ID, export-format, and Godot compatibility changes;
- reviewing licenses, provenance, security boundaries, and release evidence;
- publishing releases and maintaining their immutable digest ledger; and
- appointing additional maintainers if sustained contribution makes that appropriate.

Contributors retain authorship of their work. Merge, release, and compatibility decisions remain with the Primary Maintainer until a documented governance change delegates them.

## Issues and triage

Use the repository issue templates for reproducible bugs, feature proposals, and first-import feedback. Public issues may be labelled, narrowed, redirected, or closed when they are duplicates, cannot be reproduced, fall outside the roadmap, request unsafe behaviour, or lack redistribution rights.

Changes to schemas, exported files, stable IDs, licenses, or Godot compatibility should begin with an issue or design discussion. Acknowledgement does not promise implementation or inclusion in a particular release.

## Schema and compatibility decisions

Portable PNG and JSON files are the cross-engine source of truth; Godot resources are derived by the trusted importer. Published tags, fixtures, hashes, schema versions, stable semantic IDs, and documented compatibility surfaces are not rewritten in place.

A compatibility-affecting proposal must describe:

1. the current and proposed contracts;
2. affected producers, consumers, fixtures, and Godot versions;
3. migration or explicit rejection behaviour;
4. validation and negative-test coverage; and
5. whether the change requires a new candidate release.

The Primary Maintainer records material decisions in the plan, specification, pull request, or release notes. Capability-track names in the roadmap are planning labels; they do not reserve or predict a release SemVer.

## Pull request and release lifecycle

Pull requests should be focused, reviewable, licensed for redistribution, and accompanied by proportionate tests or documentation. CI passing is required but does not by itself guarantee merge.

Release work follows this lifecycle:

1. register a new, unpublished candidate without changing prior public artifacts;
2. build and verify reproducible browser, pack, importer, and release evidence as applicable;
3. review the change through a public pull request and required CI;
4. create a version-matching GitHub release draft from the reviewed commit;
5. have the Primary Maintainer inspect and deliberately publish the prerelease; and
6. pin the public attachment digests and refuse subsequent rebuilds of that tag.

itch.io is an optional distribution surface and is currently postponed. A locally verified upload kit is not evidence that an itch.io page has been published.

## Security

Do not put vulnerability details, credentials, private paths, children's data, private External Host material, or unlicensed assets in a public issue. Follow [SECURITY.md](SECURITY.md), using GitHub private vulnerability reporting when available. Security reports are prioritized by reproducibility, impact, and exposure, but no fixed response or remediation deadline is promised.

## Response expectations

This is a volunteer-maintained project with **no service-level agreement (SLA)**. The maintainer will review public activity as capacity permits. Silence, a label, or initial acknowledgement must not be interpreted as acceptance, a delivery date, compatibility approval, or support commitment.

## Community and project claims

Public documentation must distinguish implemented and verified behaviour from plans. Stars, forks, attachment counts, maintainer-run audits, and generated upload kits must not be presented as proof of independent users or adoption. External Host is a planned consumer scenario unless and until a public-safe, verifiable integration exists. Community size, usage, partnerships, and program eligibility must never be invented or inferred from unavailable evidence.
