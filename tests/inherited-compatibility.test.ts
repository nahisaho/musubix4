import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { createProgram } from "../packages/cli/src/main.js";

const baselineSurface = JSON.parse(
  readFileSync(resolve("tests/fixtures/musubix3-cli-surface.json"), "utf8"),
) as ReturnType<typeof surface>;

function surface(
  command: ReturnType<typeof createProgram>,
  parent = "",
): {
  path: string;
  options: string[];
  commands: ReturnType<typeof surface>[];
} {
  const path = [parent, command.name()].filter(Boolean).join(" ");
  return {
    path,
    options: command.options.map((option) => option.flags).sort(),
    commands: command.commands
      .map((child) => surface(child, path))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function flatten(node: ReturnType<typeof surface>): Map<string, string[]> {
  return new Map([
    [node.path, node.options],
    ...node.commands.flatMap((child) => [...flatten(child)]),
  ]);
}

/** @id TEST-CLI-COMPATIBILITY-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-001
 */
it("TEST-CLI-COMPATIBILITY-001 preserves every MUSUBIX3 command and option", () => {
  const expected = flatten(baselineSurface);
  const actual = flatten(surface(createProgram()));
  const missingCommands = [...expected.keys()].filter(
    (path) => !actual.has(path),
  );
  const missingOptions = [...expected].flatMap(([path, options]) =>
    options
      .filter((option) => !actual.get(path)?.includes(option))
      .map((option) => `${path}: ${option}`),
  );
  expect({ missingCommands, missingOptions }).toEqual({
    missingCommands: [],
    missingOptions: [],
  });
  expect(createProgram().name()).toBe("musubix4");
});
