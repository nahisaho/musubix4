import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  FileRunStore,
  parseHohConfig,
  pauseForApproval,
  recordRunApproval,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

/** @id TEST-AUTONOMOUS-AUTO-APPROVAL-AUTHORITY-PERSISTENCE-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe("verified automatic approval authority persistence", () => {
  it("TEST-AUTONOMOUS-AUTO-APPROVAL-AUTHORITY-PERSISTENCE-001 rejects manual approval after the configuration file is removed", async () => {
    const root = await fixture({
      ".musubix/hoh.json": '{"schemaVersion":1}\n',
    });
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: "prompt", text: "Build safely" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
      requirements: ["REQ-AUTONOMOUS-DEVELOPMENT-016"],
    });
    const paused = await pauseForApproval(
      store,
      created.id,
      "release",
      "a".repeat(64),
    );
    await rm(`${root}/.musubix/hoh.json`);

    await expect(
      recordRunApproval(store, {
        runId: paused.id,
        stage: "release",
        nonce: paused.approval!.nonce,
        manifestDigest: paused.approval!.manifestDigest,
        approver: "human",
      }),
    ).rejects.toThrow(
      "Manual approval cannot authorize a verified automatic approval boundary.",
    );
  });
});
