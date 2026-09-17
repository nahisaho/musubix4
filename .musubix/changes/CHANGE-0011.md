---
schemaVersion: 1
id: CHANGE-0011
summary: Enforce deterministic JSON role responses
status: in-progress
---
# CHANGE-0011: copilot-role-json-contract

Requirements: REQ-AUTONOMOUS-DEVELOPMENT-004 REQ-AUTONOMOUS-DEVELOPMENT-005

## Intent

Prevent HoH role exhaustion when current Copilot final answers contain prose or
a Markdown JSON fence instead of a directly parseable role object.

## Classification

Defect correction with clarified observable role-output behavior.

## Impact

- Add `renderRolePrompt` as the single prompt-construction path used by
  `localHohServices`, with a fixed trusted version-1 JSON-only response contract
  outside untrusted context for Planner, Developer, QA, and Reviewer.
- Require Reviewer output to echo the boundary identity, nonce, manifest digest,
  and reviewed paths and to return a findings array.
- Declare the concrete Planner, Developer, QA, and Reviewer output shapes in the
  trusted contract, including QA's JSON array and all Reviewer boundary fields.
- Parse trimmed raw JSON first, or exactly one complete lowercase `json`
  three-backtick envelope with LF or CRLF boundaries; reject other fence forms,
  prose, multiple envelope-level fences, trailing text, or malformed JSON.
- Preserve current model, usage, result, truncation, budget, and secret
  validation.
- Add focused Red-Green coverage for realistic current-protocol fenced Reviewer
  output and the real four-role prompt path without leaking execution metadata
  or allowing adversarial context to replace the trusted contract.
- Restore the temporarily removed `.musubix/hoh.json` before final verification;
  its removal is bootstrap-only and not part of the released candidate.
- Refresh bounded historical change/workflow waivers after current evidence
  invalidates their snapshots; these waivers do not replace CHANGE-0011's fresh
  Red-Green and full quality evidence.

## Bootstrap note

HoH release run `8767e400-1a73-466a-be22-183c2529bb13` passed baseline startup
but failed its requirements Reviewer after three attempts with
`Copilot final answer content is not valid JSON`. The user approved temporarily
removing `.musubix/hoh.json` to repair this startup path through normal SDD.
