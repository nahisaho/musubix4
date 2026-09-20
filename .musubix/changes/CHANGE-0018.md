---
schemaVersion: 1
id: CHANGE-0018
summary: Accelerate repeated code-graph analysis and release v0.1.3
status: completed
---
# CHANGE-0018: v0.1.3 graph performance

Requirements: REQ-SAFE-WORKFLOW-SPEED-003 REQ-RELEASE-V010-DOCS-001 REQ-RELEASE-V010-DOCS-002 REQ-RELEASE-V010-DOCS-003 REQ-RELEASE-V010-DOCS-004 REQ-RELEASE-V010-DOCS-005

## Intent

Reassess the v0.1.2 algorithms, reduce the largest measured internal CLI
bottleneck by at least 20 percent without allowing another representative
command to regress by more than 5 percent, preserve observable graph and release
behavior, and publish the result as musubix4 v0.1.3.

## Classification

Performance-oriented behavior change plus patch release.

## Baseline

On the isolated v0.1.2 release worktree, five repeated process-level samples
after initial runtime warm-up found `graph index` at a 3376.59 ms median and
`graph gate` at a 3138.68 ms median. v0.1.2 performed a complete graph rebuild
on every sample, making that repeated construction the largest measured
internal CLI bottleneck. Other medians were 336.82 ms for requirements
validation, 425.23 ms for design validation, 1055.27 ms for trace build,
519.64 ms for strict trace check, 1136.49 ms for status, and 602.37 ms for
knowledge build. A separately added five-sample baseline for `graph impact`
measured 495.60 ms. These absolute values are discovery evidence only; release
acceptance uses a back-to-back relative comparison on one host and runtime.

## Planned impact

- Add a deterministic performance contract for reusing a fresh persisted code
  graph whose input fingerprints, installed musubix4 identity, extractor
  identity, and TypeScript producer identity are current, without constructing
  a TypeScript Program or rewriting unchanged cache bytes.
- Keep stale, missing, malformed, and explicitly isolated cache-bypass requests
  on the complete indexing path. Cache-read-only change-impact requests may
  reuse but never write a fresh cache, while graph impact/cycles retain their
  current actionable stale-cache rejection.
- Keep `graph index --changed` as a conservative forced rebuild that ignores
  readable cache state and atomically replaces the persisted graph for later
  read-only consumers.
- Preserve graph files, imports, entrypoints, symbols, calls, diagnostics,
  fingerprint semantics, architecture decisions, and stale-cache rejection;
  extend the fingerprint input set with dependency lockfiles.
- Define `generatedAt` as graph-construction time and preserve it on reuse as
  the sole intentional observable timestamp change from v0.1.2.
- Add operation-counter evidence for the warm-cache path and controlled
  process-level benchmark evidence for the 20 percent improvement against the
  fixed v0.1.2 baseline and the 5 percent non-regression bound against the
  immediately preceding stable release; exclude full `gate` elapsed time
  because configured build and test processes dominate it.
- Govern the benchmark target with
  `.musubix/benchmarks/graph-cache-target.json`, bind benchmark freshness to
  exact target, lockfile, reference-build, and candidate publish-file digests,
  and require actionable regeneration diagnostics.
- Extend the existing full-test report adapter to merge one test-owned sidecar
  and emit exactly one `TEST-SAFE-WORKFLOW-SPEED-004` operation count without
  changing the trusted command allowlist.
- Add a `DES-SAFE-WORKFLOW-SPEED-*` component and ADR for cache identity,
  cache-policy modes, atomic persistence, telemetry, and benchmark boundaries.
- Advance governed package, plugin, documentation, changelog, lockfile, and
  packed-archive release surfaces from v0.1.2 to v0.1.3.

## Dependencies

- CHANGE-0019 must complete its REQ-AUTONOMOUS-DEVELOPMENT-019 chronology
  clarification before CHANGE-0018 records final quality and release approval.

## Verification

- Fresh requirement-linked Red and Green test cycles for every changed normative
  requirement. The append-only change-phase ordering relationship is separately
  bounded by `CHANGE_ORDER_MIGRATION_REQUIRED`, `CHANGE_RED_UNPROVEN`,
  `CHANGE_GREEN_UNPROVEN`, and `CHANGE_COMPLETENESS_TDD` waivers; those waivers
  do not waive the test outcomes or behavioral assertions.
- Focused graph-cache behavior and deterministic operation-counter tests.
- Controlled fixed-v0.1.2 improvement and preceding-stable non-regression
  comparisons against the approved
  `.musubix/benchmarks/graph-cache-target.json` snapshot.
- The existing full-test report runner's nonce-bound operation sidecar and
  `gate`-generated provenance for `TEST-SAFE-WORKFLOW-SPEED-004`.
- A fresh passing `.musubix/evidence/graph-performance.json` produced by
  `scripts/benchmark-graph-cache.mjs`.
- `npm run typecheck`, `npm run build`, `npm test`, and `npm run pack:check`.
- `npx musubix4 trace build`, `trace check --strict`, `graph index`, and
  `graph gate`.
