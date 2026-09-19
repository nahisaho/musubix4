---
schemaVersion: 1
id: CHANGE-0017
summary: Remove release-version coupling from the frozen compatibility oracle
status: in-progress
---
# CHANGE-0017: baseline-version-decoupling

Requirements: REQ-AUTONOMOUS-DEVELOPMENT-001

## Intent

Allow future musubix4 releases to change the product version without weakening
or bypassing the frozen MUSUBIX3 compatibility oracle.

## Classification

Defect correction. The existing requirement already limits
manifest-enumerated compatibility tests to inherited-compatibility assertions.
The exact musubix4 release version is current-product metadata and is already
verified by the non-frozen release-version consistency test.

## Impact

- Clarify REQ-AUTONOMOUS-DEVELOPMENT-001 so frozen compatibility tests cannot
  pin the independently governed musubix4 product version.
- Add DES-AUTONOMOUS-DEVELOPMENT-018 and ADR-0015 for the responsibility split
  and deterministic procedure-v3 regeneration.
- Remove only the exact `0.1.0` product-version assertion from
  `tests/inherited-compatibility.test.ts`.
- Preserve all command and option compatibility assertions in that test.
- Bump the deterministic baseline regeneration procedure version and regenerate
  the test digest plus digest-pinned attestation and manifest entry outside an
  autonomous run.
- Add a non-frozen regression assertion that manifest-enumerated compatibility
  tests do not pin the evolving musubix4 package version.
- Move source-layout `createProgram()` version-value coverage to the non-frozen
  release-version consistency test.
- Update the non-frozen procedure-version expectation and refresh trace/quality
  fingerprints in the same out-of-run operation.
- Preserve the upstream repository, upstream commit, command-surface snapshot,
  behavioral golden, and historical trace bytes.
- Keep the HoH full-command timeout at 300000 ms because the measured full suite
  exceeds the previous 120000 ms ceiling.

## Verification

- A Red test demonstrates that the frozen compatibility test currently pins
  `createProgram().version()` to `0.1.0`.
- Green proves the regenerated oracle is valid and the compatibility test still
  reports zero missing inherited commands and options.
- `npm run typecheck`, `npm run build`, `npm test`, and `npm run pack:check`.
- `npx musubix4 trace build`, `trace check --strict`, `graph index`, and
  `graph gate`.

## Downstream

After CHANGE-0017 is approved, validated, committed, and pushed, start a fresh
HoH run for the separate musubix4 v0.1.2 release change. That run must not edit
any manifest-enumerated baseline artifact.
