---
schemaVersion: 1
id: CHANGE-0005
summary: Repair v0.1.0 release identity and baseline validation blockers
status: in-progress
---
# CHANGE-0005: release-v010-blocker-repair

Requirements: REQ-AUTONOMOUS-DEVELOPMENT-002 REQ-RELEASE-V010-DOCS-005

## Intent

Remove the final deterministic release-review blockers without changing the
approved product behavior: restore the frozen inherited baseline artifacts,
exclude their historical requirements from current-development TDD coverage,
and reject every non-`musubix4` `musubix*` package token invoked through `npx`.

## Classification

Defect correction. The approved requirements and designs already define both
behaviors, so no normative requirement change is required. For
REQ-RELEASE-V010-DOCS-005, the `npx` package argument is evaluated as its
normalized package name after removing an optional version suffix; this makes
version-qualified invocations enforce the same product identity without
relaxing the approved rule. REQ-AUTONOMOUS-DEVELOPMENT-001 and
REQ-AUTONOMOUS-DEVELOPMENT-013 govern the restored protected artifacts but do
not receive implementation behavior changes in this repair. REQ-AUTONOMOUS-
DEVELOPMENT-015 governs the corrected QA command vectors, which are
configuration data rather than an adapter implementation behavior change.

## Evidence note

The normative requirements are unchanged, so the requirements checkpoint uses
the supported defect-correction `--allow-unchanged` path. DES-AUTONOMOUS-
DEVELOPMENT-014 is amended only to make its existing historical-coverage
boundary explicit for TDD validation.

## Impact

- Restore all 82 `baseline-specs/**` paths byte-for-byte to the SHA-256 digests
  recorded by the prior reviewed release manifest, using preserved source and
  rewind snapshots rather than regenerating or semantically replacing them.
- Restore the two externally located artifacts enumerated by
  `baseline-specs/baseline.manifest.json`, including the pinned
  `tests/hoh-lifecycle.test.ts`, and verify every manifest artifact and its
  attestation with the local baseline verifier.
- Treat `baseline-specs/features/**` as frozen historical requirements whose
  coverage is provided by the pinned historical mapping and compatibility
  suites, not by current-development Red/Green cycles.
- Parse the executable package argument after supported `npx` options, remove
  an optional version suffix, and reject names beginning with `musubix` unless
  the normalized package name is exactly `musubix4`.
- Replace stale `musubix3` executable references in `.musubix/hoh.json` QA
  checks so release validation invokes the repository's `musubix4` binary.
- Add focused regression tests for the newly enforced version-qualified
  `musubix3`, `musubix2` after `-y`, valid `musubix4` after `--no-install`, and
  historical TDD scope.
- Rebuild trace and protected-set evidence so restored immutable inputs and
  current implementation/test artifacts are pinned without modifying the
  frozen baseline.
