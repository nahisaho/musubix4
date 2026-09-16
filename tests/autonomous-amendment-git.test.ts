import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GitCandidateStore,
  type CandidateSnapshot,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

type AmendmentGitStore = GitCandidateStore & {
  createInventoryAmendmentCommit(
    original: CandidateSnapshot,
    approvedInventory: Buffer,
  ): Promise<CandidateSnapshot & {
    original: CandidateSnapshot;
    inventorySha256: string;
  }>;
  promoteCandidate(
    provisional: CandidateSnapshot & { inventorySha256: string },
    approvedInventory: Buffer,
  ): Promise<CandidateSnapshot>;
};

describe("provisional inventory commits", () => {
  /** @id TEST-AUTONOMOUS-AMENDMENT-GIT-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-018
   */
  it("TEST-AUTONOMOUS-AMENDMENT-GIT-001 promotes only the approved inventory bytes", async () => {
    const root = await fixture({
      "src/app.ts": "export const value = 1;\n",
      ".musubix/compatibility/command-collisions.json":
        '{"schemaVersion":1,"entries":[]}',
    });
    spawnSync("git", ["init", "-q"], { cwd: root });
    spawnSync("git", ["config", "user.email", "test@example.com"], {
      cwd: root,
    });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: root });
    spawnSync("git", ["add", "."], { cwd: root });
    spawnSync("git", ["commit", "-qm", "base"], { cwd: root });
    await writeFile(resolve(root, "src/app.ts"), "export const value = 2;\n");

    const store = new GitCandidateStore(root, "amendment", [
      ".musubix/compatibility/command-collisions.json",
    ]) as AmendmentGitStore;
    await store.initialize();
    const original = await store.snapshotStage("developer");
    const approved = Buffer.from(
      '{"schemaVersion":1,"entries":[{"path":"musubix4 run","classification":"musubix4-only","invocation":["run","--help"]}]}',
    );
    const provisional = await store.createInventoryAmendmentCommit(
      original,
      approved,
    );
    const changed = spawnSync(
      "git",
      ["diff", "--name-only", original.ref, provisional.ref],
      { cwd: root, encoding: "utf8" },
    ).stdout.trim();
    expect(changed).toBe(
      ".musubix/compatibility/command-collisions.json",
    );

    const promoted = await store.promoteCandidate(provisional, approved);
    expect(promoted.ref).toBe(
      "refs/musubix4/runs/amendment/candidate",
    );
    expect(
      await readFile(
        resolve(
          root,
          ".musubix4/runs/amendment/workspace/.musubix/compatibility/command-collisions.json",
        ),
        "utf8",
      ),
    ).toBe(approved.toString("utf8"));
    expect(
      spawnSync(
        "git",
        [
          "show",
          `${promoted.ref}:.musubix/compatibility/command-collisions.json`,
        ],
        { cwd: root, encoding: "utf8" },
      ).stdout,
    ).toBe(approved.toString("utf8"));
    expect(
      spawnSync("git", ["show", `${original.ref}:src/app.ts`], {
        cwd: root,
        encoding: "utf8",
      }).stdout,
    ).toBe("export const value = 2;\n");
  });
});
