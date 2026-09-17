import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as hoh from "../packages/analysis/src/hoh.js";
import {
  buildTrace,
  runTddPhase,
  validateTddEvidence,
  writeText,
} from "../packages/analysis/src/index.js";
import { fixture, project, tddResultRunner } from "./helpers.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("frozen baseline oracle", () => {
  /** @id TEST-AUTONOMOUS-ORACLE-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-001 REQ-AUTONOMOUS-DEVELOPMENT-002 REQ-AUTONOMOUS-DEVELOPMENT-013
   */
  it("TEST-AUTONOMOUS-ORACLE-001 verifies the pinned local oracle before role execution", async () => {
    const commandSurface = '{"commands":[{"path":"musubix3","options":[]}]}';
    const golden = '{"exitStatus":0,"outputKeys":["valid"]}';
    const compatibilityTest = "export const inheritedCompatibility = true;\n";
    const historicalTrace =
      '{"requirements":{"REQ-LEGACY-001":{"implementationPaths":["src/a.ts"],"testPaths":["tests/a.test.ts"]}}}';
    const artifactEntries = [
      ["baseline-specs/oracle/command-surface.json", sha256(commandSurface)],
      ["baseline-specs/oracle/goldens/status.json", sha256(golden)],
      ["tests/inherited-compatibility.test.ts", sha256(compatibilityTest)],
      ["baseline-specs/oracle/historical-trace.json", sha256(historicalTrace)],
    ] as const;
    const artifactDigest = sha256(
      JSON.stringify(
        artifactEntries.map(([path, digest]) => ({ path, sha256: digest })),
      ),
    );
    const attestation = JSON.stringify({
      schemaVersion: 1,
      upstream: {
        repository: "nahisaho/musubix3",
        commit: "c0b20f06727bceb04eeec181d95af9047b1981de",
      },
      procedure: { id: "musubix3-oracle", version: "1" },
      artifactDigest,
    });
    const manifest = JSON.stringify({
      schemaVersion: 1,
      upstream: {
        repository: "nahisaho/musubix3",
        commit: "c0b20f06727bceb04eeec181d95af9047b1981de",
      },
      procedure: { id: "musubix3-oracle", version: "1" },
      artifacts: artifactEntries.map(([path, digest]) => ({
        path,
        sha256: digest,
      })),
      attestation: {
        path: "baseline-specs/oracle/regeneration-attestation.json",
        sha256: sha256(attestation),
      },
    });
    const root = await fixture({
      "baseline-specs/baseline.manifest.json": manifest,
      "baseline-specs/oracle/command-surface.json": commandSurface,
      "baseline-specs/oracle/goldens/status.json": golden,
      "tests/inherited-compatibility.test.ts": compatibilityTest,
      "baseline-specs/oracle/historical-trace.json": historicalTrace,
      "baseline-specs/oracle/regeneration-attestation.json": attestation,
    });
    const verifyBaselineOracle = (
      hoh as typeof hoh & {
        verifyBaselineOracle?: (root: string) => Promise<{
          valid: boolean;
          protectedPaths: string[];
          digest: string;
        }>;
      }
    ).verifyBaselineOracle;

    expect(verifyBaselineOracle).toBeTypeOf("function");
    const verified = await verifyBaselineOracle!(root);
    expect(verified.valid).toBe(true);
    expect(verified.protectedPaths).toEqual(
      expect.arrayContaining([
        "baseline-specs/baseline.manifest.json",
        "tests/inherited-compatibility.test.ts",
      ]),
    );
    expect(verified.digest).toMatch(/^[a-f0-9]{64}$/);

    await expect(
      verifyBaselineOracle!(
        await fixture({
          "baseline-specs/baseline.manifest.json": manifest,
          "baseline-specs/oracle/command-surface.json": `${commandSurface}\n`,
          "baseline-specs/oracle/goldens/status.json": golden,
          "tests/inherited-compatibility.test.ts": compatibilityTest,
          "baseline-specs/oracle/historical-trace.json": historicalTrace,
          "baseline-specs/oracle/regeneration-attestation.json": attestation,
        }),
      ),
    ).rejects.toMatchObject({ code: "BASELINE_ARTIFACT_DIGEST_MISMATCH" });
  });

  /** @id TEST-AUTONOMOUS-ORACLE-005
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-001 REQ-AUTONOMOUS-DEVELOPMENT-002 REQ-AUTONOMOUS-DEVELOPMENT-013
   */
  it("TEST-AUTONOMOUS-ORACLE-005 reproduces the checked-in baseline and keeps pinned tests compatibility-only", async () => {
    await expect(hoh.verifyBaselineOracle(process.cwd())).resolves.toMatchObject({
      valid: true,
    });
    const manifest = JSON.parse(
      await readFile("baseline-specs/baseline.manifest.json", "utf8"),
    ) as {
      upstream: { commit: string };
      procedure: { id: string; version: string };
      artifacts: { path: string }[];
    };
    expect(manifest.upstream.commit).toBe(
      "c0b20f06727bceb04eeec181d95af9047b1981de",
    );
    expect(manifest.procedure).toEqual({
      id: "musubix3-canonical-oracle",
      version: "2",
    });
    const pinnedTests = manifest.artifacts
      .map((artifact) => artifact.path)
      .filter((path) => path.endsWith(".test.ts"));
    expect(pinnedTests).toEqual(["tests/inherited-compatibility.test.ts"]);
    for (const path of pinnedTests) {
      const source = await readFile(path, "utf8");
      const ids = [...source.matchAll(/@id (TEST-[A-Z0-9-]+)/g)].map(
        (match) => match[1],
      );
      expect(ids.length).toBeGreaterThan(0);
      const declarations = [
        ...source.matchAll(/\b(?:it|test)\s*\(/g),
      ];
      expect(declarations).toHaveLength(ids.length);
      expect(ids.every((id) => id?.startsWith("TEST-CLI-COMPATIBILITY-"))).toBe(
        true,
      );
    }
  });

  /** @id TEST-AUTONOMOUS-ORACLE-002
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-002
   */
  it("TEST-AUTONOMOUS-ORACLE-002 excludes frozen historical requirements from current TDD coverage", async () => {
    const root = await project();
    await runTddPhase(root, "red", "TEST-EXAMPLE-001", "REQ-EXAMPLE-001", "test",
      tddResultRunner(root, "failed", { exitCode: 1 }));
    await writeText(root, "src/service.ts", "export function readiness() { return true; }\n");
    await runTddPhase(root, "green", "TEST-EXAMPLE-001", "REQ-EXAMPLE-001", "test",
      tddResultRunner(root, "passed"));
    await writeText(root, "baseline-specs/features/legacy/requirements.md", `---
schemaVersion: 1
feature: legacy
---
# Legacy

## REQ-LEGACY-001: Historical requirement
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The historical system shall retain its frozen behavior.
Acceptance: Covered by the pinned historical trace and compatibility suite.
`);

    const evidence = await validateTddEvidence(root);
    expect(evidence.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "TDD_REQUIREMENT_UNCOVERED",
        path: "baseline-specs/features/legacy/requirements.md",
      }),
    ]));
  });

  /** @id TEST-AUTONOMOUS-ORACLE-003
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-002
   */
  it("TEST-AUTONOMOUS-ORACLE-003 validates the frozen historical requirement mapping", async () => {
    const root = await fixture({
      "baseline-specs/features/legacy/requirements.md": `---
schemaVersion: 1
feature: legacy
---
# Legacy

## REQ-LEGACY-001: First historical requirement
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The historical system shall retain its first behavior.
Acceptance: Covered by the pinned compatibility suite.

## REQ-LEGACY-002: Second historical requirement
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The historical system shall retain its second behavior.
Acceptance: Covered by the pinned compatibility suite.
`,
      "baseline-specs/oracle/historical-trace.json": JSON.stringify({
        schemaVersion: 1,
        sourceRoot: "baseline-specs/features",
        normalizedRequirement: "REQ-AUTONOMOUS-DEVELOPMENT-001",
        implementationPaths: ["src"],
        executingCompatibilityTestPaths: ["tests/compatibility.test.ts"],
        mappingPolicy: "Every frozen requirement uses the common implementation and compatibility paths.",
      }),
      "src/index.ts": "export const compatible = true;\n",
      "tests/compatibility.test.ts": "export const compatibility = true;\n",
    });
    const verifyHistoricalTrace = (
      hoh as typeof hoh & {
        verifyHistoricalTrace?: (
          root: string,
          mappingPath?: string,
        ) => Promise<{ requirementIds: string[] }>;
      }
    ).verifyHistoricalTrace;

    expect(verifyHistoricalTrace).toBeTypeOf("function");
    await expect(verifyHistoricalTrace!(root)).resolves.toEqual({
      requirementIds: ["REQ-LEGACY-001", "REQ-LEGACY-002"],
    });
  });

  /** @id TEST-AUTONOMOUS-ORACLE-004
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-002
   */
  it("TEST-AUTONOMOUS-ORACLE-004 keeps frozen historical ADRs outside the active trace namespace", async () => {
    const root = await project();
    await writeText(root, "baseline-specs/decisions/ADR-0001.md", `---
schemaVersion: 1
id: ADR-0001
status: accepted
---
# Historical ADR
`);
    const trace = await buildTrace(root, false);
    expect(trace.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "TRACE_DUPLICATE" }),
    ]));
    expect(trace.nodes.filter((node) => node.id === "ADR-0001")).toHaveLength(1);
  });
});
