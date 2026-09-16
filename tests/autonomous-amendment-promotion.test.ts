import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyApprovedCollisionInventoryAmendment,
  computeProtectedSet,
  FileRunStore,
  GitCandidateStore,
  parseHohConfig,
  recordRunApproval,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

describe("approved amendment promotion", () => {
  /** @id TEST-AUTONOMOUS-AMENDMENT-PROMOTION-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-016
   */
  it("TEST-AUTONOMOUS-AMENDMENT-PROMOTION-001 atomically promotes and re-pins approved inventory", async () => {
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
    const git = new GitCandidateStore(root, "promotion", [
      ".musubix/compatibility/command-collisions.json",
    ]);
    await git.initialize();
    const candidate = await git.snapshotStage("developer");
    const protectedSet = await computeProtectedSet(root, []);
    const store = new FileRunStore(root);
    const run = await store.create({
      source: { kind: "prompt", text: "Build safely" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
      protectedSet,
    });
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

    const promoted = await applyApprovedCollisionInventoryAmendment(
      store,
      git,
      run.id,
      {
        entryPath: "packages/cli/src/main.ts",
        upstreamSurfacePath: "tests/fixtures/musubix3-cli-surface.json",
      },
    );
    expect(promoted).toMatchObject({
      state: "candidate",
      requiredOperatorAction: "none",
      amendmentFailureCount: 0,
    });
    expect(promoted.protectedSetDigest).not.toBe(protectedSet.digest);
    const override = await readFile(
      resolve(root, promoted.collisionInventoryOverridePath!),
    );
    expect(override.toString("utf8")).toBe(replacement);
    expect(
      (
        await computeProtectedSet(root, promoted.protectedSetPaths ?? [], {
          ".musubix/compatibility/command-collisions.json": override,
        })
      ).digest,
    ).toBe(promoted.protectedSetDigest);
  });
});
