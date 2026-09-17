---
schemaVersion: 1
feature: safe-workflow-speed
---
# Safe workflow speed design / 安全なワークフロー高速化設計

## DES-SAFE-WORKFLOW-SPEED-001: Concise validation output
Responsibilities: Define a shared Skill-level allowlist for concise human-readable validation and a required-JSON set for structured decisions.
Interfaces: `.github/skills/sdd-change/SKILL.md`; `.github/skills/sdd-requirements/SKILL.md`; `.github/skills/sdd-design/SKILL.md`; `.github/skills/sdd-implementation/SKILL.md`; `.github/skills/sdd-traceability/SKILL.md`; `.github/skills/sdd-quality/SKILL.md`; `tests/cli-package.test.ts`.
Constraints: Human-readable output is used only for the commands enumerated by REQ-SAFE-WORKFLOW-SPEED-001 and only when no result field must be parsed; this includes concise `approval validate`. `gate` is human-readable when only its exit/status summary is consumed and uses JSON when individual checks feed evidence, readiness, or waiver decisions. HoH lifecycle commands use bounded summary JSON; approval preparation, workflow verification, readiness and waiver decisions retain structured output on their first invocation. Mutating and append-only commands are never rerun only for diagnostics; written evidence or the original result is inspected. Summary-less commands are narrowly scoped and excluded from the default completion path unless required.
Requirements: REQ-SAFE-WORKFLOW-SPEED-001
ADRs: ADR-0011

## DES-SAFE-WORKFLOW-SPEED-002: Dependency-aware validation batching
Responsibilities: Instruct Copilot to submit only the requirement-enumerated independent read-only validators in one parallel tool-call batch while preserving all stateful and producer-consumer order.
Interfaces: The six shipped SDD Skills named by DES-SAFE-WORKFLOW-SPEED-001; Copilot native parallel tool calls; `tests/cli-package.test.ts`.
Constraints: Requirements approval precedes design, design approval precedes Red, Red precedes implementation, and implementation precedes Green. `trace build` precedes `trace check` and `trace impact`; graph indexing precedes graph consumers. The parallel allowlist is limited to requirements plus constitution validation, distinct design-file validations, and current-artifact trace/config/mutation/model-correspondence/approval validation. Producers, HoH commands, project build/test commands, gates, status, approval preparation and recording, TDD, change/workflow recording, waivers, and other shared or append-only writes remain sequential.
Requirements: REQ-SAFE-WORKFLOW-SPEED-001
ADRs: ADR-0011
Depends-On: DES-SAFE-WORKFLOW-SPEED-001

## DES-SAFE-WORKFLOW-SPEED-003: Bilingual batching disclosure
Responsibilities: Publish the complete safe parallel allowlist, sequential command boundary, and required lifecycle order in both release entry points, with deterministic regression coverage.
Interfaces: `README.md`; `README-ja.md`; `tests/release-documents.test.ts`; `TEST-SAFE-WORKFLOW-SPEED-003`, retargeted to `REQ-SAFE-WORKFLOW-SPEED-002` and strengthened.
Constraints: Replace the existing batching paragraph under `## Workflow` and `## ワークフロー`; each section contains exactly one contiguous batching-boundary passage, identified respectively by the exact anchors `Only the explicitly allowlisted independent read-only validators` and `明示的に許可された独立した読み取り専用validatorだけ`, before the next `##` heading. CLI command identifiers remain backticked English literals in both documents, while surrounding prose and test assertions use each document's own language. The passage names every parallel-eligible validator and states that all other commands remain sequential, explicitly including artifact producers (`trace build`, `graph index`, `knowledge build`, `evidence refresh`), consumers outside the allowlist or with stale inputs, gates, `workflow-verify`, `workflow-record`, workflow waivers, approval preparation and recording, TDD commands, change-record commands, HoH lifecycle commands, `status`, project build/test commands, and append-only workflow/change/approval/TDD/HoH journal writes. It states all six required orderings: requirements approval before design, design approval before Red, Red before implementation, implementation before Green, `trace build` before trace consumers, and `graph index` before graph consumers. `TEST-SAFE-WORKFLOW-SPEED-003` checks one anchor occurrence at section scope, extracts the paragraph from that anchor to the following blank line, normalizes whitespace, and asserts every required command/category, all six ordering pairs, and English or Japanese boundary prose within that passage rather than elsewhere in the section or file.
Requirements: REQ-SAFE-WORKFLOW-SPEED-002
ADRs: ADR-0011
Depends-On: DES-SAFE-WORKFLOW-SPEED-002
