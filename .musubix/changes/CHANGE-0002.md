---
schemaVersion: 1
id: CHANGE-0002
summary: Replace manual SDD approvals with verified-only automatic approvals
status: in-progress
---
# CHANGE-0002: verified-auto-approval

Requirements: REQ-AUTONOMOUS-DEVELOPMENT-016

## Intent

Allow MUSUBIX4 to complete requirements, design, amendment, and release approval
boundaries without interactive human confirmation when every stage-specific
validation, independent review, and mandatory quality gate succeeds.

## Confirmed decisions

- Automatic approval applies to all SDD approval stages.
- Approval is never unconditional.
- Requirements and design approval require valid artifacts and an independent
  review with no unresolved findings.
- Release approval requires readiness, complete verified claims, and all
  mandatory release gates to pass.
- The independent Reviewer is a separate metered, read-only invocation with no
  producer conversation state and exact manifest-path coverage.
- Stage manifests include fixed mandatory artifacts and every changed path.
- Review approval requires zero admissible findings.
- QA-dimension waivers must be frozen before run start and cannot change in-run.
- Empty, skipped, or non-executable gate sets never count as success.
- Automatic decisions remain bound to the current run, exact artifact manifest
  digest, paused-state nonce, policy identity, and an auditable evidence set.
- Any missing, failed, stale, malformed, replayed, or insufficient evidence
  retries within a fixed bound and then records typed `approval-blocked`.

## Impact

- Revise REQ-AUTONOMOUS-DEVELOPMENT-016 from explicit human-only decisions to
  verified-only automatic decisions.
- Align the existing QA waiver, role retry, lifecycle status, active-time, and
  least-privilege clauses with the revised approval authority without adding a
  separate user-visible obligation.
- Revise the approval bridge, orchestrator, and related ADRs after requirements
  approval.
- Add fresh Red/Green coverage for requirements, design, amendment, and release
  automatic approval boundaries.
- Preserve inherited MUSUBIX3 approval commands and evidence compatibility;
  automatic run-bound approval remains MUSUBIX4-only.

## Quality and release evidence

- The latest current-tree changed-mode run in `.musubix/evidence/quality.json`
  passed every required non-approval check. The full suite exited successfully;
  `full-test-results.json` records 219 distinct TEST-ID-bearing assertions as
  passed, including all 218 trace-registered identities. The additional
  `TEST-TDD-FINGERPRINT-MIGRATION-002` title is executed but lacks an
  authoritative `@id` annotation. Until approval is recorded, the gate fails
  only for current release approval.
- This fresh run supersedes the original CHANGE-0002 quality snapshot for
  `packages/analysis/src/change.ts`, `packages/analysis/src/config.ts`, and
  `packages/cli/src/main.ts`, which changed during later compatible hardening.
- Workflow reconciliation used `musubix3@0.1.19` compatible verification for
  the live, non-terminal Copilot transcript through
  `2026-09-15T13:01:00.983Z`. Six declarations from preceding sessions have
  reviewed declaration-scoped waivers that downgrade both
  `WORKFLOW_SKILL_NOT_INVOKED` and `WORKFLOW_BINDING_MISSING`; without those
  waivers the workflow check fails. The current `sdd-change` and `sdd-quality`
  invocations are present in that verified window, while the release-candidate
  changed-mode gate is generated later.
- Two immediately preceding `sdd-change:complete` declarations remain recorded
  as failed at `2026-09-15T12:53:53.620Z` and
  `2026-09-15T12:53:54.127Z`: the first lacked a terminal transcript and the
  second correctly blocked an approval-free release. This continuation will
  append exactly one completed `sdd-change` outcome only after explicit release
  approval and final readiness verification.

## Residual risk and waivers

- CHANGE-0002 predates the current monotonic staged-change evidence rules.
  Its recorded waivers cover historical ordering, an updated test fingerprint,
  and Red/Green/completeness records that were appended after the original
  Green checkpoint. Orders 140-202 provide the later independent TDD coverage;
  the shared historical waiver reason is broader than these individual causes.
- Formal evidence proves only the explicitly modeled abstraction, not runtime
  behavior. Eighteen requirements are reported as unsupported prose under the
  configured `solver: none` policy.
- Performance, mutation, and attestation are intentionally non-required and
  skipped by the custom quality profile. In particular, this candidate has no
  mutation-strength claim or signed CI provenance claim.
- The repository is not yet represented by a committed release-candidate
  digest. Release approval is therefore manifest-scoped to the exact artifact
  paths and aggregate hash produced by `approval prepare release`; it does not
  claim an isolated-checkout candidate digest.
- The front-matter status remains `in-progress` while release approval is
  pending; workflow completion, not pre-approval document state, closes the
  change.
