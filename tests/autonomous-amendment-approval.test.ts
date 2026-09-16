import { describe, expect, it } from "vitest";
import {
  FileRunStore,
  parseHohConfig,
  recordRunApproval,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

describe("amendment requirements approval", () => {
  /** @id TEST-AUTONOMOUS-AMENDMENT-APPROVAL-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-016
   */
  it("TEST-AUTONOMOUS-AMENDMENT-APPROVAL-001 returns to the same amendment episode after approval", async () => {
    const root = await fixture({
      "replacement.json": '{"schemaVersion":1,"entries":[]}',
    });
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: "prompt", text: "Build safely" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
    });
    await store.enterAmendmentRequired(created.id, {
      candidate: {
        ref: "refs/musubix4/runs/test/stages/candidate",
        treeDigest: "a".repeat(40),
      },
      offendingPaths: ["musubix4 protected-set"],
    });
    const paused = await store.prepareCollisionInventoryAmendment(
      created.id,
      "replacement.json",
    );
    expect(paused.approval).toMatchObject({
      stage: "requirements",
      nonce: paused.amendmentManifest?.nonce,
    });

    await recordRunApproval(store, {
      runId: created.id,
      stage: "requirements",
      nonce: paused.approval!.nonce,
      manifestDigest: paused.approval!.manifestDigest,
      approver: "reviewer",
    });
    expect(await store.status(created.id)).toMatchObject({
      state: "amendment-required",
      amendmentEpisodeCount: 1,
      amendmentFailureCount: 0,
      requiredOperatorAction: "amend-collision-inventory",
      approval: {
        stage: "requirements",
        decision: "approved",
      },
    });
  });
});
