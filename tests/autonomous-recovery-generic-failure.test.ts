import { describe, expect, it, vi } from "vitest";
import {
  deriveClaimMatrix,
  FileRunStore,
  HohOrchestrator,
  parseHohConfig,
  type HohServices,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

async function runClaimRegressionFailure() {
  const root = await fixture();
  const store = new FileRunStore(root);
  const requirements = ["REQ-AUTONOMOUS-DEVELOPMENT-018"];
  const matrix = deriveClaimMatrix(requirements);
  const created = await store.create({
    source: { kind: "prompt", text: "claim regression rollback failure" },
    config: parseHohConfig({
      model: "gpt-5.4",
      budget: { aiCredits: 10 },
      commands: { test: ["npm", "test"] },
    }),
    requirements,
  });
  const candidate = {
    ref: "refs/musubix4/runs/test/stages/developer-1",
    treeDigest: "tree-1",
  };
  const current = await store.transition(created.id, "candidate", "candidate");
  current.iteration = 2;
  current.candidateBaselineInitialized = true;
  current.candidate = candidate;
  current.evidenceClaims = matrix.map((claim) => ({
    claimId: claim.id,
    status: "verified" as const,
    evidence: [`previous:${claim.id}`],
  }));
  await store.save(current);
  const retained = {
    ref: `refs/musubix4/runs/${created.id}/rejected/1`,
    treeDigest: candidate.treeDigest,
  };
  const services: HohServices = {
    roles: {
      planner: vi.fn(),
      developer: vi.fn(),
      qa: vi.fn().mockResolvedValue(
        matrix.map((claim, index) => ({
          claimId: claim.id,
          status: index === 0 ? ("gap" as const) : ("verified" as const),
          evidence: [`current:${claim.id}`],
        })),
      ),
    },
    project: {
      preflight: vi.fn(),
      candidateChecks: vi.fn(),
    },
    git: {
      initialize: vi.fn(),
      snapshot: vi.fn(),
      resolveCandidateCommit: vi.fn().mockResolvedValue("a".repeat(40)),
      retainRejectedCandidate: vi.fn().mockResolvedValue(retained),
      treeDigest: vi.fn().mockResolvedValue(candidate.treeDigest),
      createQaWorkspace: vi.fn().mockResolvedValue({ path: root, candidate }),
      cleanupQaWorkspace: vi.fn(),
      rollback: vi.fn().mockRejectedValue(new Error("index is locked")),
    },
  };
  const blocked = await new HohOrchestrator(store, services).resume(created.id);
  return { blocked, created, matrix, retained, services };
}

/** @id TEST-AUTONOMOUS-CANDIDATE-RECOVERY-004
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-018
 */
describe("generic rejected-candidate recovery failure", () => {
  it("TEST-AUTONOMOUS-CANDIDATE-RECOVERY-004 persists candidate isolation status for a plain rollback error", async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: "prompt", text: "generic rollback failure" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
    });
    const planned = await store.transition(
      created.id,
      "planned",
      "planner-completed",
    );
    planned.iteration = 1;
    planned.candidateBaselineInitialized = true;
    await store.save(planned);
    const candidate = {
      ref: "refs/musubix4/runs/test/stages/developer-1",
      treeDigest: "tree-1",
    };
    const services: HohServices = {
      roles: {
        planner: vi.fn(),
        developer: vi
          .fn()
          .mockResolvedValue({ executionRecords: [{ exitCode: 0 }] }),
        qa: vi.fn(),
      },
      project: {
        preflight: vi.fn(),
        candidateChecks: vi.fn().mockResolvedValue(false),
      },
      git: {
        initialize: vi.fn(),
        snapshot: vi.fn().mockResolvedValue(candidate),
        treeDigest: vi.fn().mockResolvedValue(candidate.treeDigest),
        resolveCandidateCommit: vi.fn().mockResolvedValue("e".repeat(40)),
        rollback: vi.fn().mockRejectedValue(new Error("index is locked")),
      },
    };
    const blocked = await new HohOrchestrator(store, services).resume(
      created.id,
    );
    expect(blocked).toMatchObject({
      state: "candidate-isolation-required",
      blockerRepairAttempts: 1,
      candidateIsolationRestoreTarget: `refs/musubix4/runs/${created.id}/base`,
      requiredOperatorAction:
        "restore-candidate-isolation-paths-or-start-new-run",
    });
    expect((await runClaimRegressionFailure()).blocked.blockerRepairAttempts).toBe(
      1,
    );
  });

  /** @id TEST-AUTONOMOUS-CLAIM-REGRESSION-RECOVERY-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-018
   */
  it("TEST-AUTONOMOUS-CLAIM-REGRESSION-RECOVERY-001 retains and counts a claim-regressed candidate before a plain rollback failure", async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const requirements = ["REQ-AUTONOMOUS-DEVELOPMENT-018"];
    const matrix = deriveClaimMatrix(requirements);
    const created = await store.create({
      source: { kind: "prompt", text: "claim regression rollback failure" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
      requirements,
    });
    const candidate = {
      ref: "refs/musubix4/runs/test/stages/developer-1",
      treeDigest: "tree-1",
    };
    const current = await store.transition(created.id, "candidate", "candidate");
    current.iteration = 2;
    current.candidateBaselineInitialized = true;
    current.candidate = candidate;
    current.evidenceClaims = matrix.map((claim) => ({
      claimId: claim.id,
      status: "verified" as const,
      evidence: [`previous:${claim.id}`],
    }));
    await store.save(current);
    const retained = {
      ref: `refs/musubix4/runs/${created.id}/rejected/1`,
      treeDigest: candidate.treeDigest,
    };
    const services: HohServices = {
      roles: {
        planner: vi.fn(),
        developer: vi.fn(),
        qa: vi.fn().mockResolvedValue(
          matrix.map((claim, index) => ({
            claimId: claim.id,
            status: index === 0 ? ("gap" as const) : ("verified" as const),
            evidence: [`current:${claim.id}`],
          })),
        ),
      },
      project: {
        preflight: vi.fn(),
        candidateChecks: vi.fn(),
      },
      git: {
        initialize: vi.fn(),
        snapshot: vi.fn(),
        resolveCandidateCommit: vi.fn().mockResolvedValue("a".repeat(40)),
        retainRejectedCandidate: vi.fn().mockResolvedValue(retained),
        treeDigest: vi.fn().mockResolvedValue(candidate.treeDigest),
        createQaWorkspace: vi.fn().mockResolvedValue({ path: root, candidate }),
        cleanupQaWorkspace: vi.fn(),
        rollback: vi.fn().mockRejectedValue(new Error("index is locked")),
      },
    };

    const blocked = await new HohOrchestrator(store, services).resume(created.id);

    expect(blocked).toMatchObject({
      state: "candidate-isolation-required",
      blockerRepairAttempts: 1,
      candidateIsolationRestoreTarget: `refs/musubix4/runs/${created.id}/base`,
      requiredOperatorAction:
        "restore-candidate-isolation-paths-or-start-new-run",
    });
    expect(blocked.rejectedCandidates).toEqual([
      expect.objectContaining({
        candidate: retained,
        reason: "claim-regression",
        evidence: [matrix[0]!.id],
      }),
    ]);
    expect(services.git.retainRejectedCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateSnapshotOrdinal: 1,
        rejectedCandidateCommit: "a".repeat(40),
      }),
    );
    expect(blocked.journal).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "candidate-isolation-required",
          details: expect.objectContaining({
            requiredOperatorAction:
              "Restore the tracked worktree and index to the selected candidate-isolation target or start a new run.",
          }),
        }),
      ]),
    );
  });

  /** @id TEST-AUTONOMOUS-CLAIM-REGRESSION-RECOVERY-002
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-018
   */
  it("TEST-AUTONOMOUS-CLAIM-REGRESSION-RECOVERY-002 preserves the QA role when claim-regression recovery fails", async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const requirements = ["REQ-AUTONOMOUS-DEVELOPMENT-018"];
    const matrix = deriveClaimMatrix(requirements);
    const created = await store.create({
      source: { kind: "prompt", text: "claim regression QA failure" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
      requirements,
    });
    const candidate = {
      ref: "refs/musubix4/runs/test/stages/developer-1",
      treeDigest: "tree-1",
    };
    const current = await store.transition(created.id, "candidate", "candidate");
    current.iteration = 2;
    current.candidateBaselineInitialized = true;
    current.candidate = candidate;
    current.evidenceClaims = matrix.map((claim) => ({
      claimId: claim.id,
      status: "verified" as const,
      evidence: [`previous:${claim.id}`],
    }));
    await store.save(current);
    const services: HohServices = {
      roles: {
        planner: vi.fn(),
        developer: vi.fn(),
        qa: vi.fn().mockResolvedValue(
          matrix.map((claim, index) => ({
            claimId: claim.id,
            status: index === 0 ? ("gap" as const) : ("verified" as const),
            evidence: [`current:${claim.id}`],
          })),
        ),
      },
      project: {
        preflight: vi.fn(),
        candidateChecks: vi.fn(),
      },
      git: {
        initialize: vi.fn(),
        snapshot: vi.fn(),
        resolveCandidateCommit: vi.fn().mockResolvedValue("b".repeat(40)),
        retainRejectedCandidate: vi.fn().mockResolvedValue({
          ref: `refs/musubix4/runs/${created.id}/rejected/1`,
          treeDigest: candidate.treeDigest,
        }),
        treeDigest: vi.fn().mockResolvedValue(candidate.treeDigest),
        createQaWorkspace: vi.fn().mockResolvedValue({ path: root, candidate }),
        cleanupQaWorkspace: vi.fn(),
        rollback: vi.fn().mockRejectedValue(new Error("index is locked")),
      },
    };

    const blocked = await new HohOrchestrator(store, services).resume(created.id);

    expect(blocked).toMatchObject({
      state: "candidate-isolation-required",
      role: "qa",
      blockerRepairAttempts: 1,
    });
  });
});
