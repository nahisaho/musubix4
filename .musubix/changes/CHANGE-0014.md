---
schemaVersion: 1
id: CHANGE-0014
summary: Isolate candidates from pre-existing tracked dirt
status: in-progress
---
# CHANGE-0014: candidate-isolation-initial-dirty-tracked-paths

Requirements: REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-014 REQ-AUTONOMOUS-DEVELOPMENT-018

## Intent

Prevent HoH candidate snapshots from silently absorbing tracked user changes
that already existed before initialization.

## Classification

Defect correction with fail-closed candidate isolation for pre-existing tracked
workspace dirt.

## Impact

- Record the initialization `HEAD` and the exact tracked-path dirt observed at
  initialization without mutating the real worktree or index.
- Build candidate snapshots from that recorded `HEAD`, not from any later
  branch movement.
- Allow tracked paths that were clean at initialization to contribute their
  current run-produced content.
- Keep tracked paths that were dirty at initialization pinned to their recorded
  `HEAD` content when unchanged since initialization.
- Throw a typed actionable `CandidateIsolationError` instead of attempting any
  merge, patch extraction, or automatic separation when an initialization-dirty
  tracked path changes content, mode, existence, or staged/unstaged state.
- Preserve `candidateExtraPaths` behavior while ensuring tracked-path isolation
  still wins for initialization-dirty tracked paths.
- Add focused deterministic regression coverage for the separate-file `A`/`B`
  scenario and align existing Git candidate-store coverage with the corrected
  isolation rule.

## Resolution

- Replaced candidate-isolation dirt discovery based on `git status` with
  staged/unstaged diff probes executed against a copied temporary Git index so
  initialization records tracked dirt without refreshing or rewriting the real
  index.
- Preserve raw NUL-delimited diff output while recording tracked dirty paths so
  exact initialization path identities survive filenames with leading or
  trailing whitespace.
- Restrict copied-path dirty recording to the copied destination so
  `--find-copies` detection does not incorrectly isolate the clean tracked
  source path as initialization dirt.
- Bound those staged-diff probes to the recorded initialization `HEAD` commit
  so later branch movement cannot corrupt the isolation baseline or spuriously
  flip an initialization-dirty path's staged/unstaged classification.
- Snapshot the current state of every initialization-dirty tracked path in the
  same isolated read that captures candidate dirt, even when one of those paths
  is now clean, so fail-closed comparisons cannot mix stale status data with a
  later live reread.
- Build candidate trees from the recorded initialization `HEAD`, then restage
  the current worktree state of tracked paths that were clean at initialization
  so run-produced bytes win while initialization-dirty tracked paths are still
  restored to recorded `HEAD` bytes.
- Fingerprinted the real Git index plus tracked dirty-path state before and
  after initialization and snapshotting, and fail fast if either operation
  changes the user worktree or index.
- Bound the recorded initialization status digest to both the captured `HEAD`
  commit and the initialization-dirty tracked-path identities so later
  candidate stages retain the exact isolation baseline they were created from.
- Persisted that baseline under the run directory and reload it when a later
  CLI `resume` constructs a new `GitCandidateStore` instance.
- Strengthened the focused `A`/`B` regression to assert byte-identical real
  index preservation across initialization, successful snapshotting, and the
  fail-closed conflict path, while also asserting the persisted initialization
  baseline records the dirty path's exact staged identity and worktree content
  fingerprint.
- Delete any stage ref created during a later-detected workspace mutation so
  fail-closed candidate isolation does not retain a provisional mixed-state
  snapshot after raising `CandidateIsolationError`.
- Persist a canonical SHA-256 baseline containing the initialization commit and
  exact tracked dirty-path states, validate it on cross-process resume, and pin
  the base commit under a run-local Git ref.
- Route missing, unreadable, malformed, digest-mismatched, and unresolvable
  baselines to typed fail-closed recovery instead of recreating run ownership
  state after role execution has started.
- Add the `candidate-isolation-required` operator stop and resume path without
  consuming iteration, stagnation, or blocker-repair budgets.
- Re-read the authoritative run record after acquiring the lease so terminal
  outcomes cannot be overwritten by baseline validation during a concurrent
  resume.
- Use private Git indexes for candidate construction, preserve explicitly
  selected ignored untracked files, and clean provisional refs on every
  snapshot failure path.
- Preserve the source index atime and mtime when creating each private index.
  Without that metadata, Git can move a same-size worktree edit across its
  racy-clean boundary between the before/after observations and report a false
  workspace mutation.

## Verification

- Focused deterministic candidate-isolation and recovery coverage lives in
  `tests/autonomous-candidate-isolation-recorded-head.test.ts` and
  `tests/autonomous-candidate-baseline-recovery.test.ts`.
- `TEST-AUTONOMOUS-AMENDMENT-GIT-001` now fixes the tracked file and real index
  to the same historical index-entry mtime with `core.checkStat=minimal`,
  reproducing the private-index racy-clean miss deterministically.
- REQ-AUTONOMOUS-DEVELOPMENT-014 has an in-phase bounded Red/Green cycle for
  post-lease terminal preservation. Candidate-isolation and amendment Git
  Red/Green cycles exist for REQ-AUTONOMOUS-DEVELOPMENT-007 and
  REQ-AUTONOMOUS-DEVELOPMENT-018, but their append-only CHANGE phase-boundary
  selection is accepted through explicit `CHANGE_RED_UNPROVEN`,
  `CHANGE_GREEN_UNPROVEN`, and `CHANGE_COMPLETENESS_TDD` waivers. Separate
  `CHANGE_ORDER_MIGRATION_REQUIRED` waivers cover TEST-ID evidence selection
  for REQ-AUTONOMOUS-DEVELOPMENT-007 and
  REQ-AUTONOMOUS-DEVELOPMENT-018. The final implementation refinements are
  verified by the current full-suite result.
- `npm run typecheck`, `npm run build`, `npm test`, and
  the configured HoH test command pass against the current tree.
- The observed full-suite run passed 98 test files with 1 skipped and 564 tests
  with 8 skipped. These aggregate counts come from the command output retained
  outside the repository; the repository evidence retains the structured
  authoritative TEST-ID result instead.
- The generated trace contains 469 nodes and 996 edges with 0 diagnostics.
- Formal consistency evidence models 2 of 27 requirements with no solver
  requested, and model correspondence covers one requirement outside this
  change. REQ-AUTONOMOUS-DEVELOPMENT-007,
  REQ-AUTONOMOUS-DEVELOPMENT-014, and
  REQ-AUTONOMOUS-DEVELOPMENT-018 are verified by executable tests and trace
  evidence, not claimed as formally proven behavior.
- A fresh, no-write Copilot CLI probe supplies one valid strict terminal Skill
  transcript and validates transcript ingestion. None of the 49 self-reported
  declarations are directly matched to that probe: 43 completed declarations
  are accepted through explicit human waivers, including 27 declarations from
  prior sessions whose usable transcripts were not retained, while 6 failed
  declarations require no invocation match.

## Residual Risks

- Release approval is stale and remains the only expected required gate failure
  until the current release manifest is explicitly approved.
- The local evidence is unsigned, mutation evidence is unavailable, and no
  deterministic performance budgets are declared; these checks are optional in
  the current policy.
- CHANGE-0014 has eight effective narrowly scoped waivers: six for append-only
  TDD phase boundaries across REQ-AUTONOMOUS-DEVELOPMENT-007 and
  REQ-AUTONOMOUS-DEVELOPMENT-018, plus two ordering waivers for those
  requirements. The append-only waiver ledger contains 15 CHANGE-0014 records
  because the REQ-AUTONOMOUS-DEVELOPMENT-018 waivers were re-granted after TDD
  evidence-head changes; superseded records do not increase the effective
  waiver count. Related historical CHANGE-0001 ordering diagnostics are
  separately waived.
- Workflow provenance relies on 43 declaration-scoped human waivers rather than
  retained matching Copilot invocation events. The waiver reasons and fresh
  transcript probe do not establish behavioral correctness; executable checks
  provide that evidence.
