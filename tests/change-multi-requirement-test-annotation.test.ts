import { expect, it } from "vitest";
import {
  readText,
  recordChangePhase,
  validateChangeCompleteness,
  writeText,
} from "../packages/analysis/src/index.js";
import { project } from "./helpers.js";

/** @id TEST-CHANGE-MULTI-REQUIREMENT-ANNOTATION-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-001
 */
it("TEST-CHANGE-MULTI-REQUIREMENT-ANNOTATION-001 recognizes every requirement in a shared @verifies declaration", async () => {
  const root = await project();
  await writeText(
    root,
    ".musubix/features/example/requirements.md",
    `${await readText(root, ".musubix/features/example/requirements.md")}
## REQ-EXAMPLE-002: Secondary readiness
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall report secondary readiness.
Acceptance: A test checks secondary readiness against the configured result.
`,
  );
  await writeText(
    root,
    ".musubix/features/example/design.md",
    `${await readText(root, ".musubix/features/example/design.md")}
## DES-EXAMPLE-002: Secondary readiness
Responsibilities: Report explicit secondary readiness evidence.
Interfaces: secondaryReadiness() returns a deterministic boolean.
Constraints: Missing evidence cannot count as readiness.
Requirements: REQ-EXAMPLE-002
ADRs: ADR-0001
Depends-On: none
`,
  );
  await writeText(
    root,
    "src/second.ts",
    `/** @id CODE-EXAMPLE-002
 * @implements REQ-EXAMPLE-002
 * @design DES-EXAMPLE-002
 */
export function secondaryReadiness() { return true; }
`,
  );
  await writeText(
    root,
    "src/service.test.ts",
    `/** @id TEST-EXAMPLE-001
 * @verifies REQ-EXAMPLE-001 REQ-EXAMPLE-002
 */
export function testReadiness() { return true; }
`,
  );
  await writeText(
    root,
    ".musubix/changes/CHANGE-0001.md",
    "# CHANGE-0001\nRequirements: REQ-EXAMPLE-001 REQ-EXAMPLE-002\n",
  );
  const requirements = ["REQ-EXAMPLE-001", "REQ-EXAMPLE-002"];
  await recordChangePhase(root, "CHANGE-0001", "impact", requirements);
  await writeText(
    root,
    ".musubix/features/example/requirements.md",
    `${await readText(root, ".musubix/features/example/requirements.md")}\nChange: clarified shared test coverage.\n`,
  );
  await recordChangePhase(root, "CHANGE-0001", "requirements", requirements);
  await writeText(
    root,
    ".musubix/features/example/design.md",
    `${await readText(root, ".musubix/features/example/design.md")}\nChange: clarified shared test binding.\n`,
  );
  await recordChangePhase(root, "CHANGE-0001", "design", requirements);
  await writeText(
    root,
    "src/service.test.ts",
    `${await readText(root, "src/service.test.ts")}\n// red checkpoint\n`,
  );
  await recordChangePhase(root, "CHANGE-0001", "red", requirements);
  await writeText(
    root,
    "src/second.ts",
    `${await readText(root, "src/second.ts")}\n// implementation checkpoint\n`,
  );
  await writeText(
    root,
    "src/service.ts",
    `${await readText(root, "src/service.ts")}\n// implementation checkpoint\n`,
  );
  await recordChangePhase(root, "CHANGE-0001", "implementation", requirements);
  await recordChangePhase(root, "CHANGE-0001", "green", requirements);
  await recordChangePhase(root, "CHANGE-0001", "quality", requirements);

  const result = await validateChangeCompleteness(root);

  expect(result.diagnostics).not.toContainEqual(
    expect.objectContaining({
      code: "CHANGE_COMPLETENESS_TEST",
      message: expect.stringContaining("REQ-EXAMPLE-002"),
    }),
  );
});
