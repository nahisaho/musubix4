import { describe, expect, it } from "vitest";
import {
  FileRunStore,
  parseHohConfig,
  type CandidateSnapshot,
  type RunRecord,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

type AmendmentStore = FileRunStore & {
  enterAmendmentRequired(
    runId: string,
    input: { candidate: CandidateSnapshot; offendingPaths: string[] },
  ): Promise<RunRecord>;
  recordAmendmentFailure(runId: string, code: string): Promise<RunRecord>;
  completeAmendment(runId: string, candidate: CandidateSnapshot): Promise<RunRecord>;
};

describe("protected-set amendment state", () => {
  /** @id TEST-AUTONOMOUS-AMENDMENT-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-013
   */
  it("TEST-AUTONOMOUS-AMENDMENT-001 persists exact amendment episode and retry boundaries", async () => {
    const root = await fixture();
    const store = new FileRunStore(root) as AmendmentStore;
    const config = parseHohConfig({
      model: "gpt-5.4",
      budget: { aiCredits: 10 },
      commands: { test: ["npm", "test"] },
    });
    expect(config.limits).toMatchObject({
      amendmentRetryLimit: 2,
      maxAmendmentEpisodes: 3,
    });
    const candidate = {
      ref: "refs/musubix4/runs/test/stages/candidate",
      treeDigest: "a".repeat(40),
    };
    const run = await store.create({
      source: { kind: "prompt", text: "Build safely" },
      config,
    });

    const paused = await store.enterAmendmentRequired(run.id, {
      candidate,
      offendingPaths: ["musubix4 run"],
    });
    expect(paused).toMatchObject({
      state: "amendment-required",
      amendmentEpisodeCount: 1,
      amendmentFailureCount: 0,
      requiredOperatorAction: "amend-collision-inventory",
      offendingInventoryPaths: ["musubix4 run"],
      iteration: 0,
    });

    expect(
      await store.recordAmendmentFailure(run.id, "APPROVED_DIGEST_MISMATCH"),
    ).toMatchObject({
      state: "amendment-required",
      amendmentFailureCount: 1,
    });
    expect(
      await store.recordAmendmentFailure(run.id, "STATIC_VALIDATION_FAILED"),
    ).toMatchObject({
      state: "amendment-required",
      amendmentFailureCount: 2,
    });
    expect(
      await store.recordAmendmentFailure(run.id, "STATIC_VALIDATION_FAILED"),
    ).toMatchObject({
      state: "failed",
      amendmentFailureCount: 3,
      terminalReason: "amendment-retries-exhausted",
    });

    const second = await store.create({
      source: { kind: "prompt", text: "Build safely" },
      config,
    });
    for (let episode = 1; episode <= 3; episode += 1) {
      const current = await store.enterAmendmentRequired(second.id, {
        candidate,
        offendingPaths: [`musubix4 command-${episode}`],
      });
      expect(current.amendmentEpisodeCount).toBe(episode);
      await store.completeAmendment(second.id, candidate);
    }
    expect(
      await store.enterAmendmentRequired(second.id, {
        candidate,
        offendingPaths: ["musubix4 command-4"],
      }),
    ).toMatchObject({
      state: "failed",
      amendmentEpisodeCount: 4,
      terminalReason: "amendment-episode-limit",
    });
  });
});
