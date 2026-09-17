# musubix4

**Latest release v0.1.0 · GitHub Copilot CLI only · Node.js 20+ · TypeScript · MIT**

[日本語](README-ja.md) · [Changelog](CHANGELOG.md) · [License](LICENSE)

musubix4 extends GitHub Copilot CLI with repository-local specification-driven
development (SDD) Skills and deterministic evidence checks. Copilot remains the
development engine; musubix4 records requirements, design decisions, test
identity, traceability, and release readiness in files that can be reviewed and
validated again.

## Why musubix4

A successful coding conversation is not durable proof that requirements,
design, implementation, and tests still agree. musubix4 adds a fail-closed
workflow around native Copilot planning, editing, testing, and review:

- EARS requirements and measurable acceptance criteria;
- design components, dependencies, constraints, and ADRs;
- requirement-to-design-to-code-to-test traceability;
- verified Red/Green/Refactor evidence with structured test reports;
- TypeScript Code Graph indexing and architecture-cycle checks;
- optional Z3 or Lean consistency checks with explicit model limits;
- current-input fingerprints, protected policy, approvals, and a quality gate.

The repository is a cleanly rebuilt successor informed by musubix3. It does not
promise artifact compatibility or migration from earlier MUSUBIX versions.

## Install

Prerequisites:

- Node.js 20 or later;
- GitHub Copilot CLI;
- Git.

Choose exactly one Skill installation route for a project.

The npm and repository/plugin commands become usable after v0.1.0 is published to the corresponding registry and repository.

### Project-local npm installation

```sh
npm install --save-dev --save-exact musubix4@0.1.0
npx --no-install musubix4 init --dry-run
npx --no-install musubix4 init
copilot
```

This route copies the versioned SDD Skills into `.github/skills/` and creates
starter `.musubix/` artifacts. Commit those files so contributors and CI use
the same workflow.

### Native GitHub Copilot CLI plugin

```sh
copilot plugin install nahisaho/musubix4
```

The plugin route loads the Skills through Copilot CLI and does not copy starter
`.musubix/` files. Do not combine it with project-local `init` in the same
project.

## Workflow

Ask Copilot to use `sdd-change` for each change. The Skill coordinates the
specialized requirements, design, implementation, traceability, quality,
knowledge, formal/Code Graph, and issue-reporting Skills.

When `.musubix/hoh.json` or an `hoh` block in `.musubix/config.json` is present,
a new top-level coding request is routed automatically through one durable
Harness on Harness run. The Skill uses bounded `run --summary-json` and
`resume --summary-json` results, stops on verified readiness or deployment, and
reports failures without falling back to direct implementation. Remove the HoH
configuration to retain the direct SDD workflow. HoH role subprocesses carry
`MUSUBIX4_HOH_RUN_ID`; nested `run`, `resume`, and protected-set amendment
orchestration is rejected with exit code 2.

Only the explicitly allowlisted independent read-only validators may run in
parallel: `requirements validate` with `constitution validate`; multiple
`design validate` invocations for distinct files; and any independent subset of
`trace check`, `config lint`, `mutation validate`,
`model-correspondence validate`, and `approval validate` after producer
artifacts are current. The sequential boundary means all other commands remain sequential, including
producers (`trace build`, `graph index`, `knowledge build`, and
`evidence refresh`), consumers outside that allowlist or with stale inputs,
gates, `workflow-verify`, `workflow-record`, workflow waivers, approval
preparation and recording, TDD and change-record commands, HoH lifecycle
commands, `status`, project build/test commands, and append-only
workflow/change/approval/TDD/HoH journal writes. The required order is:
requirements approval precedes design; design approval precedes Red; Red precedes implementation;
implementation precedes Green; `trace build` precedes trace consumers; and
`graph index` precedes graph consumers.

1. Define measurable requirements and validate them.
2. Obtain explicit requirements approval.
3. Define components, interfaces, constraints, dependencies, and ADRs.
4. Obtain explicit design approval.
5. Record a real failing Red test before implementation.
6. Implement the smallest complete change and record Green.
7. Rebuild trace, graph, formal, workflow, and quality evidence.
8. Independently review the release candidate and record release approval.

Core commands:

```sh
npx --no-install musubix4 requirements validate .musubix/features/<feature>/requirements.md
npx --no-install musubix4 design validate .musubix/features/<feature>/design.md
npx --no-install musubix4 tdd red TEST-FEATURE-001 --requirement REQ-FEATURE-001 --command test
npx --no-install musubix4 tdd green TEST-FEATURE-001 --requirement REQ-FEATURE-001 --command test
npx --no-install musubix4 trace build
npx --no-install musubix4 trace check --strict
npx --no-install musubix4 graph index
npx --no-install musubix4 graph gate
npx --no-install musubix4 gate --changed
npx --no-install musubix4 approval prepare release
```

Requirements and design approvals bind exact artifact manifests. Release
approval is recorded only after the candidate and its evidence have been
reviewed.

## Verification

For this repository:

```sh
npm ci
npm run typecheck
npm run build
npm test
npm run pack:check
```

`pack:check` creates and inspects an actual npm archive. The release verifier
uses the root `package.json` as the version authority and checks workspace and
lockfile metadata, plugin metadata, README release markers, the first dated
CHANGELOG heading, the built CLI, and selected files inside the archive.

Useful project checks:

```sh
npx --no-install musubix4 constitution validate
npx --no-install musubix4 requirements validate .musubix/features/<feature>/requirements.md
npx --no-install musubix4 design validate .musubix/features/<feature>/design.md
npx --no-install musubix4 trace check --strict
npx --no-install musubix4 graph gate
npx --no-install musubix4 gate --changed --json
npx --no-install musubix4 status --json
```

## Distribution

v0.1.0 supports:

- the `musubix4` npm package and `npx musubix4` CLI;
- project-local Skills installed with `musubix4 init`;
- the native GitHub Copilot CLI plugin declared by `plugin.json`;
- the Copilot plugin marketplace catalog under `.github/plugin/`.

Release preparation verifies repository versions, creates the npm tarball and
CycloneDX SBOM, and writes SHA-256 checksums. Publishing remains an explicit,
separately approved operation.

## Evidence reference

`change-record <CHANGE-ID>` is fail-fast when a phase has an unchanged
fingerprint. `--allow-unchanged` is limited to reviewed defect corrections, and
`--dry-run` previews the record without persisting it. The append-only `order`
field is the verified chronology authority; `recordedAt` is an independently
captured wall-clock value with no ordering guarantee.
`CHANGE_RECORDEDAT_OUT_OF_ORDER` reports disagreement without rewriting history.

`tdd red\|green\|refactor` becomes a project-wide evidence obligation after the
first persisted cycle. Every mandatory requirement then needs coverage or the
gate reports `TDD_REQUIREMENT_UNCOVERED`, including before
`approval record release`. `tdd migrate` only re-fingerprints a requirement that
already has a valid Green cycle; it does not create missing Red/Green evidence.

`workflow waiver record-all --approver <name> --reason <text> --confirm` is an all-or-nothing waiver for current declaration-scoped diagnostics including `WORKFLOW_BINDING_MISSING`, and it refuses to hide `WORKFLOW_INVOCATION_UNVERIFIED`.
Use `workflow waiver record <code>` for one reviewed diagnostic.

#### Attestation evidence-head composition

- `tdd` retains the append-only chain-tip digest, not the full mutable report.
- `workflow` retains `eventsSha256` and `invocations`; the raw event log is
  excluded.
- `changes` is derived from `changes.json`, not the `.musubix/changes/*.md`
  documents.
- `order` retains the append-only chain-tip digest.
- `formal` retains the normalized current formal-evidence projection.
- `performance` retains observations and executions including `processStatus`
  and `exitCode`.
- `mutation` retains its nested `mutants` array after sorting
  order-independently.
- `modelCorrespondence` retains test bindings including `reportSha256` and
  `provenanceSha256`, while volatile test output is excluded.
- `quality` excludes volatile fields such as `generatedAt`.
- `workspace` is a repository snapshot, not an evidence file.

## Limitations

- musubix4 does not replace GitHub Copilot.
- musubix4 does not add another agent runtime, MCP/LSP manager, memory service,
  REPL, or watcher.
- musubix4 does not treat SAT as proof of implementation correctness; formal checks prove only the
  explicitly modeled constraints.
- Trace links prove that artifacts are connected, not that behavior is correct.
- A passing gate means the repository's configured required evidence is current;
  it is not a universal correctness or security guarantee.
- Local process and filesystem controls are not an operating-system sandbox.

<!--
@id CODE-SAFE-WORKFLOW-SPEED-DOCS-001
@implements REQ-SAFE-WORKFLOW-SPEED-002
@design DES-SAFE-WORKFLOW-SPEED-003
-->

<!--
@id CODE-RELEASE-V010-DOCS-001
@implements REQ-RELEASE-V010-DOCS-001
@design DES-RELEASE-V010-DOCS-001
-->
