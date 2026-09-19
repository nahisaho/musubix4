import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CandidateBaselineError,
  FileRunStore,
  GitCandidateStore,
  parseHohConfig,
  summarizeHohRun,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

function git(root: string, args: string[], input?: string): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", input });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function repository(): Promise<string> {
  const root = await fixture({ "conflict.txt": "base\n" });
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "base"]);
  return root;
}

/** @id TEST-AUTONOMOUS-CANDIDATE-BASELINE-009
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-014
 */
describe("CHANGE-0015 release hardening", () => {
  it("TEST-AUTONOMOUS-CANDIDATE-BASELINE-009 rejects unresolved index stages before baseline persistence", async () => {
    const root = await repository();
    const base = git(root, ["rev-parse", "HEAD:conflict.txt"]);
    const ours = git(root, ["hash-object", "-w", "--stdin"], "ours\n");
    const theirs = git(root, ["hash-object", "-w", "--stdin"], "theirs\n");
    git(
      root,
      ["update-index", "--index-info"],
      [
        `100644 ${base} 1\tconflict.txt`,
        `100644 ${ours} 2\tconflict.txt`,
        `100644 ${theirs} 3\tconflict.txt`,
        "",
      ].join("\n"),
    );
    await writeFile(resolve(root, "conflict.txt"), "unresolved\n");
    await expect(
      new GitCandidateStore(root, "conflicted-index").initialize(),
    ).rejects.toMatchObject({
      code: "CANDIDATE_BASELINE_UNSUPPORTED_TYPE",
    } satisfies Partial<CandidateBaselineError>);
    await expect(
      import("node:fs/promises").then(({ readFile }) =>
        readFile(
          resolve(
            root,
            ".musubix4/runs/conflicted-index/candidate-baseline.json",
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  /** @id TEST-AUTONOMOUS-CANDIDATE-RECOVERY-003
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-018
   */
  it("TEST-AUTONOMOUS-CANDIDATE-RECOVERY-003 exposes the literal recovery target in HoH status summaries only when present", async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const run = await store.create({
      source: { kind: "prompt", text: "status target" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
    });
    expect(summarizeHohRun(run)).not.toHaveProperty(
      "candidateIsolationRestoreTarget",
    );
    run.candidateIsolationRestoreTarget =
      "refs/musubix4/runs/test/preservation";
    expect(summarizeHohRun(run)).toMatchObject({
      candidateIsolationRestoreTarget: "refs/musubix4/runs/test/preservation",
    });
  });
});
