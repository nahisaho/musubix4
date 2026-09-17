---
schemaVersion: 1
id: CHANGE-0008
summary: Supply local HoH reviewer execution config without changing its prompt
status: in-progress
---
# CHANGE-0008: local-hoh-reviewer-context

Requirements: REQ-AUTOMATIC-HOH-CODING-001

## Intent

Fix configured local HoH runs whose automatic-approval reviewer cannot resolve
the active run config, policy, attempt budget, or required
`MUSUBIX4_HOH_RUN_ID` marker.

## Classification

Defect correction. The existing requirement already requires configured
top-level coding requests to progress through one durable HoH run and every
local role invocation to receive the current non-empty
`MUSUBIX4_HOH_RUN_ID`, so no normative requirement change is needed.

## Impact

- Amend `DES-AUTOMATIC-HOH-CODING-002` and its interfaces to
  `HohServices.roles.reviewer`, `evaluateAutomaticManifest`,
  `reviewAutomaticBoundary`, and `autoApproveRunBoundary`. The reviewer receives
  a minimal `{id, config}` execution context as a second optional function
  argument; only the first boundary-context argument is serialized into the
  role prompt, and existing one-argument reviewers remain compatible. The
  existing `effective-run-config` manifest artifact remains reviewable.
- Preserve the reviewer envelope shape: it gains no `run` or `execution`
  wrapper and no execution-generated run ID; intentional manifest artifacts,
  including `effective-run-config`, remain reviewable.
- Supply the active run to the reviewer service as execution-only metadata
  across requirements, design, release, and protected-set amendment boundaries.
- Allow `localHohServices` to derive reviewer policy, environment marker, budget,
  and config without reading a missing `context.run`.
- Add regression coverage for first-resume reviewer execution through the
  shared automatic-manifest reviewer call. Requirements and design exercise the
  shared call directly; release and amendment use the same call structurally.
  Capture the local reviewer prompt and reject leaked `run` or `execution`
  wrappers and the run ID while asserting the approved top-level boundary keys.
- The pre-existing protected-set amendment behavior that recognizes only
  `.musubix/hoh.json`, not `.musubix/config.json#/hoh`, is outside this defect.

## Evidence note

Because this defect violates the existing requirement without changing its
statement or acceptance criteria, the requirements checkpoint uses the
defect-correction `--allow-unchanged` path.

The new correctly ordered Red/Green cycle changes the cycle set referenced by
CHANGE-0006's historical chronology waivers. Three refreshed CHANGE-0006
waivers were recorded after this cycle; they waive only the old checkpoint
ordering debt, not this defect's implementation or validation evidence.

After the CHANGE-0008 quality checkpoint, release review found that the initial
prompt assertion did not distinguish the reviewer envelope from intentional
manifest bytes. A second review-driven Red/Green cycle now proves that adding
the execution wrapper to the serialized prompt fails and that the final
implementation excludes it. This later cycle is valid behavioral evidence but
postdates the append-only CHANGE-0008 phase checkpoints. One
`CHANGE_ORDER_MIGRATION_REQUIRED` waiver records that fact for CHANGE-0008.
Four final CHANGE-0006 waivers were also recorded against the resulting cycle
set.

A third focused cycle then narrowed the run-ID leak assertion to the reviewer
envelope outside independently governed manifest bytes, while preserving the
exact base-key check. It recorded a real Red with an injected envelope run ID
and Green after removal. The public reviewer member also retains method syntax
for callback variance compatibility, and execution metadata validates both ID
and config before boundary-attempt consumption. A second
`CHANGE_ORDER_MIGRATION_REQUIRED` waiver refreshes CHANGE-0008 against this
final cycle. Four more CHANGE-0006 waivers were refreshed against the same
cycle set, bringing CHANGE-0006 to fourteen waivers and CHANGE-0006/0007 to
twenty total.

Before the second valid cycle, one attempted Red was rejected because the
target test still passed; it has `red.valid=false` and no Green and is not
counted among the three valid focused cycles.
