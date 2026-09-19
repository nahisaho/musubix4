import { describe, expect, it, vi } from "vitest";
import {
  FileRunStore,
  HohOrchestrator,
  parseHohConfig,
  type CandidateSnapshot,
  type HohServices,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

async function plannedRun(root: string) {
  const store = new FileRunStore(root);
  const created = await store.create({
    source: { kind: "prompt", text: "declared-surface-workspace" },
    config: parseHohConfig({
      model: "gpt-5.4",
      budget: { aiCredits: 10 },
      commands: { test: ["npm", "test"] },
      limits: { blockerRepairRetryLimit: 2 },
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
  return { store, runId: created.id };
}

function candidate(): CandidateSnapshot {
  return {
    ref: "refs/musubix4/runs/test/stages/candidate-1",
    treeDigest: "tree-1",
  };
}

/** @id TEST-AUTONOMOUS-DECLARED-SURFACE-DIVERGENCE-002
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-018
 */
describe("declared surface workspace isolation", () => {
  it("TEST-AUTONOMOUS-DECLARED-SURFACE-DIVERGENCE-002 fails closed when the disposable QA workspace is unavailable", async () => {
    const root = await fixture();
    const { store, runId } = await plannedRun(root);
    const snapshot = candidate();
    const qa = vi.fn();
    const candidateSurfaceDigest = vi.fn().mockResolvedValue("A");
    const rollback = vi.fn().mockResolvedValue({
      ref: "refs/musubix4/runs/test/base",
      treeDigest: "base",
    });
    const services: HohServices = {
      roles: {
        planner: vi.fn(),
        developer: vi
          .fn()
          .mockResolvedValue({ executionRecords: [{ exitCode: 0 }] }),
        qa,
      },
      project: {
        preflight: vi.fn(),
        staticCandidateValidation: vi
          .fn()
          .mockResolvedValue({
            valid: true,
            pinnedInvocations: [],
            digest: "A",
          }),
        candidateSurfaceDigest,
        candidateChecks: vi.fn().mockResolvedValue(true),
      },
      git: {
        initialize: vi.fn(),
        snapshot: vi.fn().mockResolvedValue(snapshot),
        resolveCandidateCommit: vi.fn().mockResolvedValue("d".repeat(40)),
        retainRejectedCandidate: vi.fn().mockResolvedValue({
          ref: "refs/musubix4/runs/test/rejected/1",
          treeDigest: "tree-1",
        }),
        createQaWorkspace: vi.fn().mockResolvedValue(undefined),
        cleanupQaWorkspace: vi.fn(),
        treeDigest: vi.fn().mockResolvedValue(snapshot.treeDigest),
        rollback,
      },
    };
    await new HohOrchestrator(store, services).resume(runId);
    const rejected = await new HohOrchestrator(store, services).resume(runId);
    expect(rejected).toMatchObject({
      state: "planned",
      blockerRepairAttempts: 1,
    });
    expect(rejected.journal.at(-1)).toMatchObject({
      event: "blocker-retry",
      details: { reason: "declared-surface-divergence" },
    });
    expect(candidateSurfaceDigest).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "declared-surface-divergence" }),
    );
    expect(qa).not.toHaveBeenCalled();
  });
});
