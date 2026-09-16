import { describe, expect, it } from "vitest";
import {
  FileRunStore,
  parseHohConfig,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

describe("durable role limits", () => {
  /** @id TEST-AUTONOMOUS-DURABILITY-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-004 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-014
   */
  it("TEST-AUTONOMOUS-DURABILITY-001 reserves before role execution and charges actual overruns in full", async () => {
    const root = await fixture();
    const config = parseHohConfig({
      model: "gpt-5.4",
      budget: { aiCredits: 5 },
      commands: { test: ["npm", "test"] },
    });
    expect(config).toMatchObject({
      roleInvocationReservedCredits: 1,
      roleInvocationTimeoutMs: 120000,
    });
    const store = new FileRunStore(root);
    const run = await store.create({
      source: { kind: "prompt", text: "Build safely" },
      config,
    });

    const reservation = await store.reserveAttemptBudget(
      run.id,
      "developer",
      config.roleInvocationReservedCredits,
    );
    expect(await store.status(run.id)).toMatchObject({
      usage: { aiCredits: 0, reserved: 1 },
    });

    await store.settleAttemptBudget(run.id, reservation, 3);
    const settled = await store.status(run.id);
    expect(settled.usage).toEqual({ aiCredits: 3, reserved: 0 });
    expect(settled.attempts?.at(-1)).toMatchObject({
      id: reservation,
      ceiling: 1,
      actual: 3,
      status: "settled",
      overrun: 2,
      diagnosticCode: "ROLE_CREDIT_RESERVATION_OVERRUN",
    });

    const abandoned = await store.reserveAttemptBudget(
      run.id,
      "qa",
      config.roleInvocationReservedCredits,
    );
    await store.abandonAttemptBudget(run.id, abandoned);
    expect((await store.status(run.id)).usage).toEqual({
      aiCredits: 4,
      reserved: 0,
    });
  });
});
