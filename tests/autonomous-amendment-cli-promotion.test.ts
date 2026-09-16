import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { createProgram } from "../packages/cli/src/main.js";
import {
  computeProtectedSet,
  FileRunStore,
  GitCandidateStore,
  parseHohConfig,
  recordRunApproval,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

describe("approved amendment CLI promotion", () => {
  /** @id TEST-AUTONOMOUS-AMENDMENT-CLI-PROMOTION-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-016
   */
  it("TEST-AUTONOMOUS-AMENDMENT-CLI-PROMOTION-001 promotes on the approved command replay", async () => {
    const replacement =
      '{"schemaVersion":1,"entries":[{"path":"musubix4 run","classification":"musubix4-only","invocation":["run","--help"]}]}';
    const root = await fixture({
      "baseline-specs/legacy.md": "approved\n",
      "tests/fixtures/musubix3-cli-surface.json":
        '{"schemaVersion":1,"path":"musubix3","options":[],"commands":[]}',
      "packages/cli/src/main.ts": `
        import { Command } from "commander";
        export function createProgram() {
          return new Command().name("musubix4").command("run");
        }
      `,
      ".musubix/compatibility/command-collisions.json":
        '{"schemaVersion":1,"entries":[]}',
      "replacement.json": replacement,
    });
    spawnSync("git", ["init", "-q"], { cwd: root });
    spawnSync("git", ["config", "user.email", "test@example.com"], {
      cwd: root,
    });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: root });
    spawnSync("git", ["add", "."], { cwd: root });
    spawnSync("git", ["commit", "-qm", "base"], { cwd: root });
    const store = new FileRunStore(root);
    const run = await store.create({
      source: { kind: "prompt", text: "Build safely" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
        candidateExtraPaths: [
          ".musubix/compatibility/command-collisions.json",
        ],
      }),
      protectedSet: await computeProtectedSet(root, []),
    });
    const git = new GitCandidateStore(root, run.id, run.config.candidateExtraPaths);
    await git.initialize();
    const candidate = await git.snapshotStage("developer");
    await store.enterAmendmentRequired(run.id, {
      candidate,
      offendingPaths: ["musubix4 run"],
    });
    const paused = await store.prepareCollisionInventoryAmendment(
      run.id,
      "replacement.json",
    );
    await recordRunApproval(store, {
      runId: run.id,
      stage: "requirements",
      nonce: paused.approval!.nonce,
      manifestDigest: paused.approval!.manifestDigest,
      approver: "reviewer",
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await createProgram().parseAsync([
        "node",
        "musubix4",
        "protected-set",
        "amend",
        run.id,
        "--collision-inventory",
        "replacement.json",
        "--root",
        root,
        "--json",
      ]);
    } finally {
      log.mockRestore();
    }

    expect(await store.status(run.id)).toMatchObject({
      state: "candidate",
      requiredOperatorAction: "none",
      collisionInventoryOverridePath: expect.any(String),
    });
  });
});
