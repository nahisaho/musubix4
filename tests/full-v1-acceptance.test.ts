import { resolve } from "node:path";
import { expect, it } from "vitest";
import { createProgram } from "../packages/cli/src/main.js";
import {
  FileRunStore,
  HohOrchestrator,
  assessCandidate,
  deriveClaimMatrix,
  derivePolicy,
  normalizeQa,
  parseHohConfig,
  recordRunApproval,
  type CandidateSnapshot,
  type HohServices,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

const REQUIREMENTS = Array.from(
  { length: 18 },
  (_, index) =>
    `REQ-AUTONOMOUS-DEVELOPMENT-${String(index + 1).padStart(3, "0")}`,
);

/** @id TEST-HOH-FULL-V1-ACCEPTANCE-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-001 REQ-AUTONOMOUS-DEVELOPMENT-002 REQ-AUTONOMOUS-DEVELOPMENT-003 REQ-AUTONOMOUS-DEVELOPMENT-004 REQ-AUTONOMOUS-DEVELOPMENT-005 REQ-AUTONOMOUS-DEVELOPMENT-006 REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-008 REQ-AUTONOMOUS-DEVELOPMENT-009 REQ-AUTONOMOUS-DEVELOPMENT-010 REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-014 REQ-AUTONOMOUS-DEVELOPMENT-015 REQ-AUTONOMOUS-DEVELOPMENT-016 REQ-AUTONOMOUS-DEVELOPMENT-017 REQ-AUTONOMOUS-DEVELOPMENT-018
 */
it("TEST-HOH-FULL-V1-ACCEPTANCE-001 completes an approved full-v1 run without losing readiness evidence", async () => {
  const requirements = REQUIREMENTS.map(
    (id) =>
      `## ${id}: Capability\nPriority: must\nStatement: The system shall satisfy ${id}.\n`,
  ).join("\n");
  const root = await fixture({
    ".musubix/features/full-v1/requirements.md": requirements,
  });
  const store = new FileRunStore(root);
  const candidate: CandidateSnapshot = {
    ref: "refs/musubix4/runs/full-v1/candidate",
    treeDigest: "a".repeat(64),
  };
  const events: string[] = [];
  const services: HohServices = {
    roles: {
      planner: async ({ run }) => {
        events.push(`planner:${run.config.model}`);
        return {
          kind: "plan",
          priorities: [
            {
              requirementId: REQUIREMENTS[0],
              acceptanceGates: ["configured build and focused tests"],
              preservation: ["accepted candidate"],
            },
          ],
          addressedBlockers: [],
        };
      },
      developer: async ({ run }) => {
        events.push(`developer:${run.requirements?.length}`);
        return {
          executionRecords: [
            { command: "build", exitCode: 0 },
            { command: "focused-test", exitCode: 0 },
          ],
        };
      },
      qa: async ({ workspace }) => {
        events.push(`qa:${workspace ? "isolated" : "missing"}`);
        return deriveClaimMatrix(REQUIREMENTS).map((claim) => ({
          claimId: claim.id,
          status: "verified" as const,
          evidence: [`command:${claim.dimension}`],
        }));
      },
    },
    project: {
      preflight: async ({ config }) => {
        events.push(`preflight:${Object.keys(config.commands).sort().join(",")}`);
      },
      candidateChecks: async ({ output }) =>
        Array.isArray(output.executionRecords) &&
        output.executionRecords.length === 2,
    },
    git: {
      initialize: async () => {
        events.push("git:initialized");
      },
      snapshot: async () => candidate,
      createQaWorkspace: async () => ({
        path: resolve(root, ".qa-worktree"),
        candidateRef: candidate.ref,
      }),
      treeDigest: async () => candidate.treeDigest,
      cleanupQaWorkspace: async () => {
        events.push("qa:cleaned");
      },
      rollback: async () => candidate,
    },
  };
  const config = parseHohConfig({
    model: "gpt-fixed",
    reasoning: "high",
    copilotCliVersion: "1.2.3",
    budget: { aiCredits: 10 },
    commands: {
      build: [process.execPath, "-e", "process.exit(0)"],
      test: [process.execPath, "-e", "process.exit(0)"],
      deploy: [process.execPath, "-e", "process.exit(0)"],
      verify: [process.execPath, "-e", "process.exit(0)"],
      rollback: [process.execPath, "-e", "process.exit(0)"],
    },
  });
  const orchestrator = new HohOrchestrator(store, services);

  const started = await orchestrator.start({
    source: {
      kind: "musubix",
      path: ".musubix/features/full-v1/requirements.md",
    },
    config,
  });
  expect(started.requirements).toEqual(REQUIREMENTS);
  expect(createProgram().name()).toBe("musubix4");
  expect(derivePolicy("planner", {})).toMatchObject({
    allowWrite: false,
    allowProjectCommands: false,
  });

  expect((await orchestrator.resume(started.id)).state).toBe("planned");
  expect((await orchestrator.resume(started.id)).state).toBe("candidate");
  const awaitingApproval = await orchestrator.resume(started.id);
  expect(awaitingApproval.state).toBe("approval-paused");
  expect(awaitingApproval.evidence).toEqual({
    verified: 18 * 7,
    unresolved: 0,
    regressions: 0,
  });
  expect(events).toEqual(
    expect.arrayContaining([
      "preflight:build,deploy,rollback,test,verify",
      "git:initialized",
      "planner:gpt-fixed",
      "developer:18",
      "qa:isolated",
      "qa:cleaned",
    ]),
  );

  const readinessIndex = awaitingApproval.journal.findIndex(
    (entry) => entry.event === "readiness",
  );
  const approvalIndex = awaitingApproval.journal.findIndex(
    (entry) => entry.event === "approval-paused",
  );
  expect(readinessIndex).toBeGreaterThanOrEqual(0);
  expect(readinessIndex).toBeLessThan(approvalIndex);

  await recordRunApproval(store, {
    runId: started.id,
    stage: "release",
    nonce: awaitingApproval.approval!.nonce,
    manifestDigest: awaitingApproval.approval!.manifestDigest,
    approver: "full-v1-acceptance",
  });
  const completed = await orchestrator.resume(started.id);
  expect(completed.state).toBe("deployed");
  expect(completed.terminalReason).toBe("deployed");

  const matrix = deriveClaimMatrix(REQUIREMENTS);
  const verified = normalizeQa(
    matrix.map((claim) => ({
      claimId: claim.id,
      status: "verified" as const,
      evidence: ["command:acceptance"],
    })),
    matrix,
  );
  const regressed = normalizeQa(
    matrix.map((claim, index) => ({
      claimId: claim.id,
      status: index === 0 ? ("gap" as const) : ("verified" as const),
      evidence: ["command:regression"],
    })),
    matrix,
  );
  expect(assessCandidate(verified, regressed, true)).toMatchObject({
    preservationVerified: false,
    improved: false,
    regressions: [matrix[0]!.id],
  });
});
