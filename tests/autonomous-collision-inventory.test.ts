import { describe, expect, it } from "vitest";
import * as hoh from "../packages/analysis/src/hoh.js";

describe("collision inventory", () => {
  /** @id TEST-AUTONOMOUS-INVENTORY-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-013
   */
  it("TEST-AUTONOMOUS-INVENTORY-001 requires one valid resolution for every candidate top-level command", () => {
    const validateStaticCommandInventory = (
      hoh as typeof hoh & {
        validateStaticCommandInventory?: (
          upstream: {
            commands: Array<{ path: string; options: string[] }>;
          },
          candidate: {
            commands: Array<{ path: string; options: string[] }>;
          },
          inventory: unknown,
        ) => {
          valid: true;
          pinnedInvocations: Array<{
            path: string;
            classification: string;
            argv: string[];
          }>;
          digest: string;
        };
      }
    ).validateStaticCommandInventory;
    const upstream = {
      commands: [
        { path: "musubix3", options: [] },
        { path: "musubix3 status", options: ["--json"] },
      ],
    };
    const candidate = {
      commands: [
        { path: "musubix4", options: [] },
        { path: "musubix4 run", options: ["--json"] },
        { path: "musubix4 status", options: ["--json", "--run"] },
      ],
    };
    const validInventory = {
      schemaVersion: 1,
      entries: [
        {
          path: "musubix4 run",
          classification: "musubix4-only",
          invocation: ["run", "--help"],
        },
        {
          path: "musubix4 status",
          classification: "additive-resolution",
          invocation: ["status", "--json"],
        },
      ],
    };

    expect(validateStaticCommandInventory).toBeTypeOf("function");
    expect(
      validateStaticCommandInventory!(
        upstream,
        candidate,
        validInventory,
      ),
    ).toMatchObject({
      valid: true,
      pinnedInvocations: [
        {
          path: "musubix4 run",
          classification: "musubix4-only",
          argv: ["run", "--help"],
        },
        {
          path: "musubix4 status",
          classification: "additive-resolution",
          argv: ["status", "--json"],
        },
      ],
    });

    expect(() =>
      validateStaticCommandInventory!(upstream, candidate, {
        ...validInventory,
        entries: [validInventory.entries[0], validInventory.entries[0]],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "COMMAND_INVENTORY_DUPLICATE_ENTRY" }),
    );
    expect(() =>
      validateStaticCommandInventory!(upstream, candidate, {
        ...validInventory,
        entries: [validInventory.entries[0]],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "COMMAND_INVENTORY_MISSING_PATH" }),
    );
    expect(() =>
      validateStaticCommandInventory!(upstream, candidate, {
        ...validInventory,
        entries: [
          ...validInventory.entries,
          {
            path: "musubix4 removed",
            classification: "musubix4-only",
            invocation: ["removed"],
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "COMMAND_INVENTORY_STALE_ENTRY" }),
    );
  });
});
