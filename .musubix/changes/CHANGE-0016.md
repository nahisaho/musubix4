---
schemaVersion: 1
id: CHANGE-0016
summary: Refresh quality evidence after later Green batches
status: in-progress
---
# CHANGE-0016: refresh-quality-after-later-green

Requirements: REQ-AUTONOMOUS-DEVELOPMENT-020

## Intent

Allow a staged change that discovers and fixes an additional defect after its
first quality checkpoint to record a new current quality checkpoint without
editing or deleting prior append-only evidence.

## Classification

Defect correction to the staged-change evidence lifecycle.

## Impact

- Permit `change-record <id> quality` to refresh an existing quality checkpoint
  only when a later effective Green checkpoint exists.
- Retain every superseded quality checkpoint in explicit history and bind each
  revision to a uniquely scoped monotonic order event.
- Continue rejecting duplicate quality recording when no later Green exists.
- Keep full requirement coverage, fingerprints, dry-run behavior, and
  validation fail-closed.

## Requirements

- REQ-AUTONOMOUS-DEVELOPMENT-020 defines guarded quality refresh and immutable
  superseded quality history.

## Design

- DES-AUTONOMOUS-DEVELOPMENT-017 adds a quality-revision path to the staged
  change evidence recorder and validator.

## Verification

- `TEST-CHANGE-QUALITY-REFRESH-001` verifies a successful refresh after later
  Green, then a second refresh after another Green. It asserts
  history details `[none, quality-revision:1]`, current detail
  `quality-revision:2`, strictly increasing integer orders, and absence of quality
  history/order diagnostics.
- `TEST-CHANGE-QUALITY-REFRESH-002` verifies byte-identical rejection when no
  later Green exists using `CHANGE_QUALITY_REFRESH_NOT_NEEDED`, and verifies
  that dry-run projects the revision without consuming an order sequence.
- `TEST-CHANGE-QUALITY-REFRESH-003` verifies
  `CHANGE_QUALITY_HISTORY_SCHEMA`, `CHANGE_QUALITY_HISTORY_ORDER`, and
  `CHANGE_QUALITY_HISTORY_ORPHAN` for tampered historical checkpoints, plus
  byte-identical recorder rejection.
- `TEST-CHANGE-QUALITY-REFRESH-004` verifies non-blocking stale order orphans,
  a later successful append with the same revision detail and a higher
  sequence without `EVIDENCE_ORDER_DUPLICATE`, compatibility with a
  legacy-shaped first-quality checkpoint that has no `qualityHistory` or
  `orderDetail`, and preservation of an unknown audit-extension field.
- A recorded fail-first Red/Green cycle exists for
  `TEST-CHANGE-QUALITY-REFRESH-003`; TEST-001, TEST-002, and TEST-004 run as
  focused regression coverage.

Executed validation:

- `npx musubix4 tdd validate`: passed.
- Focused change-evidence regression suite: 4 files and 25 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm test`: passed with 106 test files passed, 1 skipped; 587 tests passed,
  8 skipped, 0 failed (595 total).
- `npm run pack:check`: passed; `musubix4-0.1.0.tgz` contains 134 files and 9
  skills.
- `npx musubix4 trace build` and `npx musubix4 trace check --strict`: passed
  with 499 nodes, 1065 edges, and 0 diagnostics.
- `npx musubix4 graph index` and `npx musubix4 graph gate`: passed with 156
  files, 710 imports, and 6665 symbols.
- Formal consistency checking passed; `REQ-AUTONOMOUS-DEVELOPMENT-020`
  remains explicitly unsupported by the Boolean abstraction and is not
  claimed as behavioral proof.
- CHANGE-0016 quality was recorded at order 704.
- The built CLI refreshed CHANGE-0015 quality at order 705 with
  `orderDetail = quality-revision:1`, preserving its original order-642
  checkpoint in `qualityHistory`.

## Residual Risks and Release Blockers

- CHANGE-0015's quality-order blocker is resolved. Its 21 legacy
  chronology/completeness diagnostics are retained as snapshot-bound warnings
  by audited waivers at orders 706-726 rather than being rewritten.
- ADR-0014 records the quality-history and sequence-scoped-order trade-offs,
  resolving the prior `CHANGE_COMPLETENESS_ADR` blocker.
- Previously stale CHANGE-0001/CHANGE-0014 change waivers were refreshed,
  including the additional order-migration scopes at orders 737-739.
- Workflow reconciliation passes in compatible mode after live-transcript
  verification and audited declaration-scoped waivers. Strict mode still
  requires the active session's terminal result.
- Current release approval and review of the trusted policy-baseline changes
  remain required.
- The required `hoh-test` command timeout is raised from 120 to 300 seconds so
  the expanded deterministic suite has execution headroom.
- `workflow.maxTranscriptBytes` is set to 125829120 so the current live
  transcript can be verified without truncation; the event-count, line-size,
  reconciliation, session, and terminal-event checks remain unchanged.
