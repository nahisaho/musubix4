import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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

/** @id TEST-AUTONOMOUS-CANDIDATE-ISOLATION-002
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-014 REQ-AUTONOMOUS-DEVELOPMENT-018
 */
describe("candidate isolation against the recorded initialization HEAD", () => {
  it("TEST-AUTONOMOUS-CANDIDATE-ISOLATION-002 keeps initialization-dirty A pinned to the recorded HEAD while allowing clean-at-initialize B to carry its current run-produced content", async () => {
    const root = await fixture({
      "a.txt": "base-a\n",
      "b.txt": "base-b\n",
    });
    spawnSync("git", ["init", "-q"], { cwd: root });
    spawnSync("git", ["config", "user.email", "test@example.com"], {
      cwd: root,
    });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: root });
    spawnSync("git", ["add", "a.txt"], { cwd: root });
    spawnSync("git", ["commit", "-qm", "base-a"], { cwd: root });
    spawnSync("git", ["add", "b.txt"], { cwd: root });
    spawnSync("git", ["commit", "-qm", "base-b"], { cwd: root });

    const indexPath = resolve(root, ".git/index");
    await writeFile(resolve(root, "a.txt"), "dirty-before-initialize\n");
    const indexBeforeInitialize = await readFile(indexPath);
    const store = new GitCandidateStore(root, "candidate-isolation-recorded-head", []);
    const initialized = await store.initialize();
    expect((await readFile(indexPath)).equals(indexBeforeInitialize)).toBe(true);
    const baseline = JSON.parse(
      await readFile(
        resolve(
          root,
          ".musubix4/runs/candidate-isolation-recorded-head/candidate-baseline.json",
        ),
        "utf8",
      ),
    ) as {
      schemaVersion: 2;
      runBaseCommit: string;
      statusDigest: string;
      dirtyPathStates: Array<{
        path: string;
        content: string;
        contentBase64?: string;
        stagedContentBase64?: string;
        mode: string;
        existence: "present" | "absent";
        indexEntry: string;
        stagedIdentity: string;
        unstagedIdentity: string;
      }>;
    };
    expect(baseline.runBaseCommit).toBe(initialized.baseCommit);
    expect(baseline.dirtyPathStates).toEqual([
      {
        path: "a.txt",
        content: createHash("sha256")
          .update("dirty-before-initialize\n")
          .digest("hex"),
        contentBase64: Buffer.from("dirty-before-initialize\n").toString(
          "base64",
        ),
        mode: "100644",
        existence: "present",
        indexEntry: spawnSync(
          "git",
          ["ls-files", "--stage", "-z", "--", "a.txt"],
          {
            cwd: root,
            encoding: "utf8",
          },
        ).stdout,
        stagedIdentity: "",
        unstagedIdentity: "modified",
      },
    ]);
    expect(baseline.statusDigest).toBe(
      createHash("sha256")
        .update(
          JSON.stringify({
            schemaVersion: 2,
            runBaseCommit: baseline.runBaseCommit,
            dirtyPathStates: baseline.dirtyPathStates,
          }),
        )
        .digest("hex"),
    );
    const baselinePath = resolve(
      root,
      ".musubix4/runs/candidate-isolation-recorded-head/candidate-baseline.json",
    );
    const baselineBytes = await readFile(baselinePath);
    spawnSync(
      "git",
      [
        "update-ref",
        "-d",
        "refs/musubix4/runs/candidate-isolation-recorded-head/base",
      ],
      { cwd: root },
    );
    const reassertedStore = new GitCandidateStore(
      root,
      "candidate-isolation-recorded-head",
      [],
    );
    expect((await reassertedStore.initialize()).baseCommit).toBe(
      initialized.baseCommit,
    );
    expect(await readFile(baselinePath)).toEqual(baselineBytes);
    expect(
      spawnSync(
        "git",
        [
          "rev-parse",
          "--verify",
          "refs/musubix4/runs/candidate-isolation-recorded-head/base",
        ],
        { cwd: root, encoding: "utf8" },
      ).stdout.trim(),
    ).toBe(initialized.baseCommit);

    await writeFile(resolve(root, "b.txt"), "run-produced-change\n");
    const resumedStore = new GitCandidateStore(
      root,
      "candidate-isolation-recorded-head",
      [],
    );
    const beforeSnapshotStatus = spawnSync(
      "git",
      ["status", "--porcelain=v1"],
      {
        cwd: root,
        encoding: "utf8",
      },
    ).stdout;
    const indexBeforeSnapshot = await readFile(indexPath);
    const candidate = await resumedStore.snapshotStage("developer");
    expect((await readFile(indexPath)).equals(indexBeforeSnapshot)).toBe(true);
    expect(
      spawnSync("git", ["show", `${candidate.ref}:a.txt`], {
        cwd: root,
        encoding: "utf8",
      }).stdout,
    ).toBe(
      spawnSync("git", ["show", `${initialized.baseRef}:a.txt`], {
        cwd: root,
        encoding: "utf8",
      }).stdout,
    );
    expect(
      spawnSync("git", ["show", `${candidate.ref}:b.txt`], {
        cwd: root,
        encoding: "utf8",
      }).stdout,
    ).toBe("run-produced-change\n");
    expect(
      spawnSync("git", ["status", "--porcelain=v1"], {
        cwd: root,
        encoding: "utf8",
      }).stdout,
    ).toBe(beforeSnapshotStatus);

    await writeFile(resolve(root, "a.txt"), "dirty-after-initialize\n");
    const beforeFailureStatus = spawnSync("git", ["status", "--porcelain=v1"], {
      cwd: root,
      encoding: "utf8",
    }).stdout;
    const indexBeforeFailure = await readFile(indexPath);
    const rejection = resumedStore.snapshotStage("developer-fail-closed");
    await expect(rejection).rejects.toThrow(CandidateIsolationError);
    await expect(rejection).rejects.toMatchObject({
      code: "CANDIDATE_ISOLATION_CONFLICT",
      path: "a.txt",
      guidance:
        "Commit, stash, or revert the pre-existing tracked change before creating a candidate snapshot.",
    });
    expect(
      spawnSync(
        "git",
        [
          "rev-parse",
          "--verify",
          "refs/musubix4/runs/candidate-isolation-recorded-head/stages/developer-fail-closed",
        ],
        { cwd: root, encoding: "utf8" },
      ).status,
    ).not.toBe(0);
    expect(
      spawnSync("git", ["status", "--porcelain=v1"], {
        cwd: root,
        encoding: "utf8",
      }).stdout,
    ).toBe(beforeFailureStatus);
    expect((await readFile(indexPath)).equals(indexBeforeFailure)).toBe(true);

    await writeFile(
      baselinePath,
      `${JSON.stringify({ ...baseline, statusDigest: "0".repeat(64) })}\n`,
    );
    await expect(
      new GitCandidateStore(
        root,
        "candidate-isolation-recorded-head",
        [],
      ).initialize(),
    ).rejects.toMatchObject({
      code: "CANDIDATE_BASELINE_DIGEST_MISMATCH",
    } satisfies Partial<CandidateBaselineError>);

    const fsmRoot = await fixture();
    const runStore = new FileRunStore(fsmRoot);
    const created = await runStore.create({
      source: { kind: "prompt", text: "Preserve user changes" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
      requirements: ["REQ-AUTONOMOUS-DEVELOPMENT-007"],
    });
    const planned = await runStore.transition(
      created.id,
      "planned",
      "planner-completed",
    );
    planned.iteration = 1;
    planned.stagnantIterations = 2;
    planned.blockerRepairAttempts = 1;
    await runStore.save(planned);
    const services: HohServices = {
      roles: {
        planner: vi.fn(),
        developer: vi.fn().mockResolvedValue({
          executionRecords: [{ command: "test", exitCode: 0 }],
        }),
        qa: vi.fn(),
      },
      project: {
        preflight: vi.fn(),
        candidateChecks: vi.fn(),
      },
      git: {
        snapshot: vi.fn().mockRejectedValue(
          new CandidateIsolationError(
            "CANDIDATE_ISOLATION_CONFLICT",
            "a.txt changed after initialization",
            "a.txt",
            "Restore a.txt to its initialization fingerprint or start a new run.",
          ),
        ),
        treeDigest: vi.fn(),
        rollback: vi.fn(),
      },
    };
    expect(
      await new HohOrchestrator(runStore, services).resume(created.id),
    ).toMatchObject({
      state: "candidate-isolation-required",
      iteration: 1,
      stagnantIterations: 2,
      blockerRepairAttempts: 1,
      requiredOperatorAction:
        "restore-candidate-isolation-paths-or-start-new-run",
      offendingCandidateIsolationPaths: ["a.txt"],
      terminalReason: undefined,
    });
    expect(services.project.candidateChecks).not.toHaveBeenCalled();
  });
});
