---
schemaVersion: 1
id: CHANGE-0007
summary: Reduce SDD output and parallelize independent validations safely
status: in-progress
---
# CHANGE-0007: safe-workflow-speed

Requirements: REQ-SAFE-WORKFLOW-SPEED-001

## Intent

Reduce avoidable CLI output and wait time while preserving every SDD approval,
evidence, and producer-before-consumer dependency.

## Classification

Performance behavior change to shipped GitHub Copilot CLI Skill instructions.

## Impact

- Prefer concise human-readable output only for commands with reliable failure
  exits and sufficient diagnostics or authoritative written evidence.
- Retain first-invocation JSON for HoH lifecycle parsing, approval manifests,
  workflow verification, readiness decisions, and other structured decisions.
- Never rerun a mutating or append-only command merely to obtain JSON.
- Batch only the explicitly listed independent read-only validators in parallel.
- Keep approvals, TDD phases, artifact producers/consumers, and append-only
  evidence mutations sequential.
- Add deterministic distribution tests for the Skill contract.
- Document automatic HoH routing and safe validation batching in both READMEs
  and the changelog.

## Evidence deviation

The first Red/Green cycle was executed successfully, but its implementation
checkpoint was recorded after Green. A second review-driven Red/Green cycle
then covered the final command-form and sequential-execution assertions after
the original Green checkpoint. A third Red/Green cycle added initial English
and Japanese README assertions after the initial three CHANGE-0007 waivers had
been recorded. A fourth approved-requirement cycle retargeted that test to
REQ-SAFE-WORKFLOW-SPEED-002 and verifies the complete allowlist, sequential
boundary, and ordering contract. A fifth cycle strengthened the assertions to
distinguish parallel and sequential clauses. CHANGE-0007 has six waivers: the
initial three and three refreshed after the final cycle; together with
CHANGE-0006's fourteen, there are twenty across both changes. The abbreviated waiver
reasons are supported by all five passing focused cycles, the subsequent full
test suite, strict trace, graph gate, and changed quality gate. The waivers
acknowledge checkpoint chronology debt and do not claim that the first bounded
cycle alone covers the final Skill files and documentation.
REQ-SAFE-WORKFLOW-SPEED-002 was introduced after the append-only CHANGE-0007
phase checkpoints and is therefore outside their recorded requirement scope;
its implementation is covered by the fourth and later focused TDD cycles plus
the post-edit full validation and changed gate. The three refreshed waivers
were recorded after all five cycles, so their snapshots reflect the final
recorded REQ-SAFE-WORKFLOW-SPEED-001 cycle set. They bind the Red,
implementation, and Green checkpoint fingerprints recorded before the later
documentation cycles, not the final shipped file fingerprints; those are
instead covered by the five passing cycles, full test suite, strict trace,
graph gate, and changed quality gate.
