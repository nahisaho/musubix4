import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { GitCandidateStore } from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

function git(root: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

/** @id TEST-AUTONOMOUS-REJECTED-REF-002
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-018
 */
describe("rejected candidate ref cleanup", () => {
  it("TEST-AUTONOMOUS-REJECTED-REF-002 retains the immutable ordinal ref and removes only its provisional stage ref", async () => {
    const root = await fixture({
      ".gitignore": ".musubix4/\n",
      "tracked.txt": "base\n",
    });
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "base"]);
    const store = new GitCandidateStore(root, "rejected-cleanup");
    await store.initialize();
    await writeFile(resolve(root, "tracked.txt"), "candidate\n");
    const candidate = await store.snapshotStage("developer-1");
    const oid = git(root, ["rev-parse", `${candidate.ref}^{commit}`]);
    const rejected = await store.retainRejectedCandidate(candidate, 1, oid);
    expect(git(root, ["rev-parse", `${rejected.ref}^{commit}`])).toBe(oid);
    expect(
      spawnSync("git", ["rev-parse", "--verify", candidate.ref], {
        cwd: root,
      }).status,
    ).not.toBe(0);
    await store.reconcileWorkspaces();
    expect(git(root, ["rev-parse", `${rejected.ref}^{commit}`])).toBe(oid);
  });
});
