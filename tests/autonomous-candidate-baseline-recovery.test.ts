import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CandidateBaselineError,
  computeProtectedSet,
  FileRunStore,
  GitCandidateStore,
  HohOrchestrator,
  parseHohConfig,
  type HohServices,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

/** @id TEST-AUTONOMOUS-CANDIDATE-BASELINE-003
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-014 REQ-AUTONOMOUS-DEVELOPMENT-018
 */
describe("candidate baseline recovery", () => {
  it("TEST-AUTONOMOUS-CANDIDATE-BASELINE-003 fails closed on invalid durable state and resumes only after isolation verification", async () => {
    const root = await fixture({
      ".gitignore": ".musubix4/\n",
      "tracked.txt": "base\n",
    });
    spawnSync("git", ["init", "-q"], { cwd: root });
    spawnSync("git", ["config", "user.email", "test@example.com"], {
      cwd: root,
    });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: root });
    spawnSync("git", ["add", "."], { cwd: root });
    spawnSync("git", ["commit", "-qm", "base"], { cwd: root });

    const runId = "candidate-baseline-recovery";
    const store = new GitCandidateStore(root, runId, []);
    const initialized = await store.initialize();
    const baselinePath = resolve(
      root,
      ".musubix4/runs",
      runId,
      "candidate-baseline.json",
    );
    const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as {
      schemaVersion: 2;
      runBaseCommit: string;
      statusDigest: string;
      dirtyPathStates: unknown[];
    };

    await rm(baselinePath);
    await expect(
      new GitCandidateStore(root, runId, []).initialize({
        allowCreate: false,
      }),
    ).rejects.toMatchObject({
      code: "CANDIDATE_BASELINE_MISSING",
    } satisfies Partial<CandidateBaselineError>);

    const unavailable = "f".repeat(40);
    const unavailableBaseline = {
      schemaVersion: 2 as const,
      runBaseCommit: unavailable,
      dirtyPathStates: baseline.dirtyPathStates,
    };
    await writeFile(
      baselinePath,
      `${JSON.stringify({
        ...unavailableBaseline,
        statusDigest: createHash("sha256")
          .update(JSON.stringify(unavailableBaseline))
          .digest("hex"),
      })}\n`,
    );
    await expect(
      new GitCandidateStore(root, runId, []).initialize({
        allowCreate: false,
      }),
    ).rejects.toMatchObject({
      code: "CANDIDATE_BASE_COMMIT_UNRESOLVABLE",
    } satisfies Partial<CandidateBaselineError>);
    await rm(baselinePath);
    await mkdir(baselinePath);
    await expect(
      new GitCandidateStore(root, runId, []).initialize({
        allowCreate: false,
      }),
    ).rejects.toMatchObject({
      code: "CANDIDATE_BASELINE_INVALID",
    } satisfies Partial<CandidateBaselineError>);

    const runRoot = await fixture();
    const runStore = new FileRunStore(runRoot);
    const created = await runStore.create({
      source: { kind: "prompt", text: "Recover candidate isolation" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
      requirements: ["REQ-AUTONOMOUS-DEVELOPMENT-007"],
    });
    const paused = await runStore.transition(
      created.id,
      "candidate-isolation-required",
      "candidate-isolation-required",
    );
    paused.iteration = 1;
    paused.stagnantIterations = 2;
    paused.blockerRepairAttempts = 1;
    paused.requiredOperatorAction =
      "restore-candidate-isolation-paths-or-start-new-run";
    paused.offendingCandidateIsolationPaths = ["tracked.txt"];
    await runStore.save(paused);
    const services: HohServices = {
      roles: {
        planner: vi.fn(),
        developer: vi.fn(),
        qa: vi.fn(),
      },
      project: {
        preflight: vi.fn(),
        candidateChecks: vi.fn(),
      },
      git: {
        verifyIsolation: vi.fn(),
        snapshot: vi.fn(),
        treeDigest: vi.fn(),
        rollback: vi.fn(),
      },
    };
    expect(
      await new HohOrchestrator(runStore, services).resume(created.id),
    ).toMatchObject({
      state: "planned",
      iteration: 1,
      stagnantIterations: 2,
      blockerRepairAttempts: 1,
      requiredOperatorAction: "none",
      offendingCandidateIsolationPaths: [],
    });
    expect(services.git.verifyIsolation).toHaveBeenCalledOnce();
    expect(initialized.baseCommit).toBe(baseline.runBaseCommit);
  });

  /** @id TEST-AUTONOMOUS-CANDIDATE-BASELINE-004
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-014
   */
  it("TEST-AUTONOMOUS-CANDIDATE-BASELINE-004 preserves terminal runs and cleans failed snapshot refs while including explicitly selected ignored files", async () => {
    const terminalRoot = await fixture();
    const terminalStore = new FileRunStore(terminalRoot);
    const created = await terminalStore.create({
      source: { kind: "prompt", text: "Terminal run" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
    });
    const failed = await terminalStore.transition(
      created.id,
      "failed",
      "existing-terminal",
    );
    failed.terminalReason = "existing-terminal";
    await terminalStore.save(failed);
    const initialize = vi.fn().mockRejectedValue(
      new CandidateBaselineError(
        "CANDIDATE_BASELINE_MISSING",
        "must not be observed",
      ),
    );
    const terminalServices: HohServices = {
      roles: {
        planner: vi.fn(),
        developer: vi.fn(),
        qa: vi.fn(),
      },
      project: {
        preflight: vi.fn(),
        candidateChecks: vi.fn(),
      },
      git: {
        initialize,
        snapshot: vi.fn(),
        treeDigest: vi.fn(),
        rollback: vi.fn(),
      },
    };
    expect(
      await new HohOrchestrator(
        terminalStore,
        terminalServices,
      ).resume(created.id),
    ).toMatchObject({
      state: "failed",
      terminalReason: "existing-terminal",
    });
    expect(initialize).not.toHaveBeenCalled();

    const root = await fixture({
      ".gitignore": ".musubix4/\nbundle/*.bin\n",
      "bundle/tracked.txt": "tracked\n",
      "bundle/ignored.bin": "explicit-extra\n",
      "package-lock.json": "{}\n",
      "yarn.lock": "lock\n",
    });
    spawnSync("git", ["init", "-q"], { cwd: root });
    spawnSync("git", ["config", "user.email", "test@example.com"], {
      cwd: root,
    });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: root });
    spawnSync(
      "git",
      [
        "add",
        ".gitignore",
        "bundle/tracked.txt",
        "package-lock.json",
        "yarn.lock",
      ],
      { cwd: root },
    );
    spawnSync("git", ["commit", "-qm", "base"], { cwd: root });
    const git = new GitCandidateStore(root, "snapshot-cleanup", ["bundle"]);
    await git.initialize();
    await expect(git.snapshotStage("multiple-lockfiles")).rejects.toThrow(
      "Multiple candidate lockfiles",
    );
    expect(
      spawnSync(
        "git",
        [
          "rev-parse",
          "--verify",
          "refs/musubix4/runs/snapshot-cleanup/stages/multiple-lockfiles",
        ],
        { cwd: root },
      ).status,
    ).not.toBe(0);

    const selected = new GitCandidateStore(
      root,
      "ignored-extra",
      ["bundle"],
      {
        lockfilePath: "package-lock.json",
        command: ["npm", "ci"],
        writablePaths: ["node_modules"],
      },
    );
    await selected.initialize();
    const candidate = await selected.snapshotStage("selected");
    expect(
      spawnSync("git", ["show", `${candidate.ref}:bundle/ignored.bin`], {
        cwd: root,
        encoding: "utf8",
      }).stdout,
    ).toBe("explicit-extra\n");
  });

  /** @id TEST-AUTONOMOUS-CANDIDATE-BASELINE-005
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-014 REQ-AUTONOMOUS-DEVELOPMENT-018
   */
  it("TEST-AUTONOMOUS-CANDIDATE-BASELINE-005 preserves a terminal transition that wins the race before lease-protected baseline validation", async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: "prompt", text: "Preserve terminal outcome" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
    });
    vi.spyOn(store, "acquire").mockImplementation(async (runId) => {
      const failed = await store.transition(
        runId,
        "failed",
        "concurrent-terminal",
      );
      failed.terminalReason = "concurrent-terminal";
      await store.save(failed);
      return { runId, nonce: "test-lease", path: "unused" };
    });
    vi.spyOn(store, "release").mockResolvedValue();
    const initialize = vi.fn().mockRejectedValue(
      new CandidateBaselineError(
        "CANDIDATE_BASELINE_MISSING",
        "terminal runs must not initialize",
      ),
    );
    const services: HohServices = {
      roles: {
        planner: vi.fn(),
        developer: vi.fn(),
        qa: vi.fn(),
      },
      project: {
        preflight: vi.fn(),
        candidateChecks: vi.fn(),
      },
      git: {
        initialize,
        snapshot: vi.fn(),
        treeDigest: vi.fn(),
        rollback: vi.fn(),
      },
    };

    expect(
      await new HohOrchestrator(store, services).resume(created.id),
    ).toMatchObject({
      state: "failed",
      terminalReason: "concurrent-terminal",
    });
    expect(initialize).not.toHaveBeenCalled();
  });

  /** @id TEST-AUTONOMOUS-CANDIDATE-BASELINE-006
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-014 REQ-AUTONOMOUS-DEVELOPMENT-018
   */
  it("TEST-AUTONOMOUS-CANDIDATE-BASELINE-006 restores rejected candidate worktree changes before blocker retry and preserves initialization dirt", async () => {
    const root = await fixture({
      ".gitignore": ".musubix4/\n",
      ".musubix/compatibility/command-collisions.json":
        '{"schemaVersion":1,"entries":[]}\n',
      "baseline-specs/legacy.md": "approved\n",
      "clean.txt": "clean-base\n",
      "dirty.txt": "dirty-base\n",
      "protected.txt": "protected-base\n",
    });
    spawnSync("git", ["init", "-q"], { cwd: root });
    spawnSync("git", ["config", "user.email", "test@example.com"], {
      cwd: root,
    });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: root });
    spawnSync("git", ["add", "."], { cwd: root });
    spawnSync("git", ["commit", "-qm", "base"], { cwd: root });

    await writeFile(resolve(root, "dirty.txt"), "dirty-index\n");
    spawnSync("git", ["add", "dirty.txt"], { cwd: root });
    await writeFile(resolve(root, "dirty.txt"), "dirty-worktree\n");
    const initialDirtyIndexEntry = spawnSync(
      "git",
      ["ls-files", "--stage", "-z", "--", "dirty.txt"],
      { cwd: root, encoding: "utf8" },
    ).stdout;

    const protectedSet = await computeProtectedSet(root, ["protected.txt"]);
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: "prompt", text: "Recover rejected candidate retries" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
      requirements: ["REQ-AUTONOMOUS-DEVELOPMENT-007"],
      protectedSet,
    });
    const git = new GitCandidateStore(root, created.id, []);
    await git.initialize();
    const planned = await store.transition(
      created.id,
      "planned",
      "planner-completed",
    );
    planned.iteration = 1;
    planned.candidateBaselineInitialized = true;
    await store.save(planned);

    let developerAttempt = 0;
    let candidateChecksAttempt = 0;
    const services: HohServices = {
      roles: {
        planner: vi.fn(),
        developer: vi.fn().mockImplementation(async () => {
          developerAttempt += 1;
          await writeFile(
            resolve(root, "clean.txt"),
            developerAttempt === 1 ? "candidate-clean\n" : "retry-clean\n",
          );
          if (developerAttempt === 1) {
            await writeFile(
              resolve(root, "protected.txt"),
              "candidate-protected\n",
            );
          }
          return { executionRecords: [{ attempt: developerAttempt }] };
        }),
        qa: vi.fn(),
      },
      project: {
        preflight: vi.fn(),
        candidateChecks: vi.fn().mockImplementation(async () => {
          candidateChecksAttempt += 1;
          return candidateChecksAttempt > 1;
        }),
      },
      git: {
        initialize: vi.fn().mockImplementation(async ({ allowCreate }) => {
          await git.initialize({ allowCreate });
        }),
        verifyIsolation: vi.fn().mockImplementation(async () => {
          await git.verifyInitializationBaseline();
        }),
        snapshot: vi.fn().mockImplementation(async ({ run }) => {
          return git.snapshotStage(`developer-${run.iteration}`);
        }),
        treeDigest: vi.fn(),
        rollback: vi.fn().mockImplementation(async ({ target }) => {
          return git.rollback(target);
        }),
      },
    };

    const retried = await new HohOrchestrator(store, services).resume(
      created.id,
    );
    expect(retried).toMatchObject({
      state: "planned",
      role: "developer",
      blockerRepairAttempts: 1,
    });
    expect(await readFile(resolve(root, "clean.txt"), "utf8")).toBe(
      "clean-base\n",
    );
    expect(await readFile(resolve(root, "protected.txt"), "utf8")).toBe(
      "protected-base\n",
    );
    expect(await readFile(resolve(root, "dirty.txt"), "utf8")).toBe(
      "dirty-worktree\n",
    );
    expect(
      spawnSync("git", ["ls-files", "--stage", "-z", "--", "dirty.txt"], {
        cwd: root,
        encoding: "utf8",
      }).stdout,
    ).toBe(initialDirtyIndexEntry);
    expect(
      spawnSync("git", ["status", "--porcelain=v1", "--", "clean.txt"], {
        cwd: root,
        encoding: "utf8",
      }).stdout,
    ).toBe("");
    expect(
      spawnSync("git", ["status", "--porcelain=v1", "--", "protected.txt"], {
        cwd: root,
        encoding: "utf8",
      }).stdout,
    ).toBe("");
    expect(
      spawnSync("git", ["status", "--porcelain=v1", "--", "dirty.txt"], {
        cwd: root,
        encoding: "utf8",
      }).stdout,
    ).toBe("MM dirty.txt\n");
    expect(
      spawnSync(
        "git",
        [
          "rev-parse",
          "--verify",
          `refs/musubix4/runs/${created.id}/stages/developer-1`,
        ],
        { cwd: root },
      ).status,
    ).toBe(0);

    const resumed = await new HohOrchestrator(store, services).resume(
      created.id,
    );
    expect(resumed.state).toBe("candidate");
    expect(services.roles.developer).toHaveBeenCalledTimes(2);
    expect(resumed.candidate?.ref).toBe(
      `refs/musubix4/runs/${created.id}/stages/developer-1`,
    );
  });
});
