---
schemaVersion: 1
feature: automatic-hoh-coding
---
# Automatic Harness on Harness coding design / Harness on Harness コーディング自動起動設計

## DES-AUTOMATIC-HOH-CODING-001: Top-level Skill router
Responsibilities: Classify a new top-level request before implementation editing, route executable-behavior changes into exactly one durable HoH run, consume each JSON run transition, and report success or a typed blocker without direct implementation fallback.
Interfaces: `.github/skills/sdd-change/SKILL.md`; `packages/analysis/src/hoh.ts#HohRunSummary`; `packages/analysis/src/hoh.ts#summarizeHohRun`; `packages/cli/src/main.ts#summary-json-option`; `packages/cli/src/main.ts#run`; `packages/cli/src/main.ts#resume`; `packages/cli/src/main.ts#status-run`; `npx musubix4 run --prompt <request> --summary-json`; `npx musubix4 resume <run-id> --summary-json`; `tests/cli-package.test.ts`.
Constraints: `summarizeHohRun` derives a bounded object directly from `RunRecord` with keys `id`, `state`, `iteration`, `journalLength`, `evidence`, `evidenceClaimStatuses`, `deploymentCommands`, `terminalReason`, and `requiredOperatorAction`; it never includes the cumulative journal, command records, configuration body, or candidate body. `deploymentCommands` contains booleans for `deploy`, `verify`, and `rollback`. Routing applies only while trimmed `MUSUBIX4_HOH_RUN_ID` is empty, HoH configuration exists, and the request has development intent plus a source, test, build-script, or runtime-configuration effect. An unconfigured repository retains the direct SDD workflow. The Skill starts once, evaluates every returned summary before another resume, resumes at most 128 transitions, detects unchanged state/iteration/journal length, accepts `deployed`, and accepts evidence-complete non-deployment `ready` without issuing another resume. Every other stopped/action-required condition is a blocker. Requirements/design/TDD/implementation work for a routed request is owned by HoH and is not duplicated by the top-level Skill.
Requirements: REQ-AUTOMATIC-HOH-CODING-001
ADRs: ADR-0011
Depends-On: DES-AUTOMATIC-HOH-CODING-002

## DES-AUTOMATIC-HOH-CODING-002: Nested-run guard
Responsibilities: Mark Copilot role subprocesses with the active HoH run ID and reject nested commands that can construct local HoH services or invoke roles before mutation.
Interfaces: `packages/cli/src/main.ts#localHohServices`; `packages/cli/src/main.ts#run`; `packages/cli/src/main.ts#resume`; `packages/cli/src/main.ts#protected-set-amend`; `packages/cli/src/main.ts#main-error-boundary`; `packages/analysis/src/hoh.ts#invokeCopilotRole`; environment variable `MUSUBIX4_HOH_RUN_ID`; `tests/autonomous-hoh-config-file.test.ts`.
Constraints: The marker is a single-key override over the already inherited subprocess environment; existing allowed-secret lookup and redaction inputs are unchanged. The guard is evaluated before `FileRunStore` or `localHohServices` construction. A trimmed non-empty marker makes `run`, `resume`, and `protected-set amend` throw the exact nested-orchestration diagnostic through the existing CLI error boundary. `run`, `resume`, and `status --run` register `--summary-json`; `protected-set amend` retains `--json` only. The error boundary treats `--json`, and `--summary-json` where registered, as structured-output options and emits the same JSON error envelope; human-readable mode emits the same message. Every mode exits 2, and no run mutation or role invocation occurs.
Requirements: REQ-AUTOMATIC-HOH-CODING-001
ADRs: ADR-0011
