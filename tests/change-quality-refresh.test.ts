import { expect, it } from "vitest";
import {
  readText,
  recordChangePhase,
  validateChangeEvidence,
  writeJson,
  writeText,
} from "../packages/analysis/src/index.js";
import {
  code,
  digestChainRecord,
  project,
  testCode,
} from "./helpers.js";

const requirements = ["REQ-EXAMPLE-001", "REQ-EXAMPLE-002"];

async function addSecondRequirement(root: string): Promise<void> {
  await writeText(
    root,
    ".musubix/features/example/requirements.md",
    `${await readText(root, ".musubix/features/example/requirements.md")}
## REQ-EXAMPLE-002: Report secondary readiness
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall report its secondary readiness.
Acceptance: A test checks the reported secondary readiness.
`,
  );
  await writeText(
    root,
    ".musubix/features/example/design.md",
    `${await readText(root, ".musubix/features/example/design.md")}
## DES-EXAMPLE-002: Secondary readiness component
Responsibilities: Report secondary readiness.
Interfaces: secondaryReadiness() returns boolean.
Constraints: The result is deterministic.
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
    "src/second.test.ts",
    `/** @id TEST-EXAMPLE-002
 * @verifies REQ-EXAMPLE-002
 */
export function testSecondaryReadiness() { return true; }
`,
  );
}

async function initialQuality(root: string) {
  await addSecondRequirement(root);
  await writeText(
    root,
    ".musubix/changes/CHANGE-0001.md",
    "# CHANGE-0001\nRequirements: REQ-EXAMPLE-001 REQ-EXAMPLE-002\n",
  );
  await recordChangePhase(root, "CHANGE-0001", "impact", requirements);
  await writeText(
    root,
    ".musubix/features/example/requirements.md",
    `${await readText(root, ".musubix/features/example/requirements.md")}\nChanged.\n`,
  );
  await recordChangePhase(root, "CHANGE-0001", "requirements", requirements);
  await writeText(
    root,
    ".musubix/features/example/design.md",
    `${await readText(root, ".musubix/features/example/design.md")}\nChanged.\n`,
  );
  await recordChangePhase(root, "CHANGE-0001", "design", requirements);
  await writeText(root, "src/service.test.ts", `${testCode}\n// initial red\n`);
  await recordChangePhase(root, "CHANGE-0001", "red", requirements);
  await writeText(root, "src/service.ts", code.replace("true", "false"));
  await writeText(
    root,
    "src/second.ts",
    `${await readText(root, "src/second.ts")}\n// initial implementation\n`,
  );
  await recordChangePhase(root, "CHANGE-0001", "implementation", requirements);
  await recordChangePhase(root, "CHANGE-0001", "green", requirements);
  await recordChangePhase(root, "CHANGE-0001", "quality", requirements);
}

async function laterGreen(root: string, requirementId: string, suffix: string) {
  const testPath =
    requirementId === "REQ-EXAMPLE-001"
      ? "src/service.test.ts"
      : "src/second.test.ts";
  const implementationPath =
    requirementId === "REQ-EXAMPLE-001" ? "src/service.ts" : "src/second.ts";
  await writeText(
    root,
    testPath,
    `${await readText(root, testPath)}\n// ${suffix} red\n`,
  );
  await recordChangePhase(root, "CHANGE-0001", "red", [requirementId]);
  await writeText(
    root,
    implementationPath,
    `${await readText(root, implementationPath)}\n// ${suffix} implementation\n`,
  );
  await recordChangePhase(root, "CHANGE-0001", "implementation", [
    requirementId,
  ]);
  await recordChangePhase(root, "CHANGE-0001", "green", [requirementId]);
}

/** @id TEST-CHANGE-QUALITY-REFRESH-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-020
 */
it("TEST-CHANGE-QUALITY-REFRESH-001 preserves two quality revisions with deterministic scoped order", async () => {
  const root = await project();
  await initialQuality(root);
  await laterGreen(root, "REQ-EXAMPLE-001", "first refresh");
  await recordChangePhase(root, "CHANGE-0001", "quality", requirements);
  await laterGreen(root, "REQ-EXAMPLE-002", "second refresh");
  const evidence = await recordChangePhase(
    root,
    "CHANGE-0001",
    "quality",
    requirements,
  );
  const change = evidence.changes[0]!;
  expect(change.qualityHistory).toHaveLength(2);
  expect(change.qualityHistory?.[0]?.orderDetail).toBeUndefined();
  expect(change.qualityHistory?.[1]?.orderDetail).toBe("quality-revision:1");
  expect(change.phases.quality?.orderDetail).toBe("quality-revision:2");
  const qualityOrders = [
    change.qualityHistory?.[0]?.order,
    change.qualityHistory?.[1]?.order,
    change.phases.quality?.order,
  ];
  expect(qualityOrders.every(Number.isInteger)).toBe(true);
  expect(
    Number(qualityOrders[0]) < Number(qualityOrders[1]) &&
      Number(qualityOrders[1]) < Number(qualityOrders[2]),
  ).toBe(true);
  const report = await validateChangeEvidence(root);
  expect(
    report.diagnostics.filter((diagnostic) =>
      diagnostic.code.includes("QUALITY") ||
      diagnostic.code === "CHANGE_ORDER_MISMATCH" ||
      diagnostic.code === "EVIDENCE_ORDER_DUPLICATE"),
  ).toEqual([]);
});

/** @id TEST-CHANGE-QUALITY-REFRESH-002
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-020
 */
it("TEST-CHANGE-QUALITY-REFRESH-002 rejects no-later-Green refresh and keeps dry-run side-effect free", async () => {
  const root = await project();
  await initialQuality(root);
  const beforeChanges = await readText(root, ".musubix/evidence/changes.json");
  const beforeOrder = await readText(root, ".musubix/evidence/order.json");
  await expect(
    recordChangePhase(root, "CHANGE-0001", "quality", requirements),
  ).rejects.toThrow("CHANGE_QUALITY_REFRESH_NOT_NEEDED");
  expect(await readText(root, ".musubix/evidence/changes.json")).toBe(
    beforeChanges,
  );
  expect(await readText(root, ".musubix/evidence/order.json")).toBe(beforeOrder);

  await laterGreen(root, "REQ-EXAMPLE-001", "dry run");
  const beforeDryRunOrder = await readText(root, ".musubix/evidence/order.json");
  const preview = await recordChangePhase(
    root,
    "CHANGE-0001",
    "quality",
    requirements,
    { dryRun: true },
  );
  expect(preview.changes[0]?.phases.quality?.order).toBeUndefined();
  expect(preview.changes[0]?.phases.quality?.orderDetail).toBe(
    "quality-revision:1",
  );
  expect(await readText(root, ".musubix/evidence/order.json")).toBe(
    beforeDryRunOrder,
  );
});

/** @id TEST-CHANGE-QUALITY-REFRESH-003
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-020
 */
it("TEST-CHANGE-QUALITY-REFRESH-003 rejects malformed quality history and unmatched checkpoints", async () => {
  const root = await project();
  await initialQuality(root);
  await laterGreen(root, "REQ-EXAMPLE-001", "tamper");
  const evidence = await recordChangePhase(
    root,
    "CHANGE-0001",
    "quality",
    requirements,
  );
  const currentOrder = evidence.changes[0]!.phases.quality!.order;
  if (currentOrder === undefined) throw new Error("Expected current quality order.");
  evidence.changes[0]!.qualityHistory![0]!.order = currentOrder;
  await writeJson(root, ".musubix/evidence/changes.json", evidence);
  expect((await validateChangeEvidence(root)).diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "CHANGE_QUALITY_HISTORY_ORDER" }),
      expect.objectContaining({ code: "CHANGE_QUALITY_HISTORY_ORPHAN" }),
    ]),
  );
  await laterGreen(root, "REQ-EXAMPLE-002", "tampered refresh");
  const beforeOrderFailureChanges = await readText(
    root,
    ".musubix/evidence/changes.json",
  );
  const beforeOrderFailureOrder = await readText(
    root,
    ".musubix/evidence/order.json",
  );
  await expect(
    recordChangePhase(root, "CHANGE-0001", "quality", requirements),
  ).rejects.toThrow("CHANGE_QUALITY_HISTORY_ORDER");
  expect(await readText(root, ".musubix/evidence/changes.json")).toBe(
    beforeOrderFailureChanges,
  );
  expect(await readText(root, ".musubix/evidence/order.json")).toBe(
    beforeOrderFailureOrder,
  );

  const schemaRoot = await project();
  await initialQuality(schemaRoot);
  await laterGreen(schemaRoot, "REQ-EXAMPLE-001", "schema refresh");
  await recordChangePhase(
    schemaRoot,
    "CHANGE-0001",
    "quality",
    requirements,
  );
  await laterGreen(schemaRoot, "REQ-EXAMPLE-002", "schema retry");
  const schemaEvidence = JSON.parse(
    await readText(schemaRoot, ".musubix/evidence/changes.json"),
  ) as Awaited<ReturnType<typeof recordChangePhase>>;
  (
    schemaEvidence.changes[0]!.qualityHistory![0] as unknown as {
      fingerprints: unknown;
    }
  ).fingerprints = null;
  await writeJson(
    schemaRoot,
    ".musubix/evidence/changes.json",
    schemaEvidence,
  );
  expect((await validateChangeEvidence(schemaRoot)).diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "CHANGE_QUALITY_HISTORY_SCHEMA" }),
    ]),
  );
  const beforeSchemaFailureChanges = await readText(
    schemaRoot,
    ".musubix/evidence/changes.json",
  );
  const beforeSchemaFailureOrder = await readText(
    schemaRoot,
    ".musubix/evidence/order.json",
  );
  await expect(
    recordChangePhase(schemaRoot, "CHANGE-0001", "quality", requirements),
  ).rejects.toThrow("CHANGE_QUALITY_HISTORY_SCHEMA");
  expect(await readText(schemaRoot, ".musubix/evidence/changes.json")).toBe(
    beforeSchemaFailureChanges,
  );
  expect(await readText(schemaRoot, ".musubix/evidence/order.json")).toBe(
    beforeSchemaFailureOrder,
  );

  const currentOrphanRoot = await project();
  await initialQuality(currentOrphanRoot);
  await laterGreen(
    currentOrphanRoot,
    "REQ-EXAMPLE-001",
    "current orphan refresh",
  );
  const currentOrphanEvidence = await recordChangePhase(
    currentOrphanRoot,
    "CHANGE-0001",
    "quality",
    requirements,
  );
  currentOrphanEvidence.changes[0]!.phases.quality!.order! += 100;
  await writeJson(
    currentOrphanRoot,
    ".musubix/evidence/changes.json",
    currentOrphanEvidence,
  );
  const currentOrphanDiagnostics = (
    await validateChangeEvidence(currentOrphanRoot)
  ).diagnostics;
  expect(currentOrphanDiagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "CHANGE_ORDER_MISMATCH" }),
    ]),
  );
  expect(currentOrphanDiagnostics).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "CHANGE_QUALITY_HISTORY_ORPHAN" }),
    ]),
  );

  const missingCurrentRoot = await project();
  await initialQuality(missingCurrentRoot);
  await laterGreen(
    missingCurrentRoot,
    "REQ-EXAMPLE-001",
    "missing current refresh",
  );
  const missingCurrentEvidence = await recordChangePhase(
    missingCurrentRoot,
    "CHANGE-0001",
    "quality",
    requirements,
  );
  await laterGreen(
    missingCurrentRoot,
    "REQ-EXAMPLE-002",
    "missing current retry",
  );
  const missingCurrentLatest = JSON.parse(
    await readText(missingCurrentRoot, ".musubix/evidence/changes.json"),
  ) as Awaited<ReturnType<typeof recordChangePhase>>;
  delete missingCurrentLatest.changes[0]!.phases.quality;
  await writeJson(
    missingCurrentRoot,
    ".musubix/evidence/changes.json",
    missingCurrentLatest,
  );
  expect((await validateChangeEvidence(missingCurrentRoot)).diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "CHANGE_QUALITY_HISTORY_SCHEMA" }),
    ]),
  );
  const beforeMissingCurrentChanges = await readText(
    missingCurrentRoot,
    ".musubix/evidence/changes.json",
  );
  const beforeMissingCurrentOrder = await readText(
    missingCurrentRoot,
    ".musubix/evidence/order.json",
  );
  await expect(
    recordChangePhase(
      missingCurrentRoot,
      "CHANGE-0001",
      "quality",
      requirements,
    ),
  ).rejects.toThrow("CHANGE_QUALITY_HISTORY_SCHEMA");
  expect(
    await readText(missingCurrentRoot, ".musubix/evidence/changes.json"),
  ).toBe(beforeMissingCurrentChanges);
  expect(
    await readText(missingCurrentRoot, ".musubix/evidence/order.json"),
  ).toBe(beforeMissingCurrentOrder);
}, 60_000);

/** @id TEST-CHANGE-QUALITY-REFRESH-004
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-020
 */
it("TEST-CHANGE-QUALITY-REFRESH-004 tolerates an order-only quality orphan and appends the same detail safely", async () => {
  const root = await project();
  await initialQuality(root);
  const initialEvidence = JSON.parse(
    await readText(root, ".musubix/evidence/changes.json"),
  ) as {
    changes: Array<Record<string, unknown> & {
      phases: { quality?: { orderDetail?: string } };
      qualityHistory?: unknown[];
    }>;
  };
  expect(initialEvidence.changes[0]?.qualityHistory).toBeUndefined();
  expect(initialEvidence.changes[0]?.phases.quality?.orderDetail).toBeUndefined();
  initialEvidence.changes[0]!.extensionAudit = { preserved: true };
  await writeJson(root, ".musubix/evidence/changes.json", initialEvidence);
  await laterGreen(root, "REQ-EXAMPLE-001", "orphan");
  const order = JSON.parse(
    await readText(root, ".musubix/evidence/order.json"),
  ) as { schemaVersion: 1; records: Array<Record<string, unknown>> };
  const previous = order.records.at(-1)!;
  const payload = {
    sequence: order.records.length + 1,
    kind: "change",
    entityId: "CHANGE-0001",
    phase: "quality",
    detail: "quality-revision:1",
    previousSha256: previous.recordSha256,
  };
  order.records.push({
    ...payload,
    recordSha256: digestChainRecord(payload),
  });
  await writeJson(root, ".musubix/evidence/order.json", order);

  const evidence = await recordChangePhase(
    root,
    "CHANGE-0001",
    "quality",
    requirements,
  );
  expect(evidence.changes[0]?.phases.quality?.orderDetail).toBe(
    "quality-revision:1",
  );
  expect(
    (evidence.changes[0] as unknown as { extensionAudit?: unknown })
      .extensionAudit,
  ).toEqual({ preserved: true });
  const report = await validateChangeEvidence(root);
  expect(
    report.diagnostics.filter(
      (diagnostic) => diagnostic.code === "CHANGE_QUALITY_ORDER_ORPHAN",
    ),
  ).toEqual([
    expect.objectContaining({
      code: "CHANGE_QUALITY_ORDER_ORPHAN",
      severity: "warning",
    }),
  ]);
  expect(report.diagnostics).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "EVIDENCE_ORDER_DUPLICATE" }),
    ]),
  );
});
