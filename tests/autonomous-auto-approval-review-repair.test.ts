import { describe, expect, it, vi } from "vitest";
import {
  FileRunStore,
  HohOrchestrator,
  parseHohConfig,
  pauseForApproval,
  recordRunApproval,
  type HohServices,
  type MandatoryQaCheck,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

const passedChecks = (): MandatoryQaCheck[] =>
  [
    "build",
    "focused-test",
    "static-validation",
    "trace",
    "dependency-cycle",
    "structured-contract",
    "inherited-compatibility",
  ].map((id) => ({
    id: id as MandatoryQaCheck["id"],
    status: "passed",
    evidence: [`evidence://${id}`],
  }));

/** @id TEST-AUTONOMOUS-AUTO-APPROVAL-MANUAL-REJECT-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe("verified automatic approval authority", () => {
  it("TEST-AUTONOMOUS-AUTO-APPROVAL-MANUAL-REJECT-001 rejects manual decisions before mutating any boundary", async () => {
    const root = await fixture({
      ".musubix/hoh.json": '{"schemaVersion":1}\n',
    });
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: "prompt", text: "Build safely" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
      requirements: ["REQ-AUTONOMOUS-DEVELOPMENT-016"],
    });
    const paused = await pauseForApproval(
      store,
      created.id,
      "release",
      "a".repeat(64),
    );

    await expect(
      recordRunApproval(store, {
        runId: paused.id,
        stage: "release",
        nonce: paused.approval!.nonce,
        manifestDigest: paused.approval!.manifestDigest,
        approver: "human",
      }),
    ).rejects.toThrow(
      "Manual approval cannot authorize a verified automatic approval boundary.",
    );

    const unchanged = await store.status(created.id);
    expect(unchanged.state).toBe("approval-paused");
    expect(unchanged.approval?.decision).toBeUndefined();
  });
});

/** @id TEST-AUTONOMOUS-AUTO-RELEASE-REVIEW-REPAIR-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe("automatic release Reviewer repair", () => {
  it("TEST-AUTONOMOUS-AUTO-RELEASE-REVIEW-REPAIR-001 invalidates release authority and routes findings through Planner", async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: "prompt", text: "Build safely" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
        approval: { mode: "verified-auto", boundaryAttemptLimit: 2 },
      }),
      requirements: ["REQ-AUTONOMOUS-DEVELOPMENT-016"],
    });
    const candidate = {
      ref: "refs/musubix4/runs/test/stages/candidate",
      treeDigest: "a".repeat(40),
    };
    const repairedCandidate = {
      ref: "refs/musubix4/runs/test/stages/repaired-candidate",
      treeDigest: "b".repeat(40),
    };
    const current = await store.transition(
      created.id,
      "candidate",
      "test-candidate",
    );
    current.candidate = candidate;
    current.iteration = 1;
    await store.save(current);
    const mandatoryChecks = vi.fn().mockResolvedValue(passedChecks());
    let finding = true;
    const reviewer = vi.fn(async (context: unknown) => {
      const boundary = context as {
        stage: string;
        boundaryKind: string;
        boundaryEpisodeOrdinal: number;
        nonce: string;
        manifestDigest: string;
        manifestPaths: string[];
      };
      return {
        ...boundary,
        reviewedPaths: boundary.manifestPaths,
        findings: finding
          ? [{ severity: "high", message: "repair candidate" }]
          : [],
      };
    });
    const services: HohServices = {
      roles: {
        planner: vi.fn().mockResolvedValue({
          kind: "plan",
          priorities: [
            {
              requirementId: "REQ-AUTONOMOUS-DEVELOPMENT-016",
              acceptanceGates: ["verified approval"],
              preservation: ["existing behavior"],
            },
          ],
        }),
        developer: vi
          .fn()
          .mockResolvedValue({ executionRecords: [{ command: "repair" }] }),
        qa: vi.fn().mockResolvedValue([]),
        reviewer,
      },
      project: {
        preflight: vi.fn(),
        candidateChecks: vi.fn().mockResolvedValue(true),
        mandatoryChecks,
      },
      git: {
        snapshot: vi.fn().mockResolvedValue(repairedCandidate),
        treeDigest: vi.fn(
          async ({ candidate: currentCandidate }) =>
            currentCandidate.treeDigest,
        ),
        rollback: vi.fn(),
        createQaWorkspace: vi.fn().mockResolvedValue({ path: root, candidate }),
        cleanupQaWorkspace: vi.fn(),
      },
    };
    const orchestrator = new HohOrchestrator(store, services);

    const repair = await orchestrator.resume(created.id);

    expect(repair.state).toBe("qa");
    expect(repair.role).toBe("planner");
    expect(repair.releaseGateBinding).toBeUndefined();
    expect(repair.releaseGateEvidence).toBeUndefined();
    expect(repair.releaseBlockers).toHaveLength(1);
    expect(mandatoryChecks).toHaveBeenCalledTimes(1);

    finding = false;
    expect((await orchestrator.resume(created.id)).state).toBe("planned");
    expect((await orchestrator.resume(created.id)).state).toBe("candidate");
    const approved = await orchestrator.resume(created.id);

    expect(approved.state).toBe("ready");
    expect(mandatoryChecks).toHaveBeenCalledTimes(2);
  });
});

/** @id TEST-AUTONOMOUS-AUTO-REQUIREMENTS-FINDINGS-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe("automatic immutable requirements review", () => {
  it("TEST-AUTONOMOUS-AUTO-REQUIREMENTS-FINDINGS-001 blocks immediately when Reviewer findings cannot be repaired", async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: "prompt", text: "Build safely" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
        approval: { mode: "verified-auto", boundaryAttemptLimit: 3 },
      }),
      requirements: ["REQ-AUTONOMOUS-DEVELOPMENT-016"],
    });
    const reviewer = vi.fn(async (context: unknown) => {
      const boundary = context as {
        stage: string;
        boundaryKind: string;
        boundaryEpisodeOrdinal: number;
        nonce: string;
        manifestDigest: string;
        manifestPaths: string[];
      };
      return {
        ...boundary,
        reviewedPaths: boundary.manifestPaths,
        findings: [
          {
            severity: "high",
            message: "requirements are immutable for this run",
          },
        ],
      };
    });
    const services: HohServices = {
      roles: {
        planner: vi.fn(),
        developer: vi.fn(),
        qa: vi.fn(),
        reviewer,
      },
      project: {
        preflight: vi.fn(),
        candidateChecks: vi.fn(),
      },
      git: {
        snapshot: vi.fn(),
        treeDigest: vi.fn(),
        rollback: vi.fn(),
      },
    };

    const result = await new HohOrchestrator(store, services).resume(
      created.id,
    );

    expect(result.state).toBe("failed");
    expect(result.terminalReason).toBe("approval-blocked");
    expect(reviewer).toHaveBeenCalledTimes(1);
  });
});
