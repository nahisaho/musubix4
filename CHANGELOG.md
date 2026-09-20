# Changelog

## 0.1.3 - 2026-09-20

Performance and release-verification update for musubix4 version 0.1.3.

### Fresh code-graph cache reuse

- Reuse an identity-bound fresh code graph for repeated `graph index`, `graph
  gate`, full `gate`, and change-impact analysis without rebuilding the
  TypeScript Program.
- Preserve conservative forced refresh through `graph index --changed` and
  strict stale-cache errors for `graph impact` and `graph cycles`.
- Invalidate cached graphs when source, manifest, compiler configuration,
  dependency lockfile, musubix4 extractor, or TypeScript producer identity
  changes.
- Record deterministic compiler-operation evidence and a pinned v0.1.2
  comparative benchmark for the release gate.
- Schema-v1 or producer-incompatible graph caches require one `graph index`
  before strict `graph impact` or `graph cycles` use.

## 0.1.2 - 2026-09-20

Release readiness update for musubix4 version 0.1.2.

### Release metadata

- Align the root package, workspace manifests, lockfile, plugin metadata, and
  Copilot marketplace metadata on version `0.1.2`.
- Update the English and Japanese README release markers and install snippets
  to the current release.
- Preserve the approved `0.1.0` baseline heading fixture and its immutable
  trailing-block role in release verification.

## 0.1.0 - 2026-09-16

Initial public release of musubix4.

### Skills

- Repository-local `sdd-change`, requirements, design, implementation,
  traceability, quality, knowledge, formal/Code Graph, and issue-reporting
  Skills extend GitHub Copilot CLI without replacing its native development,
  review, or subagent capabilities.
- Explicit requirements, design, and release approvals bind reviewed artifact
  manifests before development crosses protected boundaries.
- Configured top-level coding requests automatically use one bounded Harness on
  Harness run, with compact JSON status and nested-orchestration rejection.
- Independent read-only validation is batched while stateful evidence commands
  retain deterministic producer-before-consumer ordering.

### Deterministic evidence

- EARS requirements, design validation, ADRs, typed trace links, and
  bidirectional impact analysis.
- Structured TDD Red/Green/Refactor records tied to authoritative TEST IDs.
- TypeScript Code Graph indexing, dependency-cycle gates, optional formal
  consistency checks, input fingerprints, and a fail-closed quality gate.
- Repository, CLI, metadata, README, CHANGELOG, and packed npm archive version
  consistency checks.

### Distribution

- `musubix4` npm package for project-local CLI and Skill installation.
- GitHub Copilot CLI plugin and marketplace metadata for native Skill loading.
- Node.js 20 or later, TypeScript, and the MIT License.

### Limitations

- musubix4 does not replace GitHub Copilot or add another agent runtime.
- Traceability and SAT results do not prove implementation correctness.
- A passing quality gate proves only the evidence required by the configured
  repository policy; it is not a universal correctness or security guarantee.
- Process and filesystem restrictions are not an operating-system sandbox.

<!--
@id CODE-RELEASE-V010-DOCS-003
@implements REQ-RELEASE-V010-DOCS-003
@design DES-RELEASE-V010-DOCS-002
-->
