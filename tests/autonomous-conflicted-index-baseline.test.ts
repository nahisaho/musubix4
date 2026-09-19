import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CandidateBaselineError,
  GitCandidateStore,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

function git(root: string, args: string[], input?: string): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", input });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

/** @id TEST-AUTONOMOUS-CANDIDATE-BASELINE-010
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-014
 */
describe("conflicted index baseline", () => {
  it("TEST-AUTONOMOUS-CANDIDATE-BASELINE-010 rejects unmerged stages even when status normalization would classify the path as clean", async () => {
    const root = await fixture({ "conflict.txt": "base\n" });
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "base"]);
    const base = git(root, ["rev-parse", "HEAD:conflict.txt"]);
    const theirs = git(root, ["hash-object", "-w", "--stdin"], "theirs\n");
    git(
      root,
      ["update-index", "--index-info"],
      [
        `100644 ${base} 1\tconflict.txt`,
        `100644 ${base} 2\tconflict.txt`,
        `100644 ${theirs} 3\tconflict.txt`,
        "",
      ].join("\n"),
    );
    await writeFile(resolve(root, "conflict.txt"), "base\n");
    await expect(
      new GitCandidateStore(root, "normalized-conflict").initialize(),
    ).rejects.toMatchObject({
      code: "CANDIDATE_BASELINE_UNSUPPORTED_TYPE",
    } satisfies Partial<CandidateBaselineError>);
  });
});
