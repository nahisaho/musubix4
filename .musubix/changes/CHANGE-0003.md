---
schemaVersion: 1
id: CHANGE-0003
summary: Keep release version metadata consistent across distributable surfaces
status: in-progress
---
# CHANGE-0003: release-version-consistency

Requirements: REQ-AUTONOMOUS-DEVELOPMENT-019

## Intent

Eliminate contradictory release-version claims by synchronizing the CLI,
package, plugin, marketplace, documentation, and packed-distribution surfaces
with the root package version.

## Classification

Defect correction. The current package and plugin metadata report `0.1.0`,
while README and CHANGELOG claim `0.1.18`.

## Impact

- Add an explicit requirement for consistent release-version metadata.
- Define one authoritative version source in design before implementation.
- Add deterministic tests covering the CLI, root and workspace package
  manifests, exact lockfile fields, plugin metadata, marketplace metadata,
  README.md, README-ja.md, CHANGELOG history, and the packed distribution.
- Replace existing literal `0.1.0` assertions with comparisons to the
  authoritative package version.
- Keep the dedicated CHANGE-0003 acceptance assertion pinned to `0.1.18` as a
  one-change landing-version tripwire; future releases replace this change's
  test rather than treating it as a reusable version source.
- Capture the full pre-change CHANGELOG release-heading sequence before any
  version-bearing source or metadata is edited.
- Update version-bearing artifacts only after requirements and design approval.
- Require each future release to update its CHANGELOG heading and all
  version-bearing metadata in the same release change.

## Design

- `DES-AUTONOMOUS-DEVELOPMENT-016` makes the root `package.json` version the
  only release-version authority.
- `ADR-0010` records the bounded named-root lookup and streamed archive parser
  decision.
- The CLI reads that value instead of embedding a version literal.
- One release verifier checks repository metadata, workspace/lockfile set
  equality, approved CHANGELOG history, and the actual generated npm archive.
- Existing `release-prepare.mjs` and `check-package.mjs` call the shared
  verifier; the `tar` package is added as a dev-only streaming parser with no
  runtime dependency.
- This remediation lands as version `0.1.18`, matching the existing latest
  stable CHANGELOG entry; it does not add or rewrite a release-history heading.
