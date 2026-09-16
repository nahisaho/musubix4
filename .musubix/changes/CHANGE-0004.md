---
schemaVersion: 1
id: CHANGE-0004
summary: Rebuild the public documentation and release metadata for v0.1.0
status: in-progress
---
# CHANGE-0004: release-v010-docs

Requirements: REQ-AUTONOMOUS-DEVELOPMENT-019 REQ-RELEASE-V010-DOCS-001 REQ-RELEASE-V010-DOCS-002 REQ-RELEASE-V010-DOCS-003 REQ-RELEASE-V010-DOCS-004

## Intent

Prepare the first public v0.1.0 release with concise, newly authored English
and Japanese entry-point documentation, a clean initial changelog, and one
consistent version across every shipped metadata and archive surface.

## Classification

Defect correction plus documentation and release-metadata behavior change. The
repository currently identifies a prerelease-development value, 0.1.18, while
the intended first public release is 0.1.0. The public documents are replaced
rather than incrementally edited, while implementation changes are limited to
the deterministic release-version verifier and its tests where the approved
changelog baseline-reset policy requires them.

## Evidence note

The requirement edits were already present when the impact checkpoint was
recorded. Because this change corrects the release identity from 0.1.18 to the
intended initial 0.1.0, the requirements checkpoint uses the supported
defect-correction `--allow-unchanged` path rather than altering append-only
evidence or claiming a false fingerprint transition.

## Impact

- Replace `CHANGELOG.md`, `README.md`, and `README-ja.md` with v0.1.0 content.
- Change root, workspace, lockfile, plugin, and marketplace versions to 0.1.0.
- Revise REQ-AUTONOMOUS-DEVELOPMENT-019 so an explicitly approved initial
  changelog reset is verified without retaining the pre-reset release history.
- Revise ADR-0010 to describe the approved v0.1.0 baseline fixture rather than
  the pre-reset 0.1.18 history.
- Revise DES-AUTONOMOUS-DEVELOPMENT-016 so the analysis-layer package-version
  resolver is shared by workflow recording, CLI identity, and asset discovery,
  and so archive verification also scans stale command identity.
- Preserve the root package version as the sole version authority and retain
  repository, CLI, and packed-archive consistency checks.
- Add focused Red/Green evidence for the v0.1.0 documentation and baseline.
- Replace every shipped Skill command reference to the fork source name
  `musubix3` with the actual `musubix4` package and verify no stale command
  remains.
- Source workflow declaration versions from the root package authority rather
  than the inherited hard-coded 0.1.8 value.
- Re-run and explicitly record release approval only after every governed
  document, metadata, fixture, and packed-distribution check is current.
