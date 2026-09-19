import { lstat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  CandidateIsolationError,
  FileRunStore,
  GitCandidateStore,
  HohOrchestrator,
  parseHohConfig,
  type CandidateSnapshot,
  type HohServices,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

function config(blockerRepairRetryLimit = 2) {
  return parseHohConfig({
    model: "gpt-5.4",
    budget: { aiCredits: 10 },
    commands: { test: ["npm", "test"] },
    limits: { blockerRepairRetryLimit },
  });
}

function git(root: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function plannedRun(root: string, blockerRepairAttempts = 0) {
  const store = new FileRunStore(root);
  const created = await store.create({
    source: { kind: "prompt", text: "release-review" },
    config: config(),
  });
  const planned = await store.transition(
    created.id,
    "planned",
    "planner-completed",
  );
  planned.iteration = 1;
  planned.blockerRepairAttempts = blockerRepairAttempts;
  planned.candidateBaselineInitialized = true;
  await store.save(planned);
  return { store, runId: created.id };
}

function candidate(index: number): CandidateSnapshot {
  return {
    ref: `refs/musubix4/runs/test/stages/candidate-${index}`,
    treeDigest: `tree-${index}`,
  };
}

/** @id TEST-AUTONOMOUS-BLOCKER-RETRY-BOUNDARY-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-018
 */
describe("CHANGE-0015 release review corrections", () => {
  it("TEST-AUTONOMOUS-BLOCKER-RETRY-BOUNDARY-001 treats limit two as two retries, rolls back at count three, resets only verified episodes, and preserves failed recovery", async () => {
    const root = await fixture();
    const { store, runId } = await plannedRun(root);
    let snapshotIndex = 0;
    const retained: string[] = [];
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
        staticCandidateValidation: vi
          .fn()
          .mockResolvedValue({ valid: true, pinnedInvocations: [], digest: "d" }),
        candidateChecks: vi.fn().mockResolvedValue(false),
      },
      git: {
        initialize: vi.fn(),
        snapshot: vi.fn().mockImplementation(() => candidate(++snapshotIndex)),
        resolveCandidateCommit: vi
          .fn()
          .mockImplementation(() => `${snapshotIndex}`.repeat(40)),
        retainRejectedCandidate: vi
          .fn()
          .mockImplementation(({ candidateSnapshotOrdinal }) => {
            const ref = `refs/musubix4/runs/test/rejected/${candidateSnapshotOrdinal}`;
            retained.push(ref);
            return { ref, treeDigest: `rejected-${candidateSnapshotOrdinal}` };
          }),
        treeDigest: vi.fn(),
        rollback: vi.fn().mockResolvedValue({
          ref: "refs/musubix4/runs/test/base",
          treeDigest: "base",
        }),
      },
    };
    const orchestrator = new HohOrchestrator(store, services);
    const first = await orchestrator.resume(runId);
    expect(first).toMatchObject({
      state: "planned",
      blockerRepairAttempts: 1,
    });
    expect(first.journal.at(-1)?.event).toBe("blocker-retry");
    const second = await orchestrator.resume(runId);
    expect(second).toMatchObject({
      state: "planned",
      blockerRepairAttempts: 2,
    });
    expect(second.journal.at(-1)?.event).toBe("blocker-retry");
    const third = await orchestrator.resume(runId);
    expect(third).toMatchObject({
      state: "planned",
      blockerRepairAttempts: 0,
    });
    expect(third.journal.at(-1)?.event).toBe("blocker-rollback");
    expect(retained).toEqual([
      "refs/musubix4/runs/test/rejected/1",
      "refs/musubix4/runs/test/rejected/2",
      "refs/musubix4/runs/test/rejected/3",
    ]);

    const acceptedRoot = await fixture();
    const accepted = await plannedRun(acceptedRoot, 2);
    const acceptedServices = {
      ...services,
      project: {
        ...services.project,
        candidateChecks: vi.fn().mockResolvedValue(true),
      },
      git: {
        ...services.git,
        snapshot: vi.fn().mockResolvedValue(candidate(9)),
        resolveCandidateCommit: vi.fn().mockResolvedValue("9".repeat(40)),
      },
    };
    expect(
      await new HohOrchestrator(
        accepted.store,
        acceptedServices,
      ).resume(accepted.runId),
    ).toMatchObject({ state: "candidate", blockerRepairAttempts: 0 });

    const failedRoot = await fixture();
    const failed = await plannedRun(failedRoot, 2);
    const failedServices = {
      ...services,
      git: {
        ...services.git,
        snapshot: vi.fn().mockResolvedValue(candidate(8)),
        resolveCandidateCommit: vi.fn().mockResolvedValue("8".repeat(40)),
        rollback: vi.fn().mockRejectedValue(
          new CandidateIsolationError(
            "CANDIDATE_ISOLATION_CONFLICT",
            "rollback verification failed",
            "tracked.txt",
            "restore",
          ),
        ),
      },
    };
    const blocked = await new HohOrchestrator(
      failed.store,
      failedServices,
    ).resume(failed.runId);
    expect(blocked).toMatchObject({
      state: "candidate-isolation-required",
      blockerRepairAttempts: 3,
    });
    expect(blocked.rejectedCandidates).toEqual([
      expect.objectContaining({
        candidate: expect.objectContaining({
          ref: "refs/musubix4/runs/test/rejected/1",
        }),
      }),
    ]);
  });

  /** @id TEST-AUTONOMOUS-SNAPSHOT-ATTEMPT-002
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-012
   */
  it("TEST-AUTONOMOUS-SNAPSHOT-ATTEMPT-002 abandons an incomplete mismatched OID, reuses only the same OID, completes attempts, and permits one decisive kind", async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: "prompt", text: "snapshot identity" },
      config: config(),
    });
    const oidA = "a".repeat(40);
    const oidB = "b".repeat(40);
    const first = await store.openCandidateSnapshotAttempt(created.id, 1, oidA);
    expect(
      await store.openCandidateSnapshotAttempt(created.id, 1, oidA),
    ).toBe(first);
    const second = await store.openCandidateSnapshotAttempt(created.id, 1, oidB);
    expect(second).toBe(first + 1);
    const identity = store.blockerFailureIdentity({
      runId: created.id,
      iteration: 1,
      candidateSnapshotOrdinal: second,
      rejectedCandidateCommit: oidB,
      kind: "candidate-checks-failed",
    });
    expect(
      await store.recordBlockerFailure(created.id, {
        identity,
        candidateSnapshotOrdinal: second,
        kind: "candidate-checks-failed",
      }),
    ).toBe(1);
    await expect(
      store.recordBlockerFailure(created.id, {
        identity: store.blockerFailureIdentity({
          runId: created.id,
          iteration: 1,
          candidateSnapshotOrdinal: second,
          rejectedCandidateCommit: oidB,
          kind: "qa-tree-modified",
        }),
        candidateSnapshotOrdinal: second,
        kind: "qa-tree-modified",
      }),
    ).rejects.toThrow("already has a decisive rejection");
    await store.completeCandidateSnapshotAttempt(created.id, second);
    const persisted = await store.status(created.id);
    expect(persisted.blockerRepairAttempts).toBe(1);
    expect(
      persisted.journal.find(
        (entry) => entry.event === "candidate-snapshot-attempt-abandoned",
      )?.details,
    ).toMatchObject({
      candidateSnapshotOrdinal: first,
      candidateCommit: oidA,
      replacementCandidateCommit: oidB,
    });
    expect(
      persisted.journal.find(
        (entry) => entry.event === "candidate-snapshot-attempt-completed",
      )?.details,
    ).toMatchObject({ candidateSnapshotOrdinal: second });
  });

  /** @id TEST-AUTONOMOUS-REJECTED-REF-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-018
   */
  it("TEST-AUTONOMOUS-REJECTED-REF-001 retains two same-iteration snapshots under immutable ordinal refs across rollback", async () => {
    const root = await fixture({
      ".gitignore": ".musubix4/\n",
      "tracked.txt": "base\n",
    });
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "base"]);
    const store = new GitCandidateStore(root, "immutable-rejected");
    await store.initialize();
    await writeFile(resolve(root, "tracked.txt"), "candidate-one\n");
    const first = await store.snapshotStage("developer-1");
    const firstOid = git(root, ["rev-parse", `${first.ref}^{commit}`]);
    const rejectedOne = await store.retainRejectedCandidate(first, 1, firstOid);
    await writeFile(resolve(root, "tracked.txt"), "candidate-two\n");
    const second = await store.snapshotStage("developer-1");
    const secondOid = git(root, ["rev-parse", `${second.ref}^{commit}`]);
    const rejectedTwo = await store.retainRejectedCandidate(second, 2, secondOid);
    await store.rollback();
    expect(rejectedOne.ref).not.toBe(rejectedTwo.ref);
    expect(git(root, ["rev-parse", `${rejectedOne.ref}^{commit}`])).toBe(firstOid);
    expect(git(root, ["rev-parse", `${rejectedTwo.ref}^{commit}`])).toBe(secondOid);
    expect(await readFile(resolve(root, "tracked.txt"), "utf8")).toBe("base\n");
  });

  /** @id TEST-AUTONOMOUS-DECLARED-SURFACE-DIVERGENCE-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-018
   */
  it("TEST-AUTONOMOUS-DECLARED-SURFACE-DIVERGENCE-001 detects disposable-workspace surface drift before QA and routes one real decisive rejection", async () => {
    const root = await fixture();
    const { store, runId } = await plannedRun(root);
    const snapshot = candidate(1);
    const qa = vi.fn();
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
          .mockResolvedValue({ valid: true, pinnedInvocations: [], digest: "A" }),
        candidateSurfaceDigest: vi.fn().mockResolvedValue("B"),
        candidateChecks: vi.fn().mockResolvedValue(true),
      },
      git: {
        initialize: vi.fn(),
        snapshot: vi.fn().mockResolvedValue(snapshot),
        resolveCandidateCommit: vi.fn().mockResolvedValue("c".repeat(40)),
        retainRejectedCandidate: vi.fn().mockResolvedValue({
          ref: "refs/musubix4/runs/test/rejected/1",
          treeDigest: "tree-1",
        }),
        createQaWorkspace: vi.fn().mockResolvedValue({ path: "qa-workspace" }),
        cleanupQaWorkspace: vi.fn(),
        treeDigest: vi.fn().mockResolvedValue(snapshot.treeDigest),
        rollback,
      },
    };
    const accepted = await new HohOrchestrator(store, services).resume(runId);
    expect(accepted.candidate).toMatchObject({
      declaredSurfaceDigest: "A",
    });
    const rejected = await new HohOrchestrator(store, services).resume(runId);
    expect(rejected).toMatchObject({
      state: "planned",
      blockerRepairAttempts: 1,
    });
    expect(rejected.journal.at(-1)).toMatchObject({
      event: "blocker-retry",
      details: { reason: "declared-surface-divergence" },
    });
    expect(rollback).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "declared-surface-divergence" }),
    );
    expect(qa).not.toHaveBeenCalled();
  });

  /** @id TEST-AUTONOMOUS-CANDIDATE-BASELINE-008
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-014
   */
  it("TEST-AUTONOMOUS-CANDIDATE-BASELINE-008 persists canonical state key order and leaves no isolated-index artifact in the worktree", async () => {
    const root = await fixture({
      ".gitignore": ".musubix4/\n",
      "dirty.txt": "base\n",
    });
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "base"]);
    await writeFile(resolve(root, "dirty.txt"), "staged\n");
    git(root, ["add", "dirty.txt"]);
    await writeFile(resolve(root, "dirty.txt"), "worktree\n");
    const store = new GitCandidateStore(root, "canonical-baseline");
    await store.initialize();
    const baselineBytes = await readFile(
      resolve(
        root,
        ".musubix4/runs/canonical-baseline/candidate-baseline.json",
      ),
      "utf8",
    );
    const baseline = JSON.parse(baselineBytes) as {
      dirtyPathStates: Array<Record<string, unknown>>;
      statusDigest: string;
    };
    expect(Object.keys(baseline.dirtyPathStates[0]!)).toEqual([
      "path",
      "content",
      "contentBase64",
      "stagedContentBase64",
      "mode",
      "existence",
      "indexEntry",
      "stagedIdentity",
      "unstagedIdentity",
    ]);
    await expect(
      lstat(resolve(root, ".musubix4/candidate-isolation-indexes")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const reloaded = new GitCandidateStore(root, "canonical-baseline");
    await reloaded.initialize({ allowCreate: false });
    expect(
      JSON.parse(
        await readFile(
          resolve(
            root,
            ".musubix4/runs/canonical-baseline/candidate-baseline.json",
          ),
          "utf8",
        ),
      ).statusDigest,
    ).toBe(baseline.statusDigest);
  });
});
