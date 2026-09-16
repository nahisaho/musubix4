import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createProgram } from "../packages/cli/src/main.js";
import {
  FileRunStore,
  parseHohConfig,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

describe("protected-set amendment CLI", () => {
  /** @id TEST-AUTONOMOUS-AMENDMENT-CLI-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-016
   */
  it("TEST-AUTONOMOUS-AMENDMENT-CLI-001 prepares a digest-pinned requirements approval boundary", async () => {
    const inventory = '{"schemaVersion":1,"entries":[]}';
    const root = await fixture({
      "replacement-collisions.json": inventory,
    });
    const store = new FileRunStore(root);
    const run = await store.create({
      source: { kind: "prompt", text: "Build safely" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
    });
    await store.enterAmendmentRequired(run.id, {
      candidate: {
        ref: "refs/musubix4/runs/test/stages/candidate",
        treeDigest: "a".repeat(40),
      },
      offendingPaths: ["musubix4 protected-set"],
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
        "replacement-collisions.json",
        "--root",
        root,
        "--json",
      ]);
    } finally {
      log.mockRestore();
    }

    expect(await store.status(run.id)).toMatchObject({
      state: "approval-paused",
      requiredOperatorAction: "approve-requirements",
      amendmentManifest: {
        path: "replacement-collisions.json",
        sha256: createHash("sha256").update(inventory).digest("hex"),
      },
    });
    const protectedSet = createProgram().commands.find(
      (command) => command.name() === "protected-set",
    );
    const amend = protectedSet?.commands.find(
      (command) => command.name() === "amend",
    );
    expect(amend?.options.map((option) => option.long)).toContain(
      "--collision-inventory",
    );
  });
});
