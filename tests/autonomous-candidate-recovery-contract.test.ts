import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  CandidateBaselineError,
  CandidateIsolationError,
  FileRunStore,
  GitCandidateStore,
  HohOrchestrator,
  parseHohConfig,
  type HohServices,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

function git(root: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trimEnd();
}

async function repository(
  initial: Record<string, string>,
): Promise<string> {
  const root = await fixture({ ".gitignore": ".musubix4/\n", ...initial });
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "base"]);
  return root;
}

function config(overrides: Record<string, unknown> = {}) {
  return parseHohConfig({
    model: "gpt-5.4",
    budget: { aiCredits: 10 },
    commands: { test: ["npm", "test"] },
    ...overrides,
  });
}

/** @id TEST-AUTONOMOUS-CANDIDATE-ISOLATION-003
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-014
 */
describe("candidate recovery contract", () => {
  it("TEST-AUTONOMOUS-CANDIDATE-ISOLATION-003 normalizes injected racy-clean observations but retains staged and real dirt and enumerates persisted paths", async () => {
    const root = await repository({
      "racy.txt": "base\n",
      "real.txt": "base\n",
      "staged.txt": "base\n",
    });
    await writeFile(resolve(root, "real.txt"), "edit\n");
    await writeFile(resolve(root, "staged.txt"), "index\n");
    git(root, ["add", "staged.txt"]);
    const statusOverride = vi.fn(
      async (observed: Map<string, string>) =>
        new Map([...observed, ["racy.txt", " U"], ["staged.txt", "SU"]]),
    );
    const store = new GitCandidateStore(root, "racy-normalization", [], undefined, {
      observationHooks: { statusByPath: statusOverride },
    });
    await store.initialize();
    const baseline = JSON.parse(
      await readFile(
        resolve(
          root,
          ".musubix4/runs/racy-normalization/candidate-baseline.json",
        ),
        "utf8",
      ),
    ) as {
      dirtyPathStates: Array<{
        path: string;
        stagedIdentity: string;
        unstagedIdentity: string;
      }>;
    };
    expect(baseline.dirtyPathStates.map((state) => state.path)).toEqual([
      "real.txt",
      "staged.txt",
    ]);
    expect(baseline.dirtyPathStates[1]).toMatchObject({
      stagedIdentity: "modified",
      unstagedIdentity: "",
    });
    await writeFile(resolve(root, "staged.txt"), "changed-after-baseline\n");
    await expect(store.verifyInitializationBaseline()).rejects.toMatchObject({
      code: "CANDIDATE_ISOLATION_CONFLICT",
      paths: ["staged.txt"],
    });
    expect(statusOverride).toHaveBeenCalled();
  });

  /** @id TEST-AUTONOMOUS-CANDIDATE-BASELINE-007
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-012
   */
  it("TEST-AUTONOMOUS-CANDIDATE-BASELINE-007 fails closed for invalid versions, conditional bytes, limits, and unsupported dirty types before persistence", async () => {
    const versionRoot = await repository({ "dirty.txt": "base\n" });
    await writeFile(resolve(versionRoot, "dirty.txt"), "dirty\n");
    const versionStore = new GitCandidateStore(versionRoot, "invalid-version");
    await versionStore.initialize();
    const baselinePath = resolve(
      versionRoot,
      ".musubix4/runs/invalid-version/candidate-baseline.json",
    );
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    for (const schemaVersion of [1, 3]) {
      const invalid = { ...baseline, schemaVersion };
      invalid.statusDigest = createHash("sha256")
        .update(
          JSON.stringify({
            schemaVersion,
            runBaseCommit: invalid.runBaseCommit,
            dirtyPathStates: invalid.dirtyPathStates,
          }),
        )
        .digest("hex");
      await writeFile(baselinePath, `${JSON.stringify(invalid)}\n`);
      await expect(
        new GitCandidateStore(versionRoot, "invalid-version").initialize({
          allowCreate: false,
        }),
      ).rejects.toMatchObject({
        code: "CANDIDATE_BASELINE_INVALID",
      } satisfies Partial<CandidateBaselineError>);
    }

    const missingBytes = {
      ...baseline,
      dirtyPathStates: baseline.dirtyPathStates.map(
        ({ contentBase64: _ignored, ...state }: Record<string, unknown>) =>
          state,
      ),
    };
    missingBytes.statusDigest = createHash("sha256")
      .update(
        JSON.stringify({
          schemaVersion: 2,
          runBaseCommit: missingBytes.runBaseCommit,
          dirtyPathStates: missingBytes.dirtyPathStates,
        }),
      )
      .digest("hex");
    await writeFile(baselinePath, `${JSON.stringify(missingBytes)}\n`);
    await expect(
      new GitCandidateStore(versionRoot, "invalid-version").initialize({
        allowCreate: false,
      }),
    ).rejects.toMatchObject({ code: "CANDIDATE_BASELINE_INVALID" });

    for (const [runId, files] of [
      ["per-path-limit", { "large.txt": "12345" }],
      ["total-limit", { "a.txt": "123", "b.txt": "456" }],
    ] as const) {
      const root = await repository(files);
      for (const [path, contents] of Object.entries(files))
        await writeFile(resolve(root, path), `${contents}!`);
      await expect(
        new GitCandidateStore(root, runId, [], undefined, {
          candidateBaselineMaxDirtyBytes: 5,
        }).initialize(),
      ).rejects.toMatchObject({
        code: "CANDIDATE_BASELINE_TOO_LARGE",
      } satisfies Partial<CandidateBaselineError>);
      await expect(
        readFile(
          resolve(root, `.musubix4/runs/${runId}/candidate-baseline.json`),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }

    const gitlinkRoot = await repository({ "tracked.txt": "base\n" });
    const emptyTree = git(gitlinkRoot, ["mktree"]);
    const commit = git(gitlinkRoot, [
      "commit-tree",
      emptyTree,
      "-m",
      "submodule",
    ]);
    git(gitlinkRoot, [
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${commit},linked`,
    ]);
    await expect(
      new GitCandidateStore(gitlinkRoot, "unsupported-type").initialize(),
    ).rejects.toMatchObject({
      code: "CANDIDATE_BASELINE_UNSUPPORTED_TYPE",
    } satisfies Partial<CandidateBaselineError>);
  });

  /** @id TEST-AUTONOMOUS-CANDIDATE-RECOVERY-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-014 REQ-AUTONOMOUS-DEVELOPMENT-018
   */
  it("TEST-AUTONOMOUS-CANDIDATE-RECOVERY-001 restores exact index and worktree states while preserving all untracked paths", async () => {
    const root = await repository({
      ".gitattributes": "filtered.txt filter=upper\n",
      "clean.txt": "base\n",
      "deleted.txt": "base\n",
      "filtered.txt": "base\n",
      "mode.txt": "base\n",
      "staged-delete.txt": "base\n",
      "target.txt": "base-target\n",
    });
    git(root, ["config", "filter.upper.clean", "tr a-z A-Z"]);
    git(root, ["config", "filter.upper.smudge", "tr A-Z a-z"]);
    await writeFile(resolve(root, "deleted.txt"), "index-version\n");
    git(root, ["add", "deleted.txt"]);
    await rm(resolve(root, "deleted.txt"));
    await writeFile(resolve(root, "filtered.txt"), "mixedCase\n");
    git(root, ["add", "filtered.txt"]);
    await writeFile(resolve(root, "filtered.txt"), "worktree-filter\n");
    await chmod(resolve(root, "mode.txt"), 0o755);
    git(root, ["rm", "--cached", "staged-delete.txt"]);
    await symlink("target.txt", resolve(root, "link.txt"));
    git(root, ["add", "link.txt"]);
    const expectedIndex = git(root, ["ls-files", "--stage", "-z"]);
    const expectedFiltered = await readFile(resolve(root, "filtered.txt"));
    const store = new GitCandidateStore(root, "exact-recovery");
    await store.initialize();

    await writeFile(resolve(root, "clean.txt"), "candidate\n");
    await writeFile(resolve(root, "deleted.txt"), "candidate\n");
    await writeFile(resolve(root, "filtered.txt"), "candidate\n");
    await chmod(resolve(root, "mode.txt"), 0o644);
    git(root, ["add", "-A"]);
    await writeFile(resolve(root, "preexisting-untracked.txt"), "keep\n");
    await writeFile(resolve(root, "candidate-untracked.txt"), "keep-too\n");
    await store.rollback();

    expect(git(root, ["ls-files", "--stage", "-z"])).toBe(expectedIndex);
    expect(await readFile(resolve(root, "filtered.txt"))).toEqual(expectedFiltered);
    await expect(lstat(resolve(root, "deleted.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      spawnSync(
        "git",
        ["ls-files", "--error-unmatch", "staged-delete.txt"],
        { cwd: root },
      ).status,
    ).not.toBe(0);
    expect((await lstat(resolve(root, "mode.txt"))).mode & 0o111).not.toBe(0);
    expect(await readlink(resolve(root, "link.txt"))).toBe("target.txt");
    expect(await readFile(resolve(root, "preexisting-untracked.txt"), "utf8")).toBe(
      "keep\n",
    );
    expect(await readFile(resolve(root, "candidate-untracked.txt"), "utf8")).toBe(
      "keep-too\n",
    );
  });

  /** @id TEST-AUTONOMOUS-CANDIDATE-RECOVERY-002
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-014 REQ-AUTONOMOUS-DEVELOPMENT-018
   */
  it("TEST-AUTONOMOUS-CANDIDATE-RECOVERY-002 persists literal recovery target and resumes the same iteration only after target-aware verification", async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: "prompt", text: "recover" },
      config: config({ limits: { blockerRepairRetryLimit: 1 } }),
    });
    const planned = await store.transition(
      created.id,
      "planned",
      "planner-completed",
    );
    planned.iteration = 4;
    planned.stagnantIterations = 2;
    planned.preservationCandidate = {
      ref: "refs/musubix4/runs/run/candidate",
      treeDigest: "tree",
    };
    await store.save(planned);
    const candidate = {
      ref: "refs/musubix4/runs/run/stages/developer-4",
      treeDigest: "rejected",
    };
    const verifyIsolation = vi
      .fn()
      .mockRejectedValueOnce(
        new CandidateIsolationError(
          "CANDIDATE_ISOLATION_CONFLICT",
          "still differs",
          ["clean.txt", "protected.txt"],
          "restore",
          planned.preservationCandidate.ref,
        ),
      )
      .mockResolvedValueOnce(undefined);
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
        verifyIsolation,
        snapshot: vi.fn().mockResolvedValue(candidate),
        treeDigest: vi.fn(),
        rollback: vi.fn().mockRejectedValue(
          new CandidateIsolationError(
            "CANDIDATE_ISOLATION_CONFLICT",
            "recovery failed",
            ["clean.txt", "protected.txt"],
            "restore",
            planned.preservationCandidate.ref,
          ),
        ),
      },
    };
    const blocked = await new HohOrchestrator(store, services).resume(created.id);
    expect(blocked).toMatchObject({
      state: "candidate-isolation-required",
      iteration: 4,
      stagnantIterations: 2,
      blockerRepairAttempts: 1,
      candidateIsolationRestoreTarget: planned.preservationCandidate.ref,
      offendingCandidateIsolationPaths: ["clean.txt", "protected.txt"],
      requiredOperatorAction:
        "restore-candidate-isolation-paths-or-start-new-run",
    });
    expect(
      blocked.journal.some((entry) => entry.event === "blocker-retry"),
    ).toBe(false);
    expect(blocked.candidate).toBeUndefined();

    await expect(
      new HohOrchestrator(store, services).resume(created.id),
    ).rejects.toMatchObject({ code: "CANDIDATE_ISOLATION_CONFLICT" });
    const resumed = await new HohOrchestrator(store, services).resume(created.id);
    expect(resumed).toMatchObject({
      state: "planned",
      iteration: 4,
      blockerRepairAttempts: 1,
      candidateIsolationRestoreTarget: undefined,
    });
    expect(verifyIsolation).toHaveBeenLastCalledWith({
      run: expect.objectContaining({
        candidateIsolationRestoreTarget: planned.preservationCandidate.ref,
      }),
      restoreTarget: planned.preservationCandidate.ref,
    });
  });

  /** @id TEST-AUTONOMOUS-BLOCKER-IDENTITY-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-018
   */
  it("TEST-AUTONOMOUS-BLOCKER-IDENTITY-001 reuses incomplete snapshot ordinals and increments each closed rejection identity exactly once", async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: "prompt", text: "identity" },
      config: config(),
    });
    const candidateCommit = "a".repeat(40);
    const first = await store.openCandidateSnapshotAttempt(
      created.id,
      1,
      candidateCommit,
    );
    expect(
      await store.openCandidateSnapshotAttempt(created.id, 1, candidateCommit),
    ).toBe(first);
    const identity = store.blockerFailureIdentity({
      runId: created.id,
      iteration: 1,
      candidateSnapshotOrdinal: first,
      rejectedCandidateCommit: candidateCommit,
      kind: "candidate-checks-failed",
    });
    expect(identity).toMatch(/^[0-9a-f]{64}$/);
    await store.recordBlockerFailure(created.id, {
      identity,
      candidateSnapshotOrdinal: first,
      kind: "candidate-checks-failed",
    });
    await expect(
      store.recordBlockerFailure(created.id, {
        identity: store.blockerFailureIdentity({
          runId: created.id,
          iteration: 1,
          candidateSnapshotOrdinal: first,
          rejectedCandidateCommit: candidateCommit,
          kind: "qa-tree-modified",
        }),
        candidateSnapshotOrdinal: first,
        kind: "qa-tree-modified",
      }),
    ).rejects.toThrow("already has a decisive rejection");
    await store.completeCandidateSnapshotAttempt(created.id, first);
    const second = await store.openCandidateSnapshotAttempt(
      created.id,
      1,
      candidateCommit,
    );
    expect(second).toBe(first + 1);
    const persisted = await store.status(created.id);
    expect(persisted.blockerRepairAttempts).toBe(1);
    expect(
      persisted.journal.filter(
        (entry) => entry.event === "candidate-snapshot-attempt-opened",
      ),
    ).toHaveLength(2);
  });
});
