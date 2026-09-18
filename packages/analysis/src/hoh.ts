import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import ts from "typescript";

export type HohRole =
  "planner" | "developer" | "qa" | "reviewer" | "deployment";
export type QualityDimension =
  | "functional-correctness"
  | "completeness"
  | "regression-safety"
  | "usability"
  | "security"
  | "performance"
  | "maintainability";
export type SpecificationSource =
  | { kind: "prompt"; text: string }
  | { kind: "markdown" | "musubix"; path: string }
  | { kind: "github-issue"; repository: string; issue: number };

export interface HohConfig {
  model: string;
  reasoning?: string;
  copilotCliVersion?: string;
  budget: { aiCredits: number };
  approval: {
    mode: "verified-auto";
    boundaryAttemptLimit: number;
    maxManifestBytes: number;
    maxManifestPaths: number;
  };
  commands: Record<string, string[]>;
  qaChecks: Partial<Record<MandatoryQaCheckId, string[]>>;
  limits: {
    maxIterations: number;
    maxActiveHours: number;
    stagnantIterations: number;
    roleOutputRetryLimit: number;
    blockerRepairRetryLimit: number;
    amendmentRetryLimit: number;
    maxAmendmentEpisodes: number;
  };
  maxSpecificationBytes: number;
  maxIndexEntries: number;
  roleInvocationReservedCredits: number;
  roleInvocationTimeoutMs: number;
  commandTimeoutMs: number;
  maxCommandOutputBytes: number;
  candidateExtraPaths: string[];
  dependencyProvisioning?: {
    lockfilePath?: string;
    command: string[];
    writablePaths: string[];
  };
  permissions: Partial<Record<HohRole, PolicyOverrides>>;
}

export interface PolicyOverrides {
  allowReadPaths?: string[];
  allowWritePaths?: string[];
  allowCommands?: string[];
  allowPaths?: string[];
  allowUrls?: string[];
  allowMcpServers?: string[];
  allowTools?: string[];
  allowSecrets?: string[];
  allowProjectCommands?: boolean;
  allowWrite?: boolean;
  network?: "deny" | "allowlist";
}

export interface EffectiveRolePolicy {
  role: HohRole;
  allowPaths: string[];
  allowUrls: string[];
  allowMcpServers: string[];
  allowTools: string[];
  allowSecrets: string[];
  allowProjectCommands: boolean;
  allowWrite: boolean;
  network: "deny" | "allowlist";
  residualRisks: string[];
  digest: string;
}

export interface PublicRequirement {
  id: string;
  statement: string;
  ordinal: number;
}

export interface PublicSpecification {
  schemaVersion: 1;
  source: SpecificationSource["kind"];
  locator: string;
  digest: string;
  content: string;
  promptRegion: string;
  requirements: PublicRequirement[];
  path: string;
}

export interface Claim {
  id: string;
  requirementId: string;
  dimension: QualityDimension;
}

export interface QaClaim {
  claimId: string;
  status: "verified" | "gap" | "insufficient-evidence";
  evidence: string[];
}

export interface EvidenceBundle {
  claims: QaClaim[];
  verified: QaClaim[];
  unresolved: QaClaim[];
  readiness: boolean;
}

export type MandatoryQaCheckId =
  | "build"
  | "focused-test"
  | "static-validation"
  | "trace"
  | "dependency-cycle"
  | "structured-contract"
  | "inherited-compatibility";

export interface MandatoryQaCheck {
  id: MandatoryQaCheckId;
  status: "passed" | "failed";
  evidence: string[];
  binding?: {
    acceptedCandidateDigest: string;
    claimMatrixDigest: string;
    checkoutTreeDigest: string;
  };
}

const mandatoryQaCheckIds: MandatoryQaCheckId[] = [
  "build",
  "focused-test",
  "static-validation",
  "trace",
  "dependency-cycle",
  "structured-contract",
  "inherited-compatibility",
];

export interface CandidateSnapshot {
  ref: string;
  treeDigest: string;
  lockfile?: {
    path: string;
    sha256: string;
  };
}

export interface ProvisionalCandidateSnapshot extends CandidateSnapshot {
  original: CandidateSnapshot;
  inventorySha256: string;
}

export interface BaselineOracleVerification {
  valid: true;
  manifestPath: string;
  upstream: { repository: string; commit: string };
  procedure: { id: string; version: string };
  protectedPaths: string[];
  digest: string;
}

export class BaselineOracleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = "BaselineOracleError";
  }
}

export interface DeclaredCommandSurface {
  schemaVersion: 1;
  commands: Array<{ path: string; options: string[] }>;
  digest: string;
}

export class CommandSurfaceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path: string,
    readonly line?: number,
  ) {
    super(message);
    this.name = "CommandSurfaceError";
  }
}

export type CommandCollisionClassification =
  "inherited" | "musubix4-only" | "additive-resolution";

export interface CommandCollisionInventory {
  schemaVersion: 1;
  entries: Array<{
    path: string;
    classification: CommandCollisionClassification;
    invocation: string[];
  }>;
}

export interface StaticCommandInventoryValidation {
  valid: true;
  pinnedInvocations: Array<{
    path: string;
    classification: CommandCollisionClassification;
    argv: string[];
  }>;
  digest: string;
}

export class CommandInventoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly paths: string[] = [],
  ) {
    super(message);
    this.name = "CommandInventoryError";
  }
}

export class ProtectedSetError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "ProtectedSetError";
  }
}

export class CandidateIsolationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path: string,
    readonly guidance: string,
  ) {
    super(message);
    this.name = "CandidateIsolationError";
  }

  get paths(): string[] {
    return [this.path];
  }
}

export class CandidateBaselineError extends Error {
  constructor(
    readonly code:
      | "CANDIDATE_BASELINE_MISSING"
      | "CANDIDATE_BASELINE_INVALID"
      | "CANDIDATE_BASELINE_DIGEST_MISMATCH"
      | "CANDIDATE_BASE_COMMIT_UNRESOLVABLE",
    message: string,
  ) {
    super(message);
    this.name = "CandidateBaselineError";
  }
}

export interface CommandRecord {
  schemaVersion: 1;
  argv: string[];
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
  policyDigest: string;
  residualRisks: string[];
}

export interface PlannerPriority {
  requirementId: string;
  acceptanceGates: string[];
  preservation: string[];
}

export interface PlannerPlan {
  kind: "plan";
  priorities: PlannerPriority[];
  addressedBlockers?: string[];
}

export interface PlannerReadiness {
  kind: "readiness";
  evidence: string[];
}

export interface RunTransition {
  sequence: number;
  event: string;
  state: RunState;
  recordedAt: string;
  details?: Record<string, unknown>;
}

export type RunState =
  | "created"
  | "planned"
  | "candidate"
  | "qa"
  | "ready"
  | "approval-paused"
  | "amendment-required"
  | "candidate-isolation-required"
  | "deploying"
  | "deployed"
  | "recovered"
  | "rollback-failed"
  | "stopped"
  | "failed";

export interface RunRecord {
  schemaVersion: 1;
  id: string;
  approvalAuthority?: "verified-auto" | "manual";
  state: RunState;
  iteration: number;
  role: HohRole | null;
  source: SpecificationSource;
  config: HohConfig;
  configDigest: string;
  usage: { aiCredits: number; reserved: number };
  usageNanoAiu?: { consumed: number; reserved: number };
  evidence: { verified: number; unresolved: number; regressions: number };
  evidenceClaims?: QaClaim[];
  activeDurationMs: number;
  stagnantIterations: number;
  blockerRepairAttempts?: number;
  amendmentEpisodeCount?: number;
  amendmentFailureCount?: number;
  requiredOperatorAction?:
    | "amend-collision-inventory"
    | "approve-requirements"
    | "approve-design"
    | "approve-release"
    | "restore-candidate-isolation-paths-or-start-new-run"
    | "start-new-run"
    | "none";
  offendingInventoryPaths?: string[];
  offendingCandidateIsolationPaths?: string[];
  amendmentManifest?: {
    path: string;
    sha256: string;
    nonce: string;
  };
  protectedSetDigest?: string;
  protectedSetPaths?: string[];
  collisionInventoryOverridePath?: string;
  candidateBaselineInitialized?: boolean;
  terminalReason?: string;
  candidate?: CandidateSnapshot;
  preservationCandidate?: CandidateSnapshot;
  rejectedCandidates?: Array<
    | { candidate: CandidateSnapshot; reason: string; evidence?: string[] }
    | string
  >;
  requirements?: string[];
  approval?: {
    stage: string;
    nonce: string;
    manifestDigest: string;
    boundaryKey?: string;
    decision?: "approved" | "rejected";
    automated?: boolean;
    reviewerEvidence?: unknown;
    validatorEvidence?: unknown[];
    releaseGateEvidence?: MandatoryQaCheck[];
    policyIdentity?: string;
    policyDigest?: string;
  };
  approvalAttempts?: Record<string, number>;
  automaticApprovals?: Record<
    string,
    {
      manifestDigest: string;
      evidence: Record<string, unknown>;
    }
  >;
  releaseGateEvidence?: MandatoryQaCheck[];
  releaseBlockers?: unknown[];
  rejectedReleaseManifestDigests?: string[];
  releaseGateBinding?: {
    acceptedCandidateDigest: string;
    claimMatrixDigest: string;
    checkoutTreeDigest: string;
  };
  attempts?: Array<{
    id: string;
    role: HohRole;
    ceiling: number;
    actual?: number;
    ceilingNanoAiu?: number;
    actualNanoAiu?: number;
    status: "reserved" | "settled" | "abandoned";
    overrun?: number;
    overrunNanoAiu?: number;
    diagnosticCode?: "ROLE_CREDIT_RESERVATION_OVERRUN";
  }>;
  journal: RunTransition[];
}

export interface HohRunSummary {
  id: string;
  state: RunState;
  iteration: number;
  journalLength: number;
  evidence: RunRecord["evidence"];
  evidenceClaimStatuses: string[];
  deploymentCommands: {
    deploy: boolean;
    verify: boolean;
    rollback: boolean;
  };
  terminalReason: string | null;
  requiredOperatorAction: NonNullable<RunRecord["requiredOperatorAction"]>;
  offendingCandidateIsolationPaths: string[];
}

/** @id CODE-AUTOMATIC-HOH-CODING-001
 * @implements REQ-AUTOMATIC-HOH-CODING-001
 * @design DES-AUTOMATIC-HOH-CODING-001
 */
export function summarizeHohRun(run: RunRecord): HohRunSummary {
  return {
    id: run.id,
    state: run.state,
    iteration: run.iteration,
    journalLength: run.journal.length,
    evidence: run.evidence,
    evidenceClaimStatuses: (run.evidenceClaims ?? []).map(
      (claim) => claim.status,
    ),
    deploymentCommands: {
      deploy: !!run.config.commands.deploy?.length,
      verify: !!run.config.commands.verify?.length,
      rollback: !!run.config.commands.rollback?.length,
    },
    terminalReason: run.terminalReason ?? null,
    requiredOperatorAction: run.requiredOperatorAction ?? "none",
    offendingCandidateIsolationPaths:
      run.offendingCandidateIsolationPaths ?? [],
  };
}

export interface Lease {
  runId: string;
  nonce: string;
  path: string;
}

/** @id CODE-AUTOMATIC-HOH-CODING-003
 * @implements REQ-AUTOMATIC-HOH-CODING-001
 * @design DES-AUTOMATIC-HOH-CODING-002
 */
export interface RoleExecutionContext {
  id: string;
  config: HohConfig;
}

export type HohReviewer = (
  context: unknown,
  execution?: RoleExecutionContext,
) => Promise<unknown>;

export interface HohServices {
  github?: {
    loadIssue(
      source: Extract<SpecificationSource, { kind: "github-issue" }>,
    ): Promise<{ locator: string; content: string }>;
  };
  roles: {
    planner(context: unknown): Promise<unknown>;
    developer(context: unknown): Promise<unknown>;
    qa(context: unknown): Promise<unknown>;
    reviewer?(
      context: unknown,
      execution?: RoleExecutionContext,
    ): Promise<unknown>;
  };
  project: {
    preflight(context: unknown): Promise<void>;
    verifyBaselineOracle?(
      context: unknown,
    ): Promise<BaselineOracleVerification>;
    staticCandidateValidation?(
      context: unknown,
    ): Promise<StaticCommandInventoryValidation>;
    mandatoryChecks?(context: unknown): Promise<MandatoryQaCheck[]>;
    candidateChecks(context: unknown): Promise<boolean>;
  };
  git: {
    initialize?(context: unknown): Promise<void>;
    verifyIsolation?(context: unknown): Promise<void>;
    snapshot(context: unknown): Promise<CandidateSnapshot>;
    treeDigest(context: unknown): Promise<string>;
    rollback(context: unknown): Promise<CandidateSnapshot | void>;
    createQaWorkspace?(context: unknown): Promise<{ path: string }>;
    cleanupQaWorkspace?(context: unknown): Promise<void>;
  };
}

const dimensions: QualityDimension[] = [
  "functional-correctness",
  "completeness",
  "regression-safety",
  "usability",
  "security",
  "performance",
  "maintainability",
];

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

interface BaselineManifest {
  schemaVersion: 1;
  upstream: { repository: string; commit: string };
  procedure: { id: string; version: string };
  artifacts: Array<{ path: string; sha256: string }>;
  attestation: { path: string; sha256: string };
}

interface HistoricalTraceMapping {
  schemaVersion?: number;
  sourceRoot?: string;
  normalizedRequirement?: string;
  implementationPaths?: string[];
  executingCompatibilityTestPaths?: string[];
  mappingPolicy?: string;
  requirements?: Record<
    string,
    { implementationPaths?: string[]; testPaths?: string[] }
  >;
}

function baselinePath(root: string, path: string): string {
  if (!path || isAbsolute(path)) {
    throw new BaselineOracleError(
      "BASELINE_PATH_INVALID",
      `Baseline path must be repository-relative: ${path}`,
      path,
    );
  }
  const absolute = resolve(root, path);
  const relativePath = relative(resolve(root), absolute);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new BaselineOracleError(
      "BASELINE_PATH_INVALID",
      `Baseline path escapes the repository: ${path}`,
      path,
    );
  }
  return absolute;
}

async function readBaselineArtifact(
  root: string,
  path: string,
): Promise<Buffer> {
  const absolute = baselinePath(root, path);
  let metadata;
  try {
    metadata = await lstat(absolute);
  } catch {
    throw new BaselineOracleError(
      "BASELINE_ARTIFACT_MISSING",
      `Baseline artifact is missing: ${path}`,
      path,
    );
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new BaselineOracleError(
      "BASELINE_ARTIFACT_INVALID",
      `Baseline artifact must be a regular file: ${path}`,
      path,
    );
  }
  return readFile(absolute);
}

async function historicalRequirementFiles(
  root: string,
  directory: string,
): Promise<string[]> {
  const absolute = baselinePath(root, directory);
  const metadata = await lstat(absolute);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new BaselineOracleError(
      "BASELINE_HISTORICAL_TRACE_INVALID",
      `Historical trace source root must be a directory: ${directory}`,
      directory,
    );
  }
  const result: string[] = [];
  const visit = async (current: string, relativeDirectory: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new BaselineOracleError(
          "BASELINE_HISTORICAL_TRACE_INVALID",
          `Historical trace source contains a symbolic link: ${relativePath}`,
          relativePath,
        );
      }
      if (entry.isDirectory()) {
        await visit(resolve(current, entry.name), relativePath);
      } else if (entry.isFile() && entry.name === "requirements.md") {
        result.push(relativePath);
      }
    }
  };
  await visit(absolute, directory);
  return result.sort((a, b) => a.localeCompare(b));
}

async function requireHistoricalPath(
  root: string,
  path: string,
  kind: "implementation" | "test",
): Promise<void> {
  const absolute = baselinePath(root, path);
  let metadata;
  try {
    metadata = await lstat(absolute);
  } catch {
    throw new BaselineOracleError(
      "BASELINE_HISTORICAL_TRACE_INVALID",
      `Historical ${kind} path is missing: ${path}`,
      path,
    );
  }
  const valid = kind === "implementation"
    ? metadata.isFile() || metadata.isDirectory()
    : metadata.isFile();
  if (!valid || metadata.isSymbolicLink()) {
    throw new BaselineOracleError(
      "BASELINE_HISTORICAL_TRACE_INVALID",
      `Historical ${kind} path is invalid: ${path}`,
      path,
    );
  }
}

/** @id CODE-AUTONOMOUS-HISTORICAL-TRACE-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-002
 * @design DES-AUTONOMOUS-DEVELOPMENT-014
 */
export async function verifyHistoricalTrace(
  root: string,
  mappingPath = "baseline-specs/oracle/historical-trace.json",
): Promise<{ requirementIds: string[] }> {
  let mapping: HistoricalTraceMapping;
  try {
    mapping = JSON.parse(
      (await readBaselineArtifact(root, mappingPath)).toString("utf8"),
    ) as HistoricalTraceMapping;
  } catch (cause) {
    if (cause instanceof BaselineOracleError) throw cause;
    throw new BaselineOracleError(
      "BASELINE_HISTORICAL_TRACE_INVALID",
      "Historical trace mapping is not valid JSON.",
      mappingPath,
    );
  }
  if (mapping.requirements) {
    const requirementIds = Object.keys(mapping.requirements).sort();
    if (
      requirementIds.length === 0 ||
      requirementIds.some((id) => {
        const entry = mapping.requirements?.[id];
        return !/^REQ-[A-Z0-9-]+$/.test(id) ||
          !entry?.implementationPaths?.length ||
          !entry.testPaths?.length;
      })
    ) {
      throw new BaselineOracleError(
        "BASELINE_HISTORICAL_TRACE_INVALID",
        "Explicit historical trace entries must provide implementation and test paths.",
        mappingPath,
      );
    }
    return { requirementIds };
  }
  if (
    mapping.schemaVersion !== 1 ||
    !mapping.sourceRoot ||
    !/^REQ-[A-Z0-9-]+$/.test(mapping.normalizedRequirement ?? "") ||
    !mapping.implementationPaths?.length ||
    !mapping.executingCompatibilityTestPaths?.length ||
    !mapping.mappingPolicy?.trim()
  ) {
    throw new BaselineOracleError(
      "BASELINE_HISTORICAL_TRACE_INVALID",
      "Historical trace policy mapping is incomplete.",
      mappingPath,
    );
  }
  const requirementIds = new Set<string>();
  for (const path of await historicalRequirementFiles(root, mapping.sourceRoot)) {
    const text = (await readBaselineArtifact(root, path)).toString("utf8");
    for (const match of text.matchAll(/^##\s+(REQ-[A-Z0-9-]+):/gm)) {
      if (requirementIds.has(match[1]!)) {
        throw new BaselineOracleError(
          "BASELINE_HISTORICAL_TRACE_INVALID",
          `Duplicate historical requirement ID: ${match[1]}`,
          path,
        );
      }
      requirementIds.add(match[1]!);
    }
  }
  if (requirementIds.size === 0) {
    throw new BaselineOracleError(
      "BASELINE_HISTORICAL_TRACE_INVALID",
      "Historical trace source contains no requirement IDs.",
      mapping.sourceRoot,
    );
  }
  for (const path of mapping.implementationPaths) {
    await requireHistoricalPath(root, path, "implementation");
  }
  for (const path of mapping.executingCompatibilityTestPaths) {
    await requireHistoricalPath(root, path, "test");
  }
  return { requirementIds: [...requirementIds].sort() };
}

/** @id CODE-AUTONOMOUS-ORACLE-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-001 REQ-AUTONOMOUS-DEVELOPMENT-002 REQ-AUTONOMOUS-DEVELOPMENT-013
 * @design DES-AUTONOMOUS-DEVELOPMENT-002 DES-AUTONOMOUS-DEVELOPMENT-005
 */
export async function verifyBaselineOracle(
  root: string,
  manifestPath = "baseline-specs/baseline.manifest.json",
): Promise<BaselineOracleVerification> {
  const manifestBytes = await readBaselineArtifact(root, manifestPath);
  let manifest: BaselineManifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8")) as BaselineManifest;
  } catch {
    throw new BaselineOracleError(
      "BASELINE_MANIFEST_INVALID",
      "Baseline manifest is not valid JSON.",
      manifestPath,
    );
  }
  if (
    manifest.schemaVersion !== 1 ||
    !manifest.upstream?.repository ||
    !/^[a-f0-9]{40}$/.test(manifest.upstream.commit ?? "") ||
    !manifest.procedure?.id ||
    !manifest.procedure.version ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length === 0 ||
    !manifest.attestation?.path ||
    !/^[a-f0-9]{64}$/.test(manifest.attestation.sha256 ?? "")
  ) {
    throw new BaselineOracleError(
      "BASELINE_MANIFEST_INVALID",
      "Baseline manifest does not satisfy schema version 1.",
      manifestPath,
    );
  }
  const seen = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (
      !artifact?.path ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "") ||
      seen.has(artifact.path)
    ) {
      throw new BaselineOracleError(
        "BASELINE_MANIFEST_INVALID",
        `Invalid or duplicate baseline artifact entry: ${artifact?.path ?? ""}`,
        manifestPath,
      );
    }
    seen.add(artifact.path);
  }
  const requiredKinds = [
    (path: string) =>
      path.includes("command-surface") || path.includes("cli-surface"),
    (path: string) => path.includes("/goldens/"),
    (path: string) => path.includes("historical-trace"),
    (path: string) => path.includes("test") || path.includes("fixture"),
  ];
  if (
    requiredKinds.some(
      (matches) =>
        !manifest.artifacts.some((artifact) => matches(artifact.path)),
    )
  ) {
    throw new BaselineOracleError(
      "BASELINE_MANIFEST_INCOMPLETE",
      "Baseline manifest must pin command surface, goldens, compatibility tests/fixtures, and historical trace artifacts.",
      manifestPath,
    );
  }
  for (const artifact of manifest.artifacts) {
    const bytes = await readBaselineArtifact(root, artifact.path);
    if (digest(bytes.toString("binary")) !== artifact.sha256) {
      throw new BaselineOracleError(
        "BASELINE_ARTIFACT_DIGEST_MISMATCH",
        `Baseline artifact digest mismatch: ${artifact.path}`,
        artifact.path,
      );
    }
  }
  const historicalTrace = manifest.artifacts.find((artifact) =>
    artifact.path.includes("historical-trace"));
  if (!historicalTrace) {
    throw new BaselineOracleError(
      "BASELINE_MANIFEST_INCOMPLETE",
      "Baseline manifest must pin a historical trace artifact.",
      manifestPath,
    );
  }
  await verifyHistoricalTrace(root, historicalTrace.path);
  const attestationBytes = await readBaselineArtifact(
    root,
    manifest.attestation.path,
  );
  if (
    digest(attestationBytes.toString("binary")) !== manifest.attestation.sha256
  ) {
    throw new BaselineOracleError(
      "BASELINE_ATTESTATION_DIGEST_MISMATCH",
      `Baseline attestation digest mismatch: ${manifest.attestation.path}`,
      manifest.attestation.path,
    );
  }
  let attestation: {
    schemaVersion: number;
    upstream?: { repository?: string; commit?: string };
    procedure?: { id?: string; version?: string };
    artifactDigest?: string;
  };
  try {
    attestation = JSON.parse(attestationBytes.toString("utf8"));
  } catch {
    throw new BaselineOracleError(
      "BASELINE_ATTESTATION_INVALID",
      "Baseline attestation is not valid JSON.",
      manifest.attestation.path,
    );
  }
  const artifactDigest = digest(stableJson(manifest.artifacts));
  if (
    attestation.schemaVersion !== 1 ||
    attestation.upstream?.repository !== manifest.upstream.repository ||
    attestation.upstream.commit !== manifest.upstream.commit ||
    attestation.procedure?.id !== manifest.procedure.id ||
    attestation.procedure.version !== manifest.procedure.version ||
    attestation.artifactDigest !== artifactDigest
  ) {
    throw new BaselineOracleError(
      "BASELINE_ATTESTATION_BINDING_MISMATCH",
      "Baseline attestation does not bind the pinned upstream, procedure, and canonical artifact digest.",
      manifest.attestation.path,
    );
  }
  const protectedPaths = [
    manifestPath,
    ...manifest.artifacts.map((artifact) => artifact.path),
    manifest.attestation.path,
  ].sort((a, b) => a.localeCompare(b));
  return {
    valid: true,
    manifestPath,
    upstream: manifest.upstream,
    procedure: manifest.procedure,
    protectedPaths,
    digest: digest(
      stableJson({
        manifestSha256: digest(manifestBytes.toString("binary")),
        protectedPaths,
        artifactDigest,
        attestationSha256: manifest.attestation.sha256,
      }),
    ),
  };
}

function literalText(node: ts.Expression | undefined): string | undefined {
  return node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function commandName(value: string): string {
  return value.trim().split(/\s+/u)[0] ?? "";
}

function optionName(value: string): string {
  return (
    value.match(/--[a-zA-Z0-9][a-zA-Z0-9-]*/u)?.[0] ??
    value.match(/-[a-zA-Z0-9]/u)?.[0] ??
    value.trim()
  );
}

type CommandChain = {
  root: ts.Expression;
  calls: Array<{ name: string; node: ts.CallExpression }>;
};

function commandChain(expression: ts.Expression): CommandChain | undefined {
  const calls: CommandChain["calls"] = [];
  let current = expression;
  while (
    ts.isCallExpression(current) &&
    ts.isPropertyAccessExpression(current.expression)
  ) {
    calls.unshift({ name: current.expression.name.text, node: current });
    current = current.expression.expression;
  }
  return calls.length > 0 ? { root: current, calls } : undefined;
}

/** @id CODE-AUTONOMOUS-SURFACE-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-001 REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-013
 * @design DES-AUTONOMOUS-DEVELOPMENT-014
 */
export async function extractDeclaredCommandSurface(
  root: string,
  entryPath: string,
): Promise<DeclaredCommandSurface> {
  const sourceBytes = await readBaselineArtifact(root, entryPath);
  const sourceText = sourceBytes.toString("utf8");
  const source = ts.createSourceFile(
    entryPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const variablePaths = new Map<string, string>();
  const literalValues = new Map<string, string>();
  const commands = new Map<string, Set<string>>();
  const wrapperOptions = new Map<string, string[]>();
  const visitedCommandRegistrations = new Set<number>();

  const fail = (node: ts.Node, message: string): never => {
    const location = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    );
    throw new CommandSurfaceError(
      "UNEXTRACTABLE_COMMAND_REGISTRATION",
      message,
      entryPath,
      location.line + 1,
    );
  };
  const ensureCommand = (path: string): Set<string> => {
    const options = commands.get(path) ?? new Set<string>();
    commands.set(path, options);
    return options;
  };
  const resolveLiteral = (
    node: ts.Expression | undefined,
  ): string | undefined => {
    const direct = literalText(node);
    if (direct !== undefined) return direct;
    if (node && ts.isIdentifier(node)) return literalValues.get(node.text);
    if (node && ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const span of node.templateSpans) {
        if (!ts.isIdentifier(span.expression)) return undefined;
        const substitution = literalValues.get(span.expression.text);
        if (substitution === undefined) return undefined;
        value += substitution + span.literal.text;
      }
      return value;
    }
    return undefined;
  };
  for (const statement of source.statements) {
    if (
      !ts.isFunctionDeclaration(statement) ||
      !statement.name ||
      !statement.body
    )
      continue;
    const parameter = statement.parameters[0]?.name;
    if (!parameter || !ts.isIdentifier(parameter)) continue;
    const options: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === "option" ||
          node.expression.name.text === "requiredOption")
      ) {
        const flags = literalText(node.arguments[0]);
        if (flags) options.push(optionName(flags));
      }
      ts.forEachChild(node, visit);
    };
    visit(statement.body);
    if (options.length > 0)
      wrapperOptions.set(statement.name.text, [...new Set(options)]);
  }
  const applyChain = (expression: ts.Expression): string | undefined => {
    if (
      ts.isCallExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.arguments[0] &&
      ts.isExpression(expression.arguments[0])
    ) {
      const wrappedPath = applyChain(expression.arguments[0]);
      if (wrappedPath !== undefined) {
        for (const option of wrapperOptions.get(expression.expression.text) ??
          []) {
          ensureCommand(wrappedPath).add(option);
        }
        return wrappedPath;
      }
    }
    const chain = commandChain(expression);
    if (!chain) return undefined;
    let path = ts.isIdentifier(chain.root)
      ? variablePaths.get(chain.root.text)
      : undefined;
    if (ts.isNewExpression(chain.root)) path = "";
    if (
      ts.isCallExpression(chain.root) &&
      ts.isIdentifier(chain.root.expression) &&
      chain.root.arguments[0] &&
      ts.isExpression(chain.root.arguments[0])
    ) {
      const wrappedPath = applyChain(chain.root.arguments[0]);
      if (wrappedPath !== undefined) {
        path = wrappedPath;
        for (const option of wrapperOptions.get(chain.root.expression.text) ??
          []) {
          ensureCommand(path).add(option);
        }
      }
    }
    if (path === undefined) return undefined;
    for (const call of chain.calls) {
      if (call.name === "name") {
        const name = literalText(call.node.arguments[0]);
        const declaredName =
          name ??
          fail(call.node, "Root command name must be a literal declaration.");
        if (path)
          fail(
            call.node,
            "Root command name must precede nested command registration.",
          );
        path = commandName(declaredName);
        ensureCommand(path);
      } else if (call.name === "command") {
        visitedCommandRegistrations.add(call.node.getStart(source));
        const name = resolveLiteral(call.node.arguments[0]);
        const declaredName =
          name ??
          fail(call.node, "Command registration must use a literal name.");
        if (!path)
          fail(
            call.node,
            "Command registration must use a known command variable.",
          );
        path = `${path} ${commandName(declaredName)}`;
        ensureCommand(path);
      } else if (call.name === "option" || call.name === "requiredOption") {
        const flags = literalText(call.node.arguments[0]);
        const declaredFlags =
          flags ??
          fail(call.node, "Option registration must use literal flags.");
        if (!path)
          fail(call.node, "Option registration must use a known command path.");
        ensureCommand(path).add(optionName(declaredFlags));
      }
    }
    return path;
  };

  const processStatements = (statements: readonly ts.Statement[]): void => {
    for (const statement of statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer) {
            const path = applyChain(declaration.initializer);
            if (path !== undefined)
              variablePaths.set(declaration.name.text, path);
          }
        }
      } else if (ts.isExpressionStatement(statement)) {
        applyChain(statement.expression);
      } else if (ts.isReturnStatement(statement) && statement.expression) {
        applyChain(statement.expression);
      } else if (ts.isFunctionDeclaration(statement) && statement.body) {
        let ownsCommandRoot = false;
        const findCommandRoot = (node: ts.Node): void => {
          if (
            ts.isNewExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "Command"
          )
            ownsCommandRoot = true;
          if (!ownsCommandRoot) ts.forEachChild(node, findCommandRoot);
        };
        findCommandRoot(statement.body);
        if (ownsCommandRoot) processStatements(statement.body.statements);
      } else if (ts.isBlock(statement)) {
        processStatements(statement.statements);
      } else if (ts.isForOfStatement(statement)) {
        const declaration = ts.isVariableDeclarationList(statement.initializer)
          ? statement.initializer.declarations[0]
          : undefined;
        const name = declaration?.name;
        let expression: ts.Expression = statement.expression;
        while (
          ts.isAsExpression(expression) ||
          ts.isParenthesizedExpression(expression)
        ) {
          expression = expression.expression;
        }
        const loopName =
          name && ts.isIdentifier(name)
            ? name.text
            : fail(
                statement,
                "Command registration loops require one identifier binding.",
              );
        const literalArray = ts.isArrayLiteralExpression(expression)
          ? expression
          : fail(
              statement,
              "Command registration loops must iterate a literal string array.",
            );
        const values = literalArray.elements.map((element) =>
          ts.isExpression(element) ? resolveLiteral(element) : undefined,
        );
        if (values.some((value) => value === undefined)) {
          fail(
            statement,
            "Command registration loops must contain only literal string values.",
          );
        }
        const literalStrings = values.map(
          (value) =>
            value ??
            fail(
              statement,
              "Command registration loops must contain only literal string values.",
            ),
        );
        const previous = literalValues.get(loopName);
        for (const value of literalStrings) {
          literalValues.set(loopName, value);
          if (ts.isBlock(statement.statement))
            processStatements(statement.statement.statements);
          else processStatements([statement.statement]);
        }
        if (previous === undefined) literalValues.delete(loopName);
        else literalValues.set(loopName, previous);
      }
    }
  };
  processStatements(source.statements);
  const dynamicRegistration = source.statements
    .flatMap((statement) => {
      const found: ts.CallExpression[] = [];
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "command"
        )
          found.push(node);
        ts.forEachChild(node, visit);
      };
      visit(statement);
      return found;
    })
    .find((call) => !visitedCommandRegistrations.has(call.getStart(source)));
  if (dynamicRegistration)
    fail(
      dynamicRegistration,
      "Computed command registration is not statically extractable.",
    );
  if (commands.size === 0) {
    throw new CommandSurfaceError(
      "UNEXTRACTABLE_COMMAND_REGISTRATION",
      "No supported declarative Commander registration was found.",
      entryPath,
    );
  }
  const normalized = [...commands.entries()]
    .map(([path, options]) => ({
      path,
      options: [...options].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    schemaVersion: 1,
    commands: normalized,
    digest: digest(stableJson(normalized)),
  };
}

function topLevelCommandPaths(
  surface: Pick<DeclaredCommandSurface, "commands">,
): string[] {
  return surface.commands
    .map((command) => command.path.trim())
    .filter((path) => path.split(/\s+/u).length === 2)
    .sort((a, b) => a.localeCompare(b));
}

function commandSuffix(path: string): string {
  return path.trim().split(/\s+/u).slice(1).join(" ");
}

/** @id CODE-AUTONOMOUS-INVENTORY-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-013
 * @design DES-AUTONOMOUS-DEVELOPMENT-014
 */
export function validateStaticCommandInventory(
  upstreamSurface: Pick<DeclaredCommandSurface, "commands">,
  candidateSurface: Pick<DeclaredCommandSurface, "commands">,
  input: unknown,
): StaticCommandInventoryValidation {
  if (!input || typeof input !== "object") {
    throw new CommandInventoryError(
      "COMMAND_INVENTORY_MALFORMED",
      "Command collision inventory must be an object.",
    );
  }
  const inventory = input as Partial<CommandCollisionInventory>;
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.entries)) {
    throw new CommandInventoryError(
      "COMMAND_INVENTORY_MALFORMED",
      "Command collision inventory must use schema version 1 and an entries array.",
    );
  }
  const classifications = new Set<CommandCollisionClassification>([
    "inherited",
    "musubix4-only",
    "additive-resolution",
  ]);
  const entries: CommandCollisionInventory["entries"] = inventory.entries.map(
    (entry, index) => {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof entry.path !== "string" ||
        !entry.path.trim() ||
        !classifications.has(entry.classification) ||
        !Array.isArray(entry.invocation) ||
        entry.invocation.length === 0 ||
        entry.invocation.some(
          (argument) => typeof argument !== "string" || argument.length === 0,
        )
      ) {
        throw new CommandInventoryError(
          "COMMAND_INVENTORY_MALFORMED",
          `Command collision inventory entry ${index + 1} is invalid.`,
        );
      }
      return {
        path: entry.path.trim(),
        classification: entry.classification,
        invocation: [...entry.invocation],
      };
    },
  );
  const paths = new Set<string>();
  for (const entry of entries) {
    if (paths.has(entry.path)) {
      throw new CommandInventoryError(
        "COMMAND_INVENTORY_DUPLICATE_ENTRY",
        `Command collision inventory contains duplicate path: ${entry.path}`,
        [entry.path],
      );
    }
    paths.add(entry.path);
  }
  const candidatePaths = topLevelCommandPaths(candidateSurface);
  const missing = candidatePaths.filter((path) => !paths.has(path));
  if (missing.length > 0) {
    throw new CommandInventoryError(
      "COMMAND_INVENTORY_MISSING_PATH",
      `Command collision inventory is missing candidate paths: ${missing.join(", ")}`,
      missing,
    );
  }
  const candidateSet = new Set(candidatePaths);
  const upstreamSuffixes = new Set(
    topLevelCommandPaths(upstreamSurface).map(commandSuffix),
  );
  const stale = entries
    .map((entry) => entry.path)
    .filter(
      (path) =>
        !candidateSet.has(path) && !upstreamSuffixes.has(commandSuffix(path)),
    )
    .sort((a, b) => a.localeCompare(b));
  if (stale.length > 0) {
    throw new CommandInventoryError(
      "COMMAND_INVENTORY_STALE_ENTRY",
      `Command collision inventory contains stale paths: ${stale.join(", ")}`,
      stale,
    );
  }
  const pinnedInvocations = entries
    .map((entry) => ({
      path: entry.path,
      classification: entry.classification,
      argv: [...entry.invocation],
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    valid: true,
    pinnedInvocations,
    digest: digest(
      stableJson({
        schemaVersion: 1,
        entries: pinnedInvocations,
        upstreamPaths: topLevelCommandPaths(upstreamSurface),
        candidatePaths,
      }),
    ),
  };
}

async function baselineFiles(
  root: string,
  relativeDirectory = "baseline-specs",
): Promise<string[]> {
  const absoluteDirectory = baselinePath(root, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch {
    throw new ProtectedSetError(
      "PROTECTED_SET_PATH_MISSING",
      `Protected baseline directory is missing: ${relativeDirectory}`,
      relativeDirectory,
    );
  }
  const paths: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${relativeDirectory}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new ProtectedSetError(
        "PROTECTED_SET_PATH_INVALID",
        `Protected path must not be a symbolic link: ${path}`,
        path,
      );
    }
    if (entry.isDirectory()) paths.push(...(await baselineFiles(root, path)));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

/** @id CODE-AUTONOMOUS-PROTECTED-SET-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-018
 * @design DES-AUTONOMOUS-DEVELOPMENT-005 DES-AUTONOMOUS-DEVELOPMENT-012
 */
export async function computeProtectedSet(
  root: string,
  manifestEnumeratedPaths: string[],
  overrides: Record<string, Buffer> = {},
): Promise<{ paths: string[]; digest: string }> {
  const paths = [
    ...new Set([
      ...(await baselineFiles(root)),
      ".musubix/compatibility/command-collisions.json",
      ...manifestEnumeratedPaths,
    ]),
  ].sort((a, b) => a.localeCompare(b));
  const entries: Array<{ path: string; sha256: string }> = [];
  for (const path of paths) {
    try {
      const bytes = overrides[path] ?? (await readBaselineArtifact(root, path));
      entries.push({
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    } catch (cause) {
      if (cause instanceof BaselineOracleError) {
        throw new ProtectedSetError(
          cause.code === "BASELINE_ARTIFACT_MISSING"
            ? "PROTECTED_SET_PATH_MISSING"
            : "PROTECTED_SET_PATH_INVALID",
          cause.message,
          path,
        );
      }
      throw cause;
    }
  }
  return { paths, digest: digest(stableJson(entries)) };
}

function redactText(value: string, secrets: string[]): string {
  return secrets
    .filter(Boolean)
    .reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value);
}

function boundedAppend(
  current: string,
  chunk: Buffer,
  limit: number,
): { value: string; truncated: boolean } {
  if (Buffer.byteLength(current) >= limit)
    return { value: current, truncated: true };
  const remaining = limit - Buffer.byteLength(current);
  const bytes = chunk.subarray(0, remaining);
  return {
    value: current + bytes.toString("utf8"),
    truncated: bytes.length < chunk.length,
  };
}

/** @id CODE-HOH-PROCESS-002
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-004 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-015 REQ-AUTONOMOUS-DEVELOPMENT-017
 * @design DES-AUTONOMOUS-DEVELOPMENT-006 DES-AUTONOMOUS-DEVELOPMENT-011 DES-AUTONOMOUS-DEVELOPMENT-013
 */
export async function runBoundedProcess(input: {
  argv: string[];
  cwd: string;
  environment?: Record<string, string>;
  omitEnvironment?: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  policy: EffectiveRolePolicy;
  secretValues?: string[];
}): Promise<CommandRecord> {
  if (!input.argv.length || input.argv.some((part) => part.includes("\0")))
    throw new Error("Process argv must be a nonempty NUL-free array.");
  const cwd = resolve(input.cwd);
  const started = Date.now();
  const environment = { ...process.env, ...input.environment };
  for (const name of input.omitEnvironment ?? []) delete environment[name];
  const child = spawn(input.argv[0]!, input.argv.slice(1), {
    cwd,
    shell: false,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let truncated = false;
  child.stdout.on("data", (chunk: Buffer) => {
    const next = boundedAppend(stdout, chunk, input.maxOutputBytes);
    stdout = next.value;
    truncated ||= next.truncated;
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const next = boundedAppend(stderr, chunk, input.maxOutputBytes);
    stderr = next.value;
    truncated ||= next.truncated;
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, input.timeoutMs);
  const exitCode = await new Promise<number | null>((accept, reject) => {
    child.once("error", reject);
    child.once("close", accept);
  }).finally(() => clearTimeout(timer));
  const secrets = input.secretValues ?? [];
  return {
    schemaVersion: 1,
    argv: input.argv.map((part) => redactText(part, secrets)),
    cwd,
    exitCode,
    stdout: redactText(stdout, secrets),
    stderr: redactText(stderr, secrets),
    durationMs: Date.now() - started,
    timedOut,
    truncated,
    policyDigest: input.policy.digest,
    residualRisks: input.policy.residualRisks,
  };
}

function record(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${location} must be an object.`);
  return value as Record<string, unknown>;
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: string[],
  location: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`Unknown ${location} key: ${unknown}.`);
}

function positive(value: unknown, fallback: number, location: string): number {
  const resolved = value === undefined ? fallback : value;
  if (
    typeof resolved !== "number" ||
    !Number.isFinite(resolved) ||
    resolved <= 0
  ) {
    throw new Error(`${location} must be a positive number.`);
  }
  return resolved;
}

const copilotVersionTokenPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function extractCopilotVersion(output: string): string | undefined {
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\t\v\f\r ]+|[\t\v\f\r ]+$/g, "");
    const candidate = line.endsWith(".") ? line.slice(0, -1) : line;
    if (copilotVersionTokenPattern.test(candidate)) return candidate;
    const banner = candidate.match(
      /^GitHub Copilot CLI (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/,
    );
    if (banner) return banner[1];
  }
  return undefined;
}

function isSupportedCopilotVersion(version: string): boolean {
  const [major, minor, patch] = version.split(/[+-]/, 1)[0]!.split(".").map(Number);
  return (
    major! > 1 ||
    (major === 1 && (minor! > 0 || (minor === 0 && patch! >= 86)))
  );
}

/** @id CODE-HOH-CONFIG-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-002 REQ-AUTONOMOUS-DEVELOPMENT-004 REQ-AUTONOMOUS-DEVELOPMENT-010 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-015 REQ-AUTONOMOUS-DEVELOPMENT-016 REQ-AUTONOMOUS-DEVELOPMENT-017
 * @design DES-AUTONOMOUS-DEVELOPMENT-002
 */
export function parseHohConfig(input: unknown): HohConfig {
  const value = record(input, "hoh config");
  rejectUnknown(
    value,
    [
      "model",
      "reasoning",
      "copilotCliVersion",
      "budget",
      "commands",
      "limits",
      "maxSpecificationBytes",
      "maxIndexEntries",
      "roleInvocationReservedCredits",
      "roleInvocationTimeoutMs",
      "commandTimeoutMs",
      "maxCommandOutputBytes",
      "candidateExtraPaths",
      "dependencyProvisioning",
      "permissions",
      "qaChecks",
      "approval",
    ],
    "hoh config",
  );
  if (typeof value.model !== "string" || !value.model.trim())
    throw new Error("hoh.model is required.");
  if (
    value.copilotCliVersion !== undefined &&
    (typeof value.copilotCliVersion !== "string" ||
      !copilotVersionTokenPattern.test(value.copilotCliVersion) ||
      !isSupportedCopilotVersion(value.copilotCliVersion))
  ) {
    throw new Error(
      "hoh.copilotCliVersion must be a semantic version at or above 1.0.86.",
    );
  }
  const budget = record(value.budget, "hoh.budget");
  rejectUnknown(budget, ["aiCredits"], "hoh.budget");
  const commands = record(value.commands, "hoh.commands");
  if (!Object.keys(commands).length)
    throw new Error(
      "hoh.commands must configure at least one project command.",
    );
  const parsedCommands = Object.fromEntries(
    Object.entries(commands).map(([name, command]) => {
      if (
        !Array.isArray(command) ||
        command.length === 0 ||
        !command.every(
          (part) => typeof part === "string" && !part.includes("\0"),
        )
      ) {
        throw new Error(
          `hoh.commands.${name} must be a nonempty string array.`,
        );
      }
      return [name, [...command] as string[]];
    }),
  );
  const limits = record(value.limits ?? {}, "hoh.limits");
  rejectUnknown(
    limits,
    [
      "maxIterations",
      "maxActiveHours",
      "stagnantIterations",
      "roleOutputRetryLimit",
      "blockerRepairRetryLimit",
      "amendmentRetryLimit",
      "maxAmendmentEpisodes",
    ],
    "hoh.limits",
  );
  const permissions = record(value.permissions ?? {}, "hoh.permissions");
  rejectUnknown(
    permissions,
    ["planner", "developer", "qa", "reviewer", "deployment"],
    "hoh.permissions",
  );
  const approval = record(value.approval ?? {}, "hoh.approval");
  rejectUnknown(
    approval,
    ["mode", "boundaryAttemptLimit", "maxManifestBytes", "maxManifestPaths"],
    "hoh.approval",
  );
  if (approval.mode !== undefined && approval.mode !== "verified-auto") {
    throw new Error("hoh.approval.mode must be verified-auto.");
  }
  const qaChecks = record(value.qaChecks ?? {}, "hoh.qaChecks");
  rejectUnknown(qaChecks, mandatoryQaCheckIds, "hoh.qaChecks");
  const parsedQaChecks = Object.fromEntries(
    Object.entries(qaChecks).map(([name, command]) => {
      if (
        !Array.isArray(command) ||
        command.length === 0 ||
        !command.every(
          (part) => typeof part === "string" && !part.includes("\0"),
        )
      ) {
        throw new Error(
          `hoh.qaChecks.${name} must be a nonempty string array.`,
        );
      }
      return [name, [...command] as string[]];
    }),
  ) as Partial<Record<MandatoryQaCheckId, string[]>>;
  const dependencyProvisioning =
    value.dependencyProvisioning === undefined
      ? undefined
      : record(value.dependencyProvisioning, "hoh.dependencyProvisioning");
  if (dependencyProvisioning) {
    rejectUnknown(
      dependencyProvisioning,
      ["lockfilePath", "command", "writablePaths"],
      "hoh.dependencyProvisioning",
    );
    if (
      !Array.isArray(dependencyProvisioning.command) ||
      dependencyProvisioning.command.length === 0 ||
      !dependencyProvisioning.command.every(
        (part) => typeof part === "string" && !part.includes("\0"),
      )
    ) {
      throw new Error(
        "hoh.dependencyProvisioning.command must be a nonempty string array.",
      );
    }
    if (
      !Array.isArray(dependencyProvisioning.writablePaths) ||
      dependencyProvisioning.writablePaths.length === 0 ||
      !dependencyProvisioning.writablePaths.every(
        (path) => typeof path === "string" && path.length > 0,
      )
    ) {
      throw new Error(
        "hoh.dependencyProvisioning.writablePaths must be a nonempty string array.",
      );
    }
    if (
      dependencyProvisioning.lockfilePath !== undefined &&
      (typeof dependencyProvisioning.lockfilePath !== "string" ||
        !dependencyProvisioning.lockfilePath)
    ) {
      throw new Error(
        "hoh.dependencyProvisioning.lockfilePath must be a repository-relative path.",
      );
    }
  }
  return {
    model: value.model,
    ...(typeof value.reasoning === "string"
      ? { reasoning: value.reasoning }
      : {}),
    ...(typeof value.copilotCliVersion === "string"
      ? { copilotCliVersion: value.copilotCliVersion }
      : {}),
    budget: {
      aiCredits: positive(budget.aiCredits, 0, "hoh.budget.aiCredits"),
    },
    approval: {
      mode: "verified-auto",
      boundaryAttemptLimit: positive(
        approval.boundaryAttemptLimit,
        3,
        "hoh.approval.boundaryAttemptLimit",
      ),
      maxManifestBytes: positive(
        approval.maxManifestBytes,
        16_777_216,
        "hoh.approval.maxManifestBytes",
      ),
      maxManifestPaths: positive(
        approval.maxManifestPaths,
        2_000,
        "hoh.approval.maxManifestPaths",
      ),
    },
    commands: parsedCommands,
    qaChecks: parsedQaChecks,
    limits: {
      maxIterations: positive(
        limits.maxIterations,
        30,
        "hoh.limits.maxIterations",
      ),
      maxActiveHours: positive(
        limits.maxActiveHours,
        24,
        "hoh.limits.maxActiveHours",
      ),
      stagnantIterations: positive(
        limits.stagnantIterations,
        3,
        "hoh.limits.stagnantIterations",
      ),
      roleOutputRetryLimit: positive(
        limits.roleOutputRetryLimit,
        2,
        "hoh.limits.roleOutputRetryLimit",
      ),
      blockerRepairRetryLimit: positive(
        limits.blockerRepairRetryLimit,
        2,
        "hoh.limits.blockerRepairRetryLimit",
      ),
      amendmentRetryLimit: positive(
        limits.amendmentRetryLimit,
        2,
        "hoh.limits.amendmentRetryLimit",
      ),
      maxAmendmentEpisodes: positive(
        limits.maxAmendmentEpisodes,
        3,
        "hoh.limits.maxAmendmentEpisodes",
      ),
    },
    maxSpecificationBytes: positive(
      value.maxSpecificationBytes,
      1_048_576,
      "hoh.maxSpecificationBytes",
    ),
    maxIndexEntries: positive(
      value.maxIndexEntries,
      200,
      "hoh.maxIndexEntries",
    ),
    roleInvocationReservedCredits: positive(
      value.roleInvocationReservedCredits,
      1,
      "hoh.roleInvocationReservedCredits",
    ),
    roleInvocationTimeoutMs: positive(
      value.roleInvocationTimeoutMs,
      120_000,
      "hoh.roleInvocationTimeoutMs",
    ),
    commandTimeoutMs: positive(
      value.commandTimeoutMs,
      120_000,
      "hoh.commandTimeoutMs",
    ),
    maxCommandOutputBytes: positive(
      value.maxCommandOutputBytes,
      1_048_576,
      "hoh.maxCommandOutputBytes",
    ),
    candidateExtraPaths:
      Array.isArray(value.candidateExtraPaths) &&
      value.candidateExtraPaths.every((item) => typeof item === "string")
        ? ([...value.candidateExtraPaths] as string[])
        : [],
    ...(dependencyProvisioning
      ? {
          dependencyProvisioning: {
            ...(typeof dependencyProvisioning.lockfilePath === "string"
              ? { lockfilePath: dependencyProvisioning.lockfilePath }
              : {}),
            command: [...(dependencyProvisioning.command as string[])],
            writablePaths: [
              ...(dependencyProvisioning.writablePaths as string[]),
            ],
          },
        }
      : {}),
    permissions: permissions as HohConfig["permissions"],
  };
}

/** @id CODE-AUTONOMOUS-HOH-CONFIG-FILE-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-004
 * @design DES-AUTONOMOUS-DEVELOPMENT-003
 */
export async function loadHohConfigFile(
  root: string,
): Promise<HohConfig | undefined> {
  const path = resolve(root, ".musubix/hoh.json");
  try {
    return parseHohConfig(JSON.parse(await readFile(path, "utf8")));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw cause;
  }
}

/** @id CODE-AUTONOMOUS-QA-CONFIG-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-015
 * @design DES-AUTONOMOUS-DEVELOPMENT-002 DES-AUTONOMOUS-DEVELOPMENT-011
 */
export function validateMandatoryQaConfiguration(
  config: HohConfig,
): Record<MandatoryQaCheckId, string[]> {
  for (const id of mandatoryQaCheckIds) {
    const command = config.qaChecks[id];
    if (!Array.isArray(command) || command.length === 0) {
      throw new Error(`Mandatory QA check is not configured: ${id}`);
    }
  }
  return Object.fromEntries(
    mandatoryQaCheckIds.map((id) => [id, [...config.qaChecks[id]!]]),
  ) as Record<MandatoryQaCheckId, string[]>;
}

/** @id CODE-HOH-POLICY-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-017
 * @design DES-AUTONOMOUS-DEVELOPMENT-002 DES-AUTONOMOUS-DEVELOPMENT-011
 */
export function derivePolicy(
  role: HohRole,
  configuration: PolicyOverrides,
): EffectiveRolePolicy {
  const defaults: Record<
    HohRole,
    Omit<EffectiveRolePolicy, "role" | "digest" | "residualRisks">
  > = {
    planner: {
      allowPaths: [],
      allowUrls: [],
      allowMcpServers: [],
      allowTools: ["read"],
      allowSecrets: [],
      allowProjectCommands: false,
      allowWrite: false,
      network: "deny",
    },
    developer: {
      allowPaths: ["."],
      allowUrls: [],
      allowMcpServers: [],
      allowTools: ["read", "write"],
      allowSecrets: [],
      allowProjectCommands: true,
      allowWrite: true,
      network: "deny",
    },
    qa: {
      allowPaths: ["."],
      allowUrls: [],
      allowMcpServers: [],
      allowTools: ["read"],
      allowSecrets: [],
      allowProjectCommands: true,
      allowWrite: false,
      network: "deny",
    },
    reviewer: {
      allowPaths: [],
      allowUrls: [],
      allowMcpServers: [],
      allowTools: ["read"],
      allowSecrets: [],
      allowProjectCommands: false,
      allowWrite: false,
      network: "deny",
    },
    deployment: {
      allowPaths: ["."],
      allowUrls: [],
      allowMcpServers: [],
      allowTools: [],
      allowSecrets: [],
      allowProjectCommands: true,
      allowWrite: false,
      network: "deny",
    },
  };
  const base = defaults[role];
  const effective = {
    ...base,
    ...configuration,
    allowPaths: [...(configuration.allowPaths ?? base.allowPaths)],
    allowUrls: [...(configuration.allowUrls ?? base.allowUrls)],
    allowMcpServers: [
      ...(configuration.allowMcpServers ?? base.allowMcpServers),
    ],
    allowTools: [...(configuration.allowTools ?? base.allowTools)],
    allowSecrets: [...(configuration.allowSecrets ?? base.allowSecrets)],
  };
  const unknownCapability = effective.allowTools.find(
    (capability) => capability !== "read" && capability !== "write",
  );
  if (unknownCapability)
    throw new Error(`Unknown Copilot policy capability: ${unknownCapability}.`);
  if (role !== "developer" && effective.allowTools.includes("write"))
    throw new Error(
      `Copilot allowTools write capability is restricted to Developer; adapter allowWrite does not grant it.`,
    );
  if (role !== "deployment" && !effective.allowTools.length)
    throw new Error(
      `Copilot ${role} policy requires a non-empty available tool capability set.`,
    );
  if (
    effective.allowTools.includes("write") &&
    !effective.allowTools.includes("read")
  )
    throw new Error("Copilot write capability requires read capability.");
  if (effective.allowTools.includes("write") && !effective.allowWrite)
    throw new Error(
      "Copilot write capability requires effective allowWrite to be true.",
    );
  const residualRisks = Object.entries(configuration)
    .flatMap(([key, value]) => {
      if (Array.isArray(value)) return value.map((item) => `${key}:${item}`);
      return value === undefined ||
        value === (base as unknown as Record<string, unknown>)[key]
        ? []
        : [`${key}:${String(value)}`];
    })
    .sort();
  const payload = { role, ...effective, residualRisks };
  return { ...payload, digest: digest(stableJson(payload)) };
}

function normalizedLines(
  source: SpecificationSource["kind"],
  content: string,
  sourceDigest: string,
): PublicRequirement[] {
  if (source === "prompt")
    return [
      {
        id: `REQ-PUBLIC-${sourceDigest.slice(0, 12).toUpperCase()}-001`,
        statement: content.trim(),
        ordinal: 1,
      },
    ];
  if (source === "musubix") {
    const found = [
      ...content.matchAll(
        /^##\s+(REQ-[A-Z0-9-]+):[^\n]*\n(?:.*\n)*?Statement:\s*(.+)$/gm,
      ),
    ];
    return found.map((match, index) => ({
      id: match[1]!,
      statement: match[2]!.trim(),
      ordinal: index + 1,
    }));
  }
  const values = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^[-*]\s+\[[ xX]\]\s+/, "")
        .trim(),
    )
    .filter(Boolean);
  return values.map((statement, index) => ({
    id: `REQ-PUBLIC-${sourceDigest.slice(0, 12).toUpperCase()}-${String(index + 1).padStart(3, "0")}`,
    statement,
    ordinal: index + 1,
  }));
}

/** @id CODE-HOH-SPECIFICATION-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-003 REQ-AUTONOMOUS-DEVELOPMENT-008 REQ-AUTONOMOUS-DEVELOPMENT-013
 * @design DES-AUTONOMOUS-DEVELOPMENT-003
 */
export async function materializeSpecification(
  root: string,
  source: SpecificationSource,
  limit: number,
): Promise<PublicSpecification> {
  return materializeSpecificationWithServices(root, source, limit, {});
}

/** @id CODE-HOH-GITHUB-ISSUE-002
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-003 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-015
 * @design DES-AUTONOMOUS-DEVELOPMENT-003 DES-AUTONOMOUS-DEVELOPMENT-011
 */
export async function materializeSpecificationWithServices(
  root: string,
  source: SpecificationSource,
  limit: number,
  services: {
    github?: {
      loadIssue(
        source: Extract<SpecificationSource, { kind: "github-issue" }>,
      ): Promise<{ locator: string; content: string }>;
    };
  },
): Promise<PublicSpecification> {
  const remote =
    source.kind === "github-issue"
      ? await services.github?.loadIssue(source)
      : undefined;
  if (source.kind === "github-issue" && !remote)
    throw new Error(
      "GitHub Issue materialization requires an injected GitHub service.",
    );
  const content =
    source.kind === "prompt"
      ? source.text
      : source.kind === "github-issue"
        ? remote!.content
        : await readFile(resolve(root, source.path), "utf8");
  if (Buffer.byteLength(content) > limit)
    throw new Error(`Specification exceeds maxSpecificationBytes (${limit}).`);
  const sourceDigest = digest(content);
  const locator =
    source.kind === "prompt"
      ? `prompt:sha256:${sourceDigest}`
      : source.kind === "github-issue"
        ? remote!.locator
        : resolve(root, source.path);
  const promptRegion = `<MUSUBIX-DATA digest="${sourceDigest}">\n${content.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}\n</MUSUBIX-DATA>`;
  const path = resolve(
    root,
    ".musubix4/specifications",
    `${sourceDigest}.json`,
  );
  const specification: PublicSpecification = {
    schemaVersion: 1,
    source: source.kind,
    locator,
    digest: sourceDigest,
    content,
    promptRegion,
    requirements: normalizedLines(source.kind, content, sourceDigest),
    path,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(specification, null, 2)}\n`, {
    mode: 0o444,
  });
  await chmod(path, 0o444);
  return Object.freeze({
    ...specification,
    requirements: Object.freeze(
      specification.requirements,
    ) as unknown as PublicRequirement[],
  });
}

function copilotArgs(
  role: HohRole,
  prompt: string,
  config: HohConfig,
  policy: EffectiveRolePolicy,
): string[] {
  const args = [
    "-p",
    prompt,
    "--model",
    config.model,
    "--output-format",
    "json",
    "--stream",
    "off",
    "--no-ask-user",
    "--no-custom-instructions",
    "--disallow-temp-dir",
    "--max-ai-credits",
    String(config.budget.aiCredits),
    "--name",
    `musubix4-${role}-${randomUUID()}`,
  ];
  if (config.reasoning) args.push("--reasoning-effort", config.reasoning);
  if (policy.allowPaths.length)
    for (const path of policy.allowPaths) args.push("--add-dir", path);
  if (policy.allowSecrets.length)
    args.push("--secret-env-vars", policy.allowSecrets.join(","));
  if (policy.allowUrls.length) args.push("--allow-url", ...policy.allowUrls);
  if (!policy.allowMcpServers.length) args.push("--disable-builtin-mcps");
  const availableTools = policy.allowTools.flatMap((capability) =>
    capability === "read"
      ? ["view", "grep", "glob"]
      : ["apply_patch"],
  );
  if (availableTools.length)
    args.push("--available-tools", ...availableTools);
  if (policy.allowTools.includes("write")) args.push("--allow-tool", "write");
  args.push("--deny-tool", "shell");
  return args;
}

function jsonLines(text: string): Record<string, unknown>[] {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return record(JSON.parse(line), "Copilot JSONL event");
      } catch {
        throw new Error("Copilot returned malformed JSONL.");
      }
    });
}

const nanoAiuPerCredit = 1_000_000_000;

function creditsToNanoAiu(credits: number): number {
  const nanoAiu = Math.trunc(credits * nanoAiuPerCredit);
  if (!Number.isSafeInteger(nanoAiu) || nanoAiu < 0) {
    throw new Error("Copilot credit value cannot be represented as nano-AIU.");
  }
  return nanoAiu;
}

class CopilotRoleInvocationError extends Error {
  override readonly name: string = "CopilotRoleInvocationError";

  constructor(
    message: string,
    readonly records: CommandRecord[] = [],
  ) {
    super(message);
  }
}

class CopilotRoleConfigurationError extends CopilotRoleInvocationError {
  override readonly name = "CopilotRoleConfigurationError";
}

function parseCopilotRoleEvents(
  events: Record<string, unknown>[],
  reservedNanoAiu: number,
  configuredModel: string,
  configuredReasoning?: string,
  configuredVersion?: string,
): { value: unknown; actualNanoAiu: number; displayCredits: number } {
  const configurationFailure = events.find((event) => {
    if (event.type !== "session.info") return false;
    if (!event.data || typeof event.data !== "object" || Array.isArray(event.data))
      return false;
    const data = event.data as Record<string, unknown>;
    return (
      data.infoType === "configuration" &&
      typeof data.message === "string" &&
      data.message.includes("Unknown tool name in the tool allowlist")
    );
  });
  if (configurationFailure)
    throw new CopilotRoleConfigurationError(
      "Copilot role configuration failed: unknown tool name in the tool allowlist.",
    );
  const current = events.some((event) => {
    if (event.type === "session.usage_checkpoint") return true;
    if (event.type !== "assistant.message") return false;
    if (!event.data || typeof event.data !== "object" || Array.isArray(event.data))
      return false;
    const data = event.data as Record<string, unknown>;
    return data.phase === "final_answer";
  });
  if (!current) {
    const usageEvents = events.filter((event) => event.type === "usage");
    if (!usageEvents.length) throw new Error("Copilot JSONL omitted usage.");
    const usage = usageEvents.reduce(
      (sum, event) =>
        sum + (typeof event.aiCredits === "number" ? event.aiCredits : 0),
      0,
    );
    if (
      !Number.isFinite(usage) ||
      usage < 0 ||
      usageEvents.some(
        (event) => typeof event.aiCredits !== "number" || event.aiCredits < 0,
      )
    ) {
      throw new Error("Copilot JSONL usage is invalid.");
    }
    for (const metadata of usageEvents) {
      if (metadata.model !== configuredModel)
        throw new Error("Copilot model drift detected.");
      if (configuredReasoning && metadata.reasoning !== configuredReasoning)
        throw new Error("Copilot reasoning drift detected.");
      if (configuredVersion && metadata.version !== configuredVersion)
        throw new Error("Copilot CLI version drift detected in JSONL.");
    }
    const resultEvents = events.filter((event) => event.type === "result");
    if (
      resultEvents.length !== 1 ||
      !Object.hasOwn(resultEvents[0]!, "result")
    ) {
      throw new Error(
        resultEvents.length > 1
          ? "Copilot JSONL returned ambiguous results."
          : "Copilot JSONL omitted a result event.",
      );
    }
    return {
      value: resultEvents[0]!.result,
      actualNanoAiu: creditsToNanoAiu(usage),
      displayCredits: usage,
    };
  }

  const resultEvents = events.filter((event) => event.type === "result");
  const resultEvent = resultEvents[0];
  if (
    resultEvents.length !== 1 ||
    resultEvent !== events.at(-1) ||
    resultEvent?.exitCode !== 0
  ) {
    throw new Error("Copilot current JSONL requires one final successful result.");
  }
  const finalAnswers = events.filter((event) => {
    if (event.type !== "assistant.message") return false;
    if (!event.data || typeof event.data !== "object" || Array.isArray(event.data))
      return false;
    return (event.data as Record<string, unknown>).phase === "final_answer";
  });
  const finalAnswer = finalAnswers.at(-1);
  if (!finalAnswer) throw new Error("Copilot current JSONL omitted a final answer.");
  for (const event of finalAnswers) {
    const data = record(event.data, "Copilot final answer");
    if (data.model !== configuredModel)
      throw new Error("Copilot model drift detected.");
  }
  const content = record(finalAnswer.data, "Copilot final answer").content;
  if (typeof content !== "string")
    throw new Error("Copilot final answer content is invalid.");
  const value = parseCopilotFinalAnswerContent(content);

  let previousNanoAiu = 0;
  let actualNanoAiu = reservedNanoAiu;
  const checkpoints = events.filter(
    (event) => event.type === "session.usage_checkpoint",
  );
  for (const event of checkpoints) {
    const data = record(event.data, "Copilot usage checkpoint");
    const checkpoint = data.totalNanoAiu;
    if (
      typeof checkpoint !== "number" ||
      !Number.isSafeInteger(checkpoint) ||
      checkpoint < previousNanoAiu
    ) {
      throw new Error("Copilot current JSONL usage is invalid or decreasing.");
    }

    previousNanoAiu = checkpoint;
    actualNanoAiu = checkpoint;
  }
  return {
    value,
    actualNanoAiu,
    displayCredits: actualNanoAiu / nanoAiuPerCredit,
  };
}

/** @id CODE-HOH-COPILOT-FINAL-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-004
 * @design DES-AUTONOMOUS-DEVELOPMENT-006
 */
export function parseCopilotFinalAnswerContent(content: string): unknown {
  const trimmed = content.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, "");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fenced = /^```json(?:\r\n|\n)([\s\S]*)(?:\r\n|\n)```$/.exec(
      trimmed,
    );
    if (fenced) {
      try {
        return JSON.parse(fenced[1]!) as unknown;
      } catch {
        // Fall through to the stable role-output diagnostic.
      }
    }
  }
  throw new Error("Copilot final answer content is not valid JSON.");
}

/** @id CODE-AUTONOMOUS-QA-ADAPTER-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-015
 * @design DES-AUTONOMOUS-DEVELOPMENT-009 DES-AUTONOMOUS-DEVELOPMENT-011
 */
export async function runMandatoryProjectChecks(input: {
  cwd: string;
  commands: Record<MandatoryQaCheckId, string[]>;
  timeoutMs: number;
  maxOutputBytes: number;
  policy: EffectiveRolePolicy;
}): Promise<MandatoryQaCheck[]> {
  for (const id of mandatoryQaCheckIds) {
    if (!Array.isArray(input.commands[id]) || input.commands[id].length === 0) {
      throw new Error(`Mandatory QA check is not executable: ${id}`);
    }
  }
  const checks: MandatoryQaCheck[] = [];
  for (const id of mandatoryQaCheckIds) {
    const record = await runBoundedProcess({
      argv: input.commands[id],
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      maxOutputBytes: input.maxOutputBytes,
      policy: input.policy,
    });
    const evidence = [
      `command=${record.argv.join(" ")}`,
      `exitCode=${record.exitCode === null ? "null" : record.exitCode}`,
      `timedOut=${record.timedOut}`,
      ...(record.stdout.trim() ? [record.stdout.trim()] : []),
      ...(record.stderr.trim() ? [record.stderr.trim()] : []),
    ];
    checks.push({
      id,
      status: record.exitCode === 0 && !record.timedOut ? "passed" : "failed",
      evidence,
    });
  }
  return checks;
}

function redactValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value))
    return value.map((item) => redactValue(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        redactValue(item, secrets),
      ]),
    );
  }
  return value;
}

/** @id CODE-HOH-COPILOT-ADAPTER-002
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-004 REQ-AUTONOMOUS-DEVELOPMENT-005 REQ-AUTONOMOUS-DEVELOPMENT-006 REQ-AUTONOMOUS-DEVELOPMENT-010 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-014
 * @design DES-AUTONOMOUS-DEVELOPMENT-006 DES-AUTONOMOUS-DEVELOPMENT-007
 */
export async function invokeCopilotRole(input: {
  executable?: string;
  cwd: string;
  role: HohRole;
  prompt: string;
  config: HohConfig;
  policy: EffectiveRolePolicy;
  environment?: Record<string, string>;
  validate(value: unknown): unknown;
  reserveAttempt?: (ceiling: number) => Promise<string>;
  settleAttempt?: (
    id: string,
    actual: number,
    actualNanoAiu?: number,
  ) => Promise<void>;
  abandonAttempt?: (id: string) => Promise<void>;
}): Promise<{
  value: unknown;
  attempts: number;
  usage: { aiCredits: number };
  records: CommandRecord[];
  events: Record<string, unknown>[];
  policy: EffectiveRolePolicy;
}> {
  const executable = input.executable ?? "copilot";
  const records: CommandRecord[] = [];
  const invocationResidualRisks = [
    ...new Set([
      ...input.policy.residualRisks,
      "copilot-version-probe-to-spawn",
    ]),
  ].sort();
  const { digest: _policyDigest, ...policyWithoutDigest } = input.policy;
  const invocationPolicyPayload = {
    ...policyWithoutDigest,
    residualRisks: invocationResidualRisks,
  };
  const invocationPolicy: EffectiveRolePolicy = {
    ...invocationPolicyPayload,
    digest: digest(stableJson(invocationPolicyPayload)),
  };
  const environment = { ...input.environment };
  delete environment.COPILOT_AUTO_UPDATE;
  const secretValues = input.policy.allowSecrets
    .map((name) => input.environment?.[name])
    .filter((value): value is string => !!value);
  const probeVersion = async (): Promise<void> => {
    const versionRecord = await runBoundedProcess({
      argv: [executable, "--version"],
      cwd: input.cwd,
      environment,
      omitEnvironment: ["COPILOT_AUTO_UPDATE"],
      timeoutMs: Math.min(input.config.commandTimeoutMs, 30_000),
      maxOutputBytes: input.config.maxCommandOutputBytes,
      policy: invocationPolicy,
      secretValues,
    });
    records.push(versionRecord);
    if (
      versionRecord.exitCode !== 0 ||
      versionRecord.timedOut ||
      versionRecord.truncated
    ) {
      throw new CopilotRoleConfigurationError(
        `Copilot version probe failed: exit=${String(versionRecord.exitCode)} timedOut=${String(versionRecord.timedOut)} truncated=${String(versionRecord.truncated)} stderr=${versionRecord.stderr.trim()}`,
        [...records],
      );
    }
    const observedOutput = versionRecord.stdout.trim();
    const observedVersion = extractCopilotVersion(observedOutput);
    if (!observedVersion) {
      throw new CopilotRoleConfigurationError(
        `Unparsable Copilot CLI version output: ${observedOutput}`,
        [...records],
      );
    }
    if (!isSupportedCopilotVersion(observedVersion)) {
      throw new CopilotRoleConfigurationError(
        `Unsupported Copilot CLI version ${observedVersion}; minimum supported version is 1.0.86.`,
        [...records],
      );
    }
    if (
      input.config.copilotCliVersion &&
      observedVersion !== input.config.copilotCliVersion
    ) {
      throw new CopilotRoleConfigurationError(
        `Copilot CLI version drift: expected ${input.config.copilotCliVersion}, observed ${observedVersion}.`,
        [...records],
      );
    }
  };
  const prompt = redactText(input.prompt, secretValues);
  let consumedNanoAiu = 0;
  let lastError: unknown;
  for (
    let attempt = 0;
    attempt <= input.config.limits.roleOutputRetryLimit;
    attempt += 1
  ) {
    await probeVersion();
    const remainingNanoAiu =
      creditsToNanoAiu(input.config.budget.aiCredits) - consumedNanoAiu;
    if (
      remainingNanoAiu <
      creditsToNanoAiu(input.config.roleInvocationReservedCredits)
    )
      throw new Error(
        "AI-credit budget cannot fund the configured role reservation.",
      );
    const reservationId = await input.reserveAttempt?.(
      input.config.roleInvocationReservedCredits,
    );
    let command: CommandRecord | undefined;
    let reconciled = false;
    try {
      command = await runBoundedProcess({
        argv: [
          executable,
          ...copilotArgs(input.role, prompt, input.config, input.policy),
        ],
        cwd: input.cwd,
        environment,
        omitEnvironment: ["COPILOT_AUTO_UPDATE"],
        timeoutMs: input.config.roleInvocationTimeoutMs,
        maxOutputBytes: input.config.maxCommandOutputBytes,
        policy: invocationPolicy,
        secretValues,
      });
      records.push(command);
      const completed = command;
      if (completed.timedOut || completed.exitCode !== 0)
        throw new Error(`Copilot ${input.role} process failed.`);
      if (completed.truncated)
        throw new Error("Copilot role output exceeded the configured byte bound.");
      const events = jsonLines(completed.stdout);
      const parsed = parseCopilotRoleEvents(
        events,
        creditsToNanoAiu(input.config.roleInvocationReservedCredits),
        input.config.model,
        input.config.reasoning,
        input.config.copilotCliVersion,
      );
      const usage = parsed.displayCredits;
      consumedNanoAiu += parsed.actualNanoAiu;
      if (reservationId) {
        await input.settleAttempt?.(
          reservationId,
          usage,
          parsed.actualNanoAiu,
        );
        reconciled = true;
      }
      if (consumedNanoAiu > creditsToNanoAiu(input.config.budget.aiCredits))
        throw new Error("Copilot usage exceeded the fixed AI-credit budget.");
      try {
        const value = input.validate(parsed.value);
        return {
          value: redactValue(value, secretValues),
          attempts: attempt + 1,
          usage: { aiCredits: consumedNanoAiu / nanoAiuPerCredit },
          records,
          events: redactValue(events, secretValues) as Record<
            string,
            unknown
          >[],
          policy: invocationPolicy,
        };
      } catch (cause) {
        lastError = cause;
      }
    } catch (cause) {
      if (reservationId && !reconciled)
        await input.abandonAttempt?.(reservationId);
      if (cause instanceof CopilotRoleConfigurationError) {
        if (cause.records.length) throw cause;
        throw new CopilotRoleConfigurationError(cause.message, [...records]);
      }
      lastError = cause;
    }
  }
  throw new CopilotRoleInvocationError(
    `Role output retries exhausted: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    [...records],
  );
}

/** @id CODE-HOH-ROLE-CONTRACT-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-005 REQ-AUTONOMOUS-DEVELOPMENT-006 REQ-AUTONOMOUS-DEVELOPMENT-010
 * @design DES-AUTONOMOUS-DEVELOPMENT-007
 */
export function validatePlannerOutput(
  output: unknown,
  requirements: string[],
  blockers: string[],
): PlannerPlan | PlannerReadiness {
  const value = record(output, "Planner output");
  if (value.kind === "readiness") {
    if (requirements.length || blockers.length)
      throw new Error(
        "Planner readiness requires no remaining requirement or blocker.",
      );
    return value as unknown as PlannerReadiness;
  }
  if (value.kind !== "plan" || !Array.isArray(value.priorities))
    throw new Error("Planner output must be a plan or readiness proposal.");
  if (value.priorities.length < 1 || value.priorities.length > 3)
    throw new Error("Planner plan must contain one to three priorities.");
  const addressed = Array.isArray(value.addressedBlockers)
    ? value.addressedBlockers
    : [];
  if (blockers.some((blocker) => !addressed.includes(blocker)))
    throw new Error("Planner output omitted a reported blocker.");
  for (const priority of value.priorities) {
    const item = record(priority, "Planner priority");
    if (!requirements.includes(String(item.requirementId)))
      throw new Error("Planner priority must select a public requirement.");
    if (!Array.isArray(item.acceptanceGates) || !item.acceptanceGates.length)
      throw new Error("Planner priority lacks acceptance gates.");
    if (!Array.isArray(item.preservation) || !item.preservation.length)
      throw new Error("Planner priority lacks preservation constraints.");
  }
  return value as unknown as PlannerPlan;
}

/** @id CODE-HOH-EVIDENCE-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-008 REQ-AUTONOMOUS-DEVELOPMENT-009 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-018
 * @design DES-AUTONOMOUS-DEVELOPMENT-010
 */
export function deriveClaimMatrix(requirements: string[]): Claim[] {
  return requirements.flatMap((requirementId) =>
    dimensions.map((dimension) => ({
      id: `CLAIM-${digest(`${requirementId}\0${dimension}`).slice(0, 24).toUpperCase()}`,
      requirementId,
      dimension,
    })),
  );
}

export function normalizeQa(
  report: QaClaim[],
  matrix: Claim[],
): EvidenceBundle {
  const expected = new Map(matrix.map((claim) => [claim.id, claim]));
  if (
    report.length !== matrix.length ||
    new Set(report.map((claim) => claim.claimId)).size !== report.length
  ) {
    throw new Error("QA output must assess every claim exactly once.");
  }
  for (const claim of report) {
    if (!expected.has(claim.claimId))
      throw new Error(`Unknown QA claim ${claim.claimId}.`);
    if (!["verified", "gap", "insufficient-evidence"].includes(claim.status))
      throw new Error(`Invalid QA status for ${claim.claimId}.`);
    if (!claim.evidence.length)
      throw new Error(`QA claim ${claim.claimId} requires public evidence.`);
  }
  const claims = [...report].sort((a, b) => a.claimId.localeCompare(b.claimId));
  const verified = claims.filter((claim) => claim.status === "verified");
  const unresolved = claims.filter((claim) => claim.status !== "verified");
  return { claims, verified, unresolved, readiness: unresolved.length === 0 };
}

const dimensionChecks: Record<QualityDimension, MandatoryQaCheckId[]> = {
  "functional-correctness": ["focused-test"],
  completeness: ["focused-test", "structured-contract"],
  "regression-safety": ["build", "inherited-compatibility"],
  usability: ["structured-contract"],
  security: ["static-validation"],
  performance: ["focused-test"],
  maintainability: [
    "build",
    "static-validation",
    "trace",
    "dependency-cycle",
    "structured-contract",
  ],
};

/** @id CODE-AUTONOMOUS-QA-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-008 REQ-AUTONOMOUS-DEVELOPMENT-015
 * @design DES-AUTONOMOUS-DEVELOPMENT-009 DES-AUTONOMOUS-DEVELOPMENT-010 DES-AUTONOMOUS-DEVELOPMENT-011
 */
export function evaluateSevenCheckQa(
  requirements: string[],
  checks: MandatoryQaCheck[],
): EvidenceBundle {
  const known = new Set<MandatoryQaCheckId>(mandatoryQaCheckIds);
  const checkMap = new Map<MandatoryQaCheckId, MandatoryQaCheck>();
  for (const check of checks) {
    if (!known.has(check.id) || checkMap.has(check.id)) {
      throw new Error(`QA check is unknown or duplicated: ${check.id}`);
    }
    if (!Array.isArray(check.evidence) || check.evidence.length === 0) {
      throw new Error(`QA check requires public evidence: ${check.id}`);
    }
    checkMap.set(check.id, check);
  }
  const matrix = deriveClaimMatrix(requirements);
  const report: QaClaim[] = matrix.map((claim) => {
    const required = dimensionChecks[claim.dimension];
    const missing = required.find((id) => !checkMap.has(id));
    if (missing) {
      return {
        claimId: claim.id,
        status: "insufficient-evidence",
        evidence: [`missing-check:${missing}`],
      };
    }
    const failed = required
      .map((id) => checkMap.get(id)!)
      .filter((check) => check.status === "failed");
    if (failed.length > 0) {
      return {
        claimId: claim.id,
        status: "gap",
        evidence: failed.flatMap((check) => check.evidence),
      };
    }
    return {
      claimId: claim.id,
      status: "verified",
      evidence: required.flatMap((id) => checkMap.get(id)!.evidence),
    };
  });
  return normalizeQa(report, matrix);
}

export function assessCandidate(
  previous: EvidenceBundle | undefined,
  current: EvidenceBundle,
  commandsPassed: boolean,
): {
  preservationVerified: boolean;
  improved: boolean;
  regressions: string[];
} {
  const old = new Map(
    previous?.claims.map((claim) => [claim.claimId, claim.status]) ?? [],
  );
  const regressions = current.claims
    .filter(
      (claim) =>
        old.get(claim.claimId) === "verified" && claim.status !== "verified",
    )
    .map((claim) => claim.claimId);
  const improved =
    !previous ||
    current.verified.length > previous.verified.length ||
    current.unresolved.length < previous.unresolved.length;
  return {
    preservationVerified: commandsPassed && regressions.length === 0,
    improved,
    regressions,
  };
}

async function gitCommand(
  root: string,
  args: string[],
  environment: Record<string, string> = {},
  allowFailure = false,
): Promise<string> {
  const policy = derivePolicy("developer", {});
  const result = await runBoundedProcess({
    argv: ["git", ...args],
    cwd: root,
    environment,
    timeoutMs: 30_000,
    maxOutputBytes: 1_048_576,
    policy,
  });
  if (!allowFailure && result.exitCode !== 0)
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

async function gitRawCommand(
  root: string,
  args: string[],
  environment: Record<string, string> = {},
  allowFailure = false,
): Promise<string> {
  const policy = derivePolicy("developer", {});
  const result = await runBoundedProcess({
    argv: ["git", ...args],
    cwd: root,
    environment,
    timeoutMs: 30_000,
    maxOutputBytes: 1_048_576,
    policy,
  });
  if (!allowFailure && result.exitCode !== 0)
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

interface GitDiffNameStatusEntry {
  status: string;
  path: string;
  originalPath?: string;
}

interface CandidateIsolationPathState {
  path: string;
  content: string;
  mode: string;
  existence: "present" | "absent";
  indexEntry: string;
  stagedIdentity: string;
  unstagedIdentity: string;
}

interface CandidateIsolationBaseline {
  schemaVersion: 1;
  runBaseCommit: string;
  statusDigest: string;
  dirtyPathStates: CandidateIsolationPathState[];
}

interface CandidateIsolationDirtyStatus {
  staged: boolean;
  unstaged: boolean;
}

function candidateIsolationStatusKey(
  status: CandidateIsolationDirtyStatus,
): string {
  return `${status.staged ? "S" : " "}${status.unstaged ? "U" : " "}`;
}

function shouldTrackCandidateIsolationOriginalPath(status: string): boolean {
  return status[0] === "R";
}

function markCandidateIsolationStatus(
  statusByPath: Map<string, CandidateIsolationDirtyStatus>,
  path: string,
  phase: keyof CandidateIsolationDirtyStatus,
): void {
  const current = statusByPath.get(path) ?? { staged: false, unstaged: false };
  current[phase] = true;
  statusByPath.set(path, current);
}

function parseGitDiffNameStatusZ(output: string): GitDiffNameStatusEntry[] {
  const entries: GitDiffNameStatusEntry[] = [];
  const fields = output.split("\0");
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field) continue;
    const kind = field[0];
    if (!kind) throw new Error("Malformed git diff --name-status output.");
    if (kind === "R" || kind === "C") {
      const originalPath = fields[index + 1];
      const path = fields[index + 2];
      if (!originalPath || !path)
        throw new Error("Malformed git rename/copy status output.");
      entries.push({ status: field, path, originalPath });
      index += 2;
      continue;
    }
    const path = fields[index + 1];
    if (!path) throw new Error("Malformed git diff path output.");
    entries.push({ status: field, path });
    index += 1;
  }
  return entries;
}

function parseGitPathListZ(output: string): string[] {
  return output.split("\0").filter((entry) => entry.length > 0);
}

async function candidateIsolationStatusByPath(
  root: string,
  baselineRef = "HEAD",
  environment: Record<string, string> = {},
): Promise<Map<string, string>> {
  const statusByPath = new Map<string, CandidateIsolationDirtyStatus>();
  for (const entry of parseGitDiffNameStatusZ(
    await gitRawCommand(root, [
      "diff-index",
      "--cached",
      "--name-status",
      "-z",
      "--find-renames",
      "--find-copies",
      baselineRef,
      "--",
    ], environment),
  )) {
    markCandidateIsolationStatus(statusByPath, entry.path, "staged");
    if (
      entry.originalPath &&
      shouldTrackCandidateIsolationOriginalPath(entry.status)
    )
      markCandidateIsolationStatus(statusByPath, entry.originalPath, "staged");
  }
  for (const entry of parseGitDiffNameStatusZ(
    await gitRawCommand(root, [
      "diff-files",
      "--name-status",
      "-z",
      "--find-renames",
      "--find-copies",
      "--",
    ], environment),
  )) {
    markCandidateIsolationStatus(statusByPath, entry.path, "unstaged");
    if (
      entry.originalPath &&
      shouldTrackCandidateIsolationOriginalPath(entry.status)
    )
      markCandidateIsolationStatus(statusByPath, entry.originalPath, "unstaged");
  }
  return new Map(
    [...statusByPath.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, status]) => [path, candidateIsolationStatusKey(status)]),
  );
}

function hasCandidateIsolationStageChange(status: string): boolean {
  return status[0] === "S";
}

function hasCandidateIsolationWorktreeChange(status: string): boolean {
  return status[1] === "U";
}

function isCandidateIsolationDirtyPathState(
  pathState: CandidateIsolationPathState,
): boolean {
  return !!pathState.stagedIdentity || !!pathState.unstagedIdentity;
}

function candidateIsolationBaselineDigest(
  baseline: Omit<CandidateIsolationBaseline, "statusDigest">,
): string {
  return digest(
    JSON.stringify({
      schemaVersion: baseline.schemaVersion,
      runBaseCommit: baseline.runBaseCommit,
      dirtyPathStates: [...baseline.dirtyPathStates].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
    }),
  );
}

async function gitIndexSignature(root: string): Promise<string> {
  const gitDir = await gitCommand(root, ["rev-parse", "--git-dir"]);
  const bytes = await readFile(resolve(root, gitDir, "index")).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return Buffer.alloc(0);
      throw error;
    },
  );
  return createHash("sha256").update(bytes).digest("hex");
}

async function readCandidateIsolationWorkspaceState(
  root: string,
  baselineRef = "HEAD",
  observedPaths: Iterable<string> = [],
): Promise<{
  statusByPath: Map<string, string>;
  pathStates: CandidateIsolationPathState[];
  pathStateByPath: Map<string, CandidateIsolationPathState>;
  fingerprint: string;
}> {
  const realIndexSignature = await gitIndexSignature(root);
  return withIsolatedGitIndex(root, async (environment) => {
    const statusByPath = await candidateIsolationStatusByPath(
      root,
      baselineRef,
      environment,
    );
    const paths = new Set([...statusByPath.keys(), ...observedPaths]);
    const pathStates = await Promise.all(
      [...paths]
        .sort()
        .map((path) =>
          observeCandidateIsolationPath(root, statusByPath, path, environment),
        ),
    );
    const pathStateByPath = new Map(
      pathStates.map((pathState) => [pathState.path, pathState]),
    );
    return {
      statusByPath,
      pathStates,
      pathStateByPath,
      fingerprint: digest(
        JSON.stringify({
          index: realIndexSignature,
          pathStates,
        }),
      ),
    };
  });
}

async function gitPathSignature(
  root: string,
  args: string[],
  environment: Record<string, string> = {},
): Promise<string | null> {
  const result = await runBoundedProcess({
    argv: ["git", ...args],
    cwd: root,
    environment,
    timeoutMs: 30_000,
    maxOutputBytes: 1_048_576,
    policy: derivePolicy("developer", {}),
  });
  if (result.exitCode !== 0) return null;
  return result.stdout === "" ? null : result.stdout;
}

async function worktreePathSignature(
  root: string,
  path: string,
): Promise<{
  content: string;
  mode: string;
  existence: "present" | "absent";
}> {
  const absolute = resolve(root, path);
  const metadata = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!metadata) return { content: "", mode: "", existence: "absent" };
  if (metadata.isSymbolicLink()) {
    const target = await readlink(absolute, "utf8");
    return {
      content: createHash("sha256").update(target).digest("hex"),
      mode: "120000",
      existence: "present",
    };
  }
  if (metadata.isFile()) {
    const bytes = await readFile(absolute);
    return {
      content: createHash("sha256").update(bytes).digest("hex"),
      mode: metadata.mode & 0o111 ? "100755" : "100644",
      existence: "present",
    };
  }
  return {
    content: "",
    mode: metadata.mode.toString(8),
    existence: "present",
  };
}

async function observeCandidateIsolationPath(
  root: string,
  statusByPath: Map<string, string>,
  path: string,
  environment: Record<string, string> = {},
): Promise<CandidateIsolationPathState> {
  const status = statusByPath.get(path) ?? "  ";
  const worktree = await worktreePathSignature(root, path);
  return {
    path,
    ...worktree,
    indexEntry:
      (await gitPathSignature(
        root,
        ["ls-files", "--stage", "-z", "--", path],
        environment,
      )) ??
      "",
    stagedIdentity: hasCandidateIsolationStageChange(status) ? "modified" : "",
    unstagedIdentity: hasCandidateIsolationWorktreeChange(status)
      ? "modified"
      : "",
  };
}

async function withIsolatedGitIndex<T>(
  root: string,
  operation: (environment: Record<string, string>) => Promise<T>,
): Promise<T> {
  const gitDir = await gitCommand(root, ["rev-parse", "--git-dir"]);
  const indexPath = resolve(root, gitDir, "index");
  const tempDir = resolve(
    tmpdir(),
    `musubix4-candidate-isolation-${randomUUID()}`,
  );
  const tempIndexPath = resolve(tempDir, "index");
  const indexMetadata = await stat(indexPath).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  const indexBytes = indexMetadata
    ? await readFile(indexPath)
    : Buffer.alloc(0);
  await mkdir(tempDir, { recursive: true });
  await writeFile(tempIndexPath, indexBytes);
  if (indexMetadata) {
    await utimes(
      tempIndexPath,
      indexMetadata.atimeMs / 1000,
      indexMetadata.mtimeMs / 1000,
    );
  }
  try {
    return await operation({ GIT_INDEX_FILE: tempIndexPath });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function restorePathToCommitIndex(
  root: string,
  commit: string,
  path: string,
  environment: Record<string, string>,
): Promise<void> {
  const entry = await gitPathSignature(root, ["ls-tree", "-z", commit, "--", path]);
  const normalized = entry?.split("\0").find(Boolean) ?? null;
  if (!normalized) {
    await gitCommand(
      root,
      ["update-index", "--force-remove", "--", path],
      environment,
      true,
    );
    return;
  }
  const tab = normalized.indexOf("\t");
  if (tab === -1)
    throw new Error(`Malformed git tree entry for candidate isolation path: ${path}`);
  const metadata = normalized.slice(0, tab).split(/\s+/u);
  if (metadata.length < 3)
    throw new Error(`Malformed git tree metadata for candidate isolation path: ${path}`);
  const mode = metadata[0]!;
  const objectId = metadata[2]!;
  const entryPath = normalized.slice(tab + 1);
  await gitCommand(
    root,
    ["update-index", "--add", "--cacheinfo", mode, objectId, entryPath],
    environment,
  );
}

/** @id CODE-HOH-GIT-STORE-002
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-009 REQ-AUTONOMOUS-DEVELOPMENT-014 REQ-AUTONOMOUS-DEVELOPMENT-016 REQ-AUTONOMOUS-DEVELOPMENT-018
 * @design DES-AUTONOMOUS-DEVELOPMENT-008
 */
export class GitCandidateStore {
  readonly root: string;
  readonly runBase: string;
  readonly refsBase: string;
  private initialized = false;
  private baseCommit: string | null = null;
  private statusDigest: string | null = null;
  private initialDirtyPaths = new Map<string, CandidateIsolationPathState>();

  constructor(
    root: string,
    readonly runId: string,
    readonly candidateExtraPaths: string[] = [],
    readonly dependencyProvisioning?: HohConfig["dependencyProvisioning"],
  ) {
    this.root = resolve(root);
    this.runBase = resolve(root, ".musubix4/runs", runId);
    this.refsBase = `refs/musubix4/runs/${runId}`;
  }

  private async isolatedIndex(
    name: string,
  ): Promise<{ path: string; env: Record<string, string> }> {
    const path = resolve(this.runBase, "indexes", `${name}.index`);
    await mkdir(dirname(path), { recursive: true });
    await rm(path, { force: true });
    return { path, env: { GIT_INDEX_FILE: path } };
  }

  private baselinePath(): string {
    return resolve(this.runBase, "candidate-baseline.json");
  }

  private applyBaseline(baseline: CandidateIsolationBaseline): void {
    this.baseCommit = baseline.runBaseCommit;
    this.statusDigest = baseline.statusDigest;
    this.initialDirtyPaths = new Map(
      baseline.dirtyPathStates
        .filter(isCandidateIsolationDirtyPathState)
        .map((pathState) => [pathState.path, pathState]),
    );
    this.initialized = true;
  }

  private async loadBaseline(): Promise<CandidateIsolationBaseline | undefined> {
    const contents = await readFile(this.baselinePath(), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw new CandidateBaselineError(
          "CANDIDATE_BASELINE_INVALID",
          `Persisted Git candidate isolation baseline is unreadable: ${error.message}`,
        );
      },
    );
    if (contents === undefined) return undefined;
    let value: Partial<CandidateIsolationBaseline>;
    try {
      value = JSON.parse(contents) as Partial<CandidateIsolationBaseline>;
    } catch {
      throw new CandidateBaselineError(
        "CANDIDATE_BASELINE_INVALID",
        "Persisted Git candidate isolation baseline is not valid JSON.",
      );
    }
    if (
      value.schemaVersion !== 1 ||
      typeof value.runBaseCommit !== "string" ||
      typeof value.statusDigest !== "string" ||
      !Array.isArray(value.dirtyPathStates) ||
      value.dirtyPathStates.some(
        (pathState) =>
          !pathState ||
          typeof pathState !== "object" ||
          typeof pathState.path !== "string" ||
          typeof pathState.content !== "string" ||
          typeof pathState.mode !== "string" ||
          !["present", "absent"].includes(pathState.existence ?? "") ||
          typeof pathState.indexEntry !== "string" ||
          typeof pathState.stagedIdentity !== "string" ||
          typeof pathState.unstagedIdentity !== "string",
      )
    ) {
      throw new CandidateBaselineError(
        "CANDIDATE_BASELINE_INVALID",
        "Persisted Git candidate isolation baseline has an invalid shape.",
      );
    }
    const baseline = value as CandidateIsolationBaseline;
    if (
      baseline.statusDigest !==
      candidateIsolationBaselineDigest({
        schemaVersion: baseline.schemaVersion,
        runBaseCommit: baseline.runBaseCommit,
        dirtyPathStates: baseline.dirtyPathStates,
      })
    ) {
      throw new CandidateBaselineError(
        "CANDIDATE_BASELINE_DIGEST_MISMATCH",
        "Persisted Git candidate isolation baseline digest does not match its contents.",
      );
    }
    return baseline;
  }

  private async assertCandidateIsolation(
    pathStateByPath: Map<string, CandidateIsolationPathState>,
  ): Promise<void> {
    if (!this.baseCommit)
      throw new Error("Git candidate store was not initialized correctly.");
    for (const [path, initial] of this.initialDirtyPaths) {
      const current = pathStateByPath.get(path) ?? {
        path,
        content: "",
        mode: "",
        existence: "absent" as const,
        indexEntry: "",
        stagedIdentity: "",
        unstagedIdentity: "",
      };
      const differences: string[] = [];
      if (
        current.stagedIdentity !== initial.stagedIdentity ||
        current.unstagedIdentity !== initial.unstagedIdentity
      )
        differences.push("staged/unstaged state");
      if (current.indexEntry !== initial.indexEntry)
        differences.push("staged content or mode");
      if (
        current.content !== initial.content ||
        current.mode !== initial.mode ||
        current.existence !== initial.existence
      )
        differences.push("worktree content, mode, or existence");
      if (differences.length > 0) {
        const guidance =
          "Commit, stash, or revert the pre-existing tracked change before creating a candidate snapshot.";
        throw new CandidateIsolationError(
          "CANDIDATE_ISOLATION_CONFLICT",
          `Tracked path dirty at initialization changed after candidate isolation began: ${path} (${differences.join(", ")}). ${guidance}`,
          path,
          guidance,
        );
      }

    }
  }

  async verifyInitializationBaseline(): Promise<void> {
    if (!this.initialized) await this.initialize({ allowCreate: false });
    if (!this.baseCommit)
      throw new Error("Git candidate store was not initialized correctly.");
    const workspace = await readCandidateIsolationWorkspaceState(
      this.root,
      this.baseCommit,
      this.initialDirtyPaths.keys(),
    );
    await this.assertCandidateIsolation(workspace.pathStateByPath);
  }

  private async restoreInitiallyDirtyPaths(
    environment: Record<string, string>,
  ): Promise<void> {
    if (!this.baseCommit)
      throw new Error("Git candidate store was not initialized correctly.");
    for (const path of this.initialDirtyPaths.keys()) {
      await restorePathToCommitIndex(this.root, this.baseCommit, path, environment);
    }
  }

  private async stageCleanRunProducedTrackedPaths(
    statusByPath: Map<string, string>,
    environment: Record<string, string>,
  ): Promise<void> {
    for (const [path, status] of statusByPath) {
      if (this.initialDirtyPaths.has(path)) continue;
      if (
        !hasCandidateIsolationStageChange(status) &&
        !hasCandidateIsolationWorktreeChange(status)
      ) {
        continue;
      }
      await gitCommand(this.root, ["add", "-A", "--", path], environment);
    }
  }

  private async stageCandidateExtraPaths(
    environment: Record<string, string>,
  ): Promise<void> {
    for (const path of this.candidateExtraPaths) {
      const absolute = resolve(this.root, path);
      if (relative(this.root, absolute).startsWith(".."))
        throw new Error(`candidateExtraPaths escapes the repository: ${path}`);
      await stat(absolute).catch(() => {
        throw new Error(`candidateExtraPaths entry does not exist: ${path}`);
      });
      const trackedEntries = parseGitPathListZ(
        await gitRawCommand(
          this.root,
          ["ls-files", "-z", "--", path],
          environment,
        ),
      );
      if (trackedEntries.length === 0) {
        await gitCommand(
          this.root,
          ["add", "--force", "--", path],
          environment,
        );
        continue;
      }
      const untrackedEntries = parseGitPathListZ(
        await gitRawCommand(
          this.root,
          ["ls-files", "--others", "-z", "--", path],
          environment,
        ),
      );
      for (const entry of untrackedEntries) {
        await gitCommand(
          this.root,
          ["add", "--force", "--", entry],
          environment,
        );
      }
    }
  }

  private async deleteSnapshotRef(ref: string): Promise<void> {
    await gitCommand(this.root, ["update-ref", "-d", ref], {}, true);
  }

  async initialize(options: { allowCreate?: boolean } = {}): Promise<{
    baseRef: string;
    baseCommit: string;
    statusDigest: string;
  }> {
    if (this.initialized) {
      if (!this.baseCommit || !this.statusDigest)
        throw new Error("Git candidate store was not initialized correctly.");
      return {
        baseRef: `${this.refsBase}/base`,
        baseCommit: this.baseCommit,
        statusDigest: this.statusDigest,
      };
    }
    const persisted = await this.loadBaseline();
    if (persisted) {
      const resolved = await runBoundedProcess({
        argv: ["git", "cat-file", "-e", `${persisted.runBaseCommit}^{commit}`],
        cwd: this.root,
        timeoutMs: 30_000,
        maxOutputBytes: 1_048_576,
        policy: derivePolicy("developer", {}),
      });
      if (resolved.exitCode !== 0) {
        throw new CandidateBaselineError(
          "CANDIDATE_BASE_COMMIT_UNRESOLVABLE",
          `Persisted Git candidate base commit is unavailable: ${persisted.runBaseCommit}`,
        );
      }
      await gitCommand(this.root, [
        "update-ref",
        `${this.refsBase}/base`,
        persisted.runBaseCommit,
      ]);
      this.applyBaseline(persisted);
      return {
        baseRef: `${this.refsBase}/base`,
        baseCommit: persisted.runBaseCommit,
        statusDigest: persisted.statusDigest,
      };
    }
    if (options.allowCreate === false) {
      throw new CandidateBaselineError(
        "CANDIDATE_BASELINE_MISSING",
        "Persisted Git candidate isolation baseline is missing after run work began.",
      );
    }
    const baseCommit = await gitCommand(this.root, [
      "rev-parse",
      "--verify",
      "HEAD",
    ]);
    const workspaceBefore = await readCandidateIsolationWorkspaceState(
      this.root,
      baseCommit,
    );
    await gitCommand(this.root, [
      "update-ref",
      `${this.refsBase}/base`,
      baseCommit,
    ]);
    const workspaceAfter = await readCandidateIsolationWorkspaceState(
      this.root,
      baseCommit,
    );
    if (workspaceBefore.fingerprint !== workspaceAfter.fingerprint)
      throw new Error(
        "Git workspace preflight changed the user worktree or index.",
      );
    const initialDirtyPathStates = workspaceBefore.pathStates.filter(
      isCandidateIsolationDirtyPathState,
    );
    const baselineWithoutDigest: Omit<
      CandidateIsolationBaseline,
      "statusDigest"
    > = {
      schemaVersion: 1,
      runBaseCommit: baseCommit,
      dirtyPathStates: initialDirtyPathStates,
    };
    const baseline: CandidateIsolationBaseline = {
      ...baselineWithoutDigest,
      statusDigest: candidateIsolationBaselineDigest(baselineWithoutDigest),
    };
    await atomicWrite(this.baselinePath(), baseline);
    this.applyBaseline(baseline);
    return {
      baseRef: `${this.refsBase}/base`,
      baseCommit: baseline.runBaseCommit,
      statusDigest: baseline.statusDigest,
    };
  }

  async snapshotStage(stage: string): Promise<CandidateSnapshot> {
    if (!this.initialized) await this.initialize();
    if (!/^[A-Za-z0-9._-]+$/.test(stage))
      throw new Error("Stage name contains unsupported characters.");
    if (!this.baseCommit)
      throw new Error("Git candidate store was not initialized correctly.");
    const baseCommit = this.baseCommit;
    const workspaceBefore = await readCandidateIsolationWorkspaceState(
      this.root,
      baseCommit,
      this.initialDirtyPaths.keys(),
    );
    await this.assertCandidateIsolation(workspaceBefore.pathStateByPath);
    let ref = `${this.refsBase}/stages/${stage}`;
    let treeDigest = "";
    let lockfile: CandidateSnapshot["lockfile"];
    let refCreated = false;
    try {
      await withIsolatedGitIndex(this.root, async (environment) => {
        await gitCommand(this.root, ["read-tree", baseCommit], environment);
        await this.stageCleanRunProducedTrackedPaths(
          workspaceBefore.statusByPath,
          environment,
        );
        await this.stageCandidateExtraPaths(environment);
        await this.restoreInitiallyDirtyPaths(environment);
        treeDigest = await gitCommand(this.root, ["write-tree"], environment);
        const commit = await gitCommand(
          this.root,
          [
            "commit-tree",
            treeDigest,
            "-p",
            baseCommit,
            "-m",
            `musubix4 ${this.runId} ${stage}`,
          ],
          environment,
        );
        await gitCommand(this.root, ["update-ref", ref, commit]);
        refCreated = true;
      });
      const supportedLockfiles = [
        "package-lock.json",
        "npm-shrinkwrap.json",
        "pnpm-lock.yaml",
        "yarn.lock",
      ];
      const configuredLockfile = this.dependencyProvisioning?.lockfilePath;
      const presentLockfiles: string[] = [];
      for (const path of configuredLockfile
        ? [configuredLockfile]
        : supportedLockfiles) {
        const exists = await gitCommand(
          this.root,
          ["cat-file", "-e", `${ref}:${path}`],
          {},
          true,
        );
        if (exists === "") {
          const probe = await runBoundedProcess({
            argv: ["git", "cat-file", "-e", `${ref}:${path}`],
            cwd: this.root,
            timeoutMs: 30_000,
            maxOutputBytes: 1_048_576,
            policy: derivePolicy("developer", {}),
          });
          if (probe.exitCode === 0) presentLockfiles.push(path);
        }
      }
      if (configuredLockfile && presentLockfiles.length !== 1) {
        throw new Error(
          `Configured lockfile is absent from the candidate: ${configuredLockfile}`,
        );
      }
      if (!configuredLockfile && presentLockfiles.length > 1) {
        throw new Error(
          `Multiple candidate lockfiles require an explicit selection: ${presentLockfiles.join(", ")}`,
        );
      }
      const lockfilePath = presentLockfiles[0];
      if (lockfilePath) {
        const blob = await runBoundedProcess({
          argv: ["git", "show", `${ref}:${lockfilePath}`],
          cwd: this.root,
          timeoutMs: 30_000,
          maxOutputBytes: 16_777_216,
          policy: derivePolicy("developer", {}),
        });
        if (blob.exitCode !== 0 || blob.timedOut || blob.truncated) {
          throw new Error(`Unable to read candidate lockfile: ${lockfilePath}`);
        }
        lockfile = { path: lockfilePath, sha256: digest(blob.stdout) };
      }
      const workspaceAfter = await readCandidateIsolationWorkspaceState(
        this.root,
        baseCommit,
        this.initialDirtyPaths.keys(),
      );
      if (workspaceBefore.fingerprint !== workspaceAfter.fingerprint) {
        await this.assertCandidateIsolation(workspaceAfter.pathStateByPath);
        throw new Error("Candidate snapshot changed the user worktree or index.");
      }
      return { ref, treeDigest, ...(lockfile ? { lockfile } : {}) };
    } catch (cause) {
      if (refCreated) await this.deleteSnapshotRef(ref);
      throw cause;
    }
  }

  async discardProvisionalCandidate(): Promise<void> {
    await gitCommand(
      this.root,
      ["update-ref", "-d", `${this.refsBase}/amendments/provisional`],
      {},
      true,
    );
  }

  /** @id CODE-AUTONOMOUS-AMENDMENT-GIT-001
   * @implements REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-018
   * @design DES-AUTONOMOUS-DEVELOPMENT-008
   */
  async createInventoryAmendmentCommit(
    original: CandidateSnapshot,
    approvedInventory: Buffer,
  ): Promise<ProvisionalCandidateSnapshot> {
    if (!this.initialized) await this.initialize();
    const inventoryPath = ".musubix/compatibility/command-collisions.json";
    const inputPath = resolve(
      this.runBase,
      "amendments",
      `${randomUUID()}.json`,
    );
    await mkdir(dirname(inputPath), { recursive: true });
    await writeFile(inputPath, approvedInventory, { mode: 0o600 });
    const index = await this.isolatedIndex(`amendment-${randomUUID()}`);
    try {
      await gitCommand(this.root, ["read-tree", original.ref], index.env);
      const blob = await gitCommand(
        this.root,
        ["hash-object", "-w", inputPath],
        index.env,
      );
      await gitCommand(
        this.root,
        [
          "update-index",
          "--add",
          "--cacheinfo",
          `100644,${blob},${inventoryPath}`,
        ],
        index.env,
      );
      const treeDigest = await gitCommand(this.root, ["write-tree"], index.env);
      const commit = await gitCommand(
        this.root,
        [
          "commit-tree",
          treeDigest,
          "-p",
          original.ref,
          "-m",
          `musubix4 ${this.runId} collision inventory amendment`,
        ],
        index.env,
      );
      const changed = (
        await gitCommand(this.root, [
          "diff",
          "--name-only",
          original.ref,
          commit,
        ])
      )
        .split("\n")
        .filter(Boolean);
      if (changed.length !== 1 || changed[0] !== inventoryPath) {
        throw new Error(
          "Provisional amendment commit changed paths outside the collision inventory.",
        );
      }
      const ref = `${this.refsBase}/amendments/provisional`;
      await gitCommand(this.root, ["update-ref", ref, commit]);
      return {
        ref,
        treeDigest,
        original,
        inventorySha256: createHash("sha256")
          .update(approvedInventory)
          .digest("hex"),
      };
    } finally {
      await rm(index.path, { force: true });
      await rm(inputPath, { force: true });
    }
  }

  async promoteCandidate(
    provisional: ProvisionalCandidateSnapshot,
    approvedInventory: Buffer,
  ): Promise<CandidateSnapshot> {
    const sha256 = createHash("sha256").update(approvedInventory).digest("hex");
    if (sha256 !== provisional.inventorySha256) {
      throw new Error(
        "Approved collision inventory digest changed before promotion.",
      );
    }
    const inventoryPath = ".musubix/compatibility/command-collisions.json";
    const committed = await gitCommand(this.root, [
      "show",
      `${provisional.ref}:${inventoryPath}`,
    ]);
    if (committed !== approvedInventory.toString("utf8")) {
      throw new Error(
        "Provisional commit collision inventory differs from approved bytes.",
      );
    }
    const workspacePath = resolve(this.runBase, "workspace", inventoryPath);
    await mkdir(dirname(workspacePath), { recursive: true });
    const temporary = `${workspacePath}.${randomUUID()}.new`;
    await writeFile(temporary, approvedInventory, { mode: 0o600 });
    await rename(temporary, workspacePath);
    const commit = await gitCommand(this.root, ["rev-parse", provisional.ref]);
    const ref = `${this.refsBase}/candidate`;
    await gitCommand(this.root, ["update-ref", ref, commit]);
    const treeDigest = await gitCommand(this.root, [
      "rev-parse",
      `${ref}^{tree}`,
    ]);
    const workspaceBytes = await readFile(workspacePath);
    if (
      !workspaceBytes.equals(approvedInventory) ||
      treeDigest !== provisional.treeDigest
    ) {
      throw new Error(
        "Promoted candidate and isolated workspace inventory identity diverged.",
      );
    }
    return { ref, treeDigest };
  }

  async createQaWorkspace(
    candidate: CandidateSnapshot,
  ): Promise<{ path: string; candidate: CandidateSnapshot }> {
    const path = resolve(this.runBase, "qa", randomUUID());
    await mkdir(dirname(path), { recursive: true });
    await gitCommand(this.root, [
      "worktree",
      "add",
      "--detach",
      path,
      candidate.ref,
    ]);
    try {
      const tracked = await gitCommand(path, ["ls-files", "-z"]);
      const trackedFiles = tracked.split("\0").filter(Boolean);
      for (const file of trackedFiles) {
        const metadata = await lstat(resolve(path, file));
        if (!metadata.isSymbolicLink())
          await chmod(resolve(path, file), metadata.mode & ~0o222);
      }
      if (candidate.lockfile) {
        const lockfileBytes = await readBaselineArtifact(
          path,
          candidate.lockfile.path,
        );
        const observed = createHash("sha256")
          .update(lockfileBytes)
          .digest("hex");
        if (observed !== candidate.lockfile.sha256) {
          throw new Error(
            `Candidate lockfile digest mismatch: ${candidate.lockfile.path}`,
          );
        }
      }
      if (this.dependencyProvisioning) {
        if (!candidate.lockfile) {
          throw new Error(
            "Dependency provisioning requires a digest-pinned candidate lockfile.",
          );
        }
        for (const writablePath of this.dependencyProvisioning.writablePaths) {
          const absolute = resolve(path, writablePath);
          const relativePath = relative(path, absolute);
          if (
            isAbsolute(writablePath) ||
            relativePath === ".." ||
            relativePath.startsWith(`..${sep}`)
          ) {
            throw new Error(
              `Dependency writable path escapes the release checkout: ${writablePath}`,
            );
          }
          const normalizedWritablePath = relativePath.split(sep).join("/");
          if (
            (normalizedWritablePath === "" && trackedFiles.length > 0) ||
            trackedFiles.some(
              (file) =>
                file === normalizedWritablePath ||
                file.startsWith(`${normalizedWritablePath}/`),
            )
          ) {
            throw new Error(
              `Dependency writable path overlaps a tracked production file: ${writablePath}`,
            );
          }
          await mkdir(absolute, { recursive: true });
        }
        const provisioned = await runBoundedProcess({
          argv: this.dependencyProvisioning.command,
          cwd: path,
          timeoutMs: 120_000,
          maxOutputBytes: 1_048_576,
          policy: derivePolicy("qa", {
            allowProjectCommands: true,
            allowWrite: true,
            allowWritePaths: this.dependencyProvisioning.writablePaths,
          }),
        });
        if (provisioned.exitCode !== 0 || provisioned.timedOut) {
          throw new Error(
            `Dependency provisioning failed: ${provisioned.stderr.trim()}`,
          );
        }
        const observedAfter = createHash("sha256")
          .update(await readBaselineArtifact(path, candidate.lockfile.path))
          .digest("hex");
        if (observedAfter !== candidate.lockfile.sha256) {
          throw new Error(
            `Candidate lockfile changed during provisioning: ${candidate.lockfile.path}`,
          );
        }
        if (!(await this.verifyCandidateUnchanged({ path }, candidate))) {
          throw new Error(
            "Dependency provisioning wrote outside declared disposable paths.",
          );
        }
      }
      return { path, candidate };
    } catch (cause) {
      await this.cleanupQaWorkspace({ path });
      throw cause;
    }
  }

  async createDeveloperWorkspace(
    candidate?: CandidateSnapshot,
  ): Promise<{ path: string; candidate: CandidateSnapshot }> {
    const selected = candidate ?? (await this.rollback());
    const path = resolve(this.runBase, "developer", randomUUID());
    await mkdir(dirname(path), { recursive: true });
    await gitCommand(this.root, [
      "worktree",
      "add",
      "--detach",
      path,
      selected.ref,
    ]);
    return { path, candidate: selected };
  }

  async cleanupDeveloperWorkspace(workspace: { path: string }): Promise<void> {
    await gitCommand(
      this.root,
      ["worktree", "remove", "--force", workspace.path],
      {},
      true,
    );
    await rm(workspace.path, { recursive: true, force: true });
    await gitCommand(this.root, ["worktree", "prune"]);
  }

  async verifyCandidateUnchanged(
    workspace: { path: string },
    candidate: CandidateSnapshot,
  ): Promise<boolean> {
    const output = await gitCommand(workspace.path, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    const writablePaths = this.dependencyProvisioning?.writablePaths ?? [];
    for (const entry of output.split("\0").filter(Boolean)) {
      if (!entry.startsWith("?? ")) return false;
      const path = entry.slice(3);
      const disposable = writablePaths.some(
        (allowed) => path === allowed || path.startsWith(`${allowed}/`),
      );
      if (!disposable) return false;
    }
    return (
      (await gitCommand(workspace.path, ["rev-parse", "HEAD^{tree}"])) ===
      candidate.treeDigest
    );
  }

  async cleanupQaWorkspace(workspace: { path: string }): Promise<void> {
    await gitCommand(
      this.root,
      ["worktree", "remove", "--force", workspace.path],
      {},
      true,
    );
    await rm(workspace.path, { recursive: true, force: true });
    const qaRoot = resolve(this.runBase, "qa");
    const remaining = await readdir(qaRoot).catch(() => []);
    if (remaining.length === 0)
      await rm(qaRoot, { recursive: true, force: true });
    await gitCommand(this.root, ["worktree", "prune"]);
  }

  async rollback(candidate?: CandidateSnapshot): Promise<CandidateSnapshot> {
    if (candidate) return candidate;
    const ref = `${this.refsBase}/base`;
    return {
      ref,
      treeDigest: await gitCommand(this.root, ["rev-parse", `${ref}^{tree}`]),
    };
  }

  async reconcileWorkspaces(): Promise<void> {
    await gitCommand(this.root, ["worktree", "prune"]);
    await rm(resolve(this.runBase, "qa"), { recursive: true, force: true });
    await rm(resolve(this.runBase, "developer"), {
      recursive: true,
      force: true,
    });
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.new`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}

async function atomicWriteText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.new`;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, path);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** @id CODE-HOH-RUN-STORE-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-004 REQ-AUTONOMOUS-DEVELOPMENT-009 REQ-AUTONOMOUS-DEVELOPMENT-010 REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-014
 * @design DES-AUTONOMOUS-DEVELOPMENT-004
 */
export class FileRunStore {
  readonly base: string;
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    this.base = resolve(root, ".musubix4/runs");
  }

  private statePath(runId: string): string {
    return resolve(this.base, runId, "state.json");
  }
  private lockPath(runId: string): string {
    return resolve(this.base, runId, "writer.lock");
  }

  async create(input: {
    source: SpecificationSource;
    config: HohConfig;
    requirements?: string[];
    protectedSet?: { paths: string[]; digest: string };
  }): Promise<RunRecord> {
    const id = randomUUID();
    await mkdir(resolve(this.root, ".musubix"), { recursive: true });
    const record: RunRecord = {
      schemaVersion: 1,
      id,
      approvalAuthority: (await pathExists(
        resolve(this.root, ".musubix/hoh.json"),
      ))
        ? "verified-auto"
        : "manual",
      state: "created",
      iteration: 0,
      role: null,
      source: input.source,
      config: input.config,
      configDigest: digest(stableJson(input.config)),
      usage: { aiCredits: 0, reserved: 0 },
      usageNanoAiu: { consumed: 0, reserved: 0 },
      evidence: { verified: 0, unresolved: 0, regressions: 0 },
      activeDurationMs: 0,
      stagnantIterations: 0,
      amendmentEpisodeCount: 0,
      amendmentFailureCount: 0,
      requiredOperatorAction: "none",
      ...(input.protectedSet
        ? {
            protectedSetDigest: input.protectedSet.digest,
            protectedSetPaths: [...input.protectedSet.paths],
          }
        : {}),
      attempts: [],
      ...(input.requirements ? { requirements: input.requirements } : {}),
      journal: [
        {
          sequence: 1,
          event: "created",
          state: "created",
          recordedAt: new Date().toISOString(),
        },
      ],
    };
    await atomicWrite(this.statePath(id), record);
    return record;
  }

  async status(runId: string): Promise<RunRecord> {
    return JSON.parse(
      await readFile(this.statePath(runId), "utf8"),
    ) as RunRecord;
  }

  async save(record: RunRecord): Promise<void> {
    await atomicWrite(this.statePath(record.id), record);
  }

  async transition(
    runId: string,
    state: RunState,
    event: string,
    details?: Record<string, unknown>,
  ): Promise<RunRecord> {
    const current = await this.status(runId);
    const transition: RunTransition = {
      sequence: current.journal.length + 1,
      event,
      state,
      recordedAt: new Date().toISOString(),
      ...(details ? { details } : {}),
    };
    const next = {
      ...current,
      state,
      journal: [...current.journal, transition],
    };
    await this.save(next);
    return next;
  }

  async acquire(
    runId: string,
    owner: { pid: number; owner: string },
  ): Promise<Lease> {
    const path = this.lockPath(runId);
    await mkdir(dirname(path), { recursive: true });
    const nonce = randomUUID();
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ ...owner, nonce }));
      await handle.close();
      return { runId, nonce, path };
    } catch (cause) {
      const existing = JSON.parse(await readFile(path, "utf8")) as {
        pid: number;
      };
      if (processAlive(existing.pid))
        throw new Error(`Run ${runId} is locked by a live writer.`);
      await rm(path, { force: true });
      await this.transition(
        runId,
        (await this.status(runId)).state,
        "stale-lock-reclaimed",
        { deadPid: existing.pid },
      );
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ ...owner, nonce }));
      await handle.close();
      return { runId, nonce, path };
    }
  }

  async release(lease: Lease): Promise<void> {
    const current = JSON.parse(await readFile(lease.path, "utf8")) as {
      nonce: string;
    };
    if (current.nonce !== lease.nonce) throw new Error("Lease nonce mismatch.");
    await rm(lease.path, { force: true });
  }

  async stop(runId: string, reason: string): Promise<RunRecord> {
    const stopped = await this.transition(runId, "stopped", "stopped", {
      reason,
    });
    const next = { ...stopped, terminalReason: reason };
    await this.save(next);
    return next;
  }

  /** @id CODE-AUTONOMOUS-AMENDMENT-001
   * @implements REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-013
   * @design DES-AUTONOMOUS-DEVELOPMENT-004 DES-AUTONOMOUS-DEVELOPMENT-005
   */
  async enterAmendmentRequired(
    runId: string,
    input: { candidate: CandidateSnapshot; offendingPaths: string[] },
  ): Promise<RunRecord> {
    const run = await this.status(runId);
    if (run.state === "amendment-required") return run;
    const amendmentEpisodeCount = (run.amendmentEpisodeCount ?? 0) + 1;
    const terminal =
      amendmentEpisodeCount > run.config.limits.maxAmendmentEpisodes;
    const next = await this.transition(
      runId,
      terminal ? "failed" : "amendment-required",
      terminal ? "amendment-episode-limit" : "amendment-required",
      {
        candidateRef: input.candidate.ref,
        offendingPaths: [...input.offendingPaths].sort((a, b) =>
          a.localeCompare(b),
        ),
        amendmentEpisodeCount,
      },
    );
    next.candidate = input.candidate;
    next.amendmentEpisodeCount = amendmentEpisodeCount;
    next.amendmentFailureCount = 0;
    next.requiredOperatorAction = terminal
      ? "none"
      : "amend-collision-inventory";
    next.offendingInventoryPaths = [...input.offendingPaths].sort((a, b) =>
      a.localeCompare(b),
    );
    if (terminal) next.terminalReason = "amendment-episode-limit";
    await this.save(next);
    return next;
  }

  async enterCandidateIsolationRequired(
    runId: string,
    error: CandidateIsolationError,
  ): Promise<RunRecord> {
    const run = await this.status(runId);
    if (run.state === "candidate-isolation-required") return run;
    const offendingPaths = [...new Set(error.paths)].sort((left, right) =>
      left.localeCompare(right),
    );
    const next = await this.transition(
      runId,
      "candidate-isolation-required",
      "candidate-isolation-required",
      {
        code: error.code,
        offendingCandidateIsolationPaths: offendingPaths,
        requiredOperatorAction: error.guidance,
      },
    );
    next.requiredOperatorAction =
      "restore-candidate-isolation-paths-or-start-new-run";
    next.offendingCandidateIsolationPaths = offendingPaths;
    Reflect.set(next, "terminalReason", undefined);
    await this.save(next);
    return next;
  }

  async recordAmendmentFailure(
    runId: string,
    code: string,
  ): Promise<RunRecord> {
    const run = await this.status(runId);
    if (run.state !== "amendment-required" && run.state !== "approval-paused") {
      throw new Error("Run is not awaiting a collision-inventory amendment.");
    }
    const amendmentFailureCount = (run.amendmentFailureCount ?? 0) + 1;
    const terminal =
      amendmentFailureCount > run.config.limits.amendmentRetryLimit;
    const next = await this.transition(
      runId,
      terminal ? "failed" : "amendment-required",
      terminal ? "amendment-retries-exhausted" : "amendment-attempt-failed",
      { code, amendmentFailureCount },
    );
    next.amendmentFailureCount = amendmentFailureCount;
    delete next.approval;
    delete next.amendmentManifest;
    next.requiredOperatorAction = terminal
      ? "none"
      : "amend-collision-inventory";
    if (terminal) next.terminalReason = "amendment-retries-exhausted";
    await this.save(next);
    return next;
  }

  async completeAmendment(
    runId: string,
    candidate: CandidateSnapshot,
  ): Promise<RunRecord> {
    const run = await this.status(runId);
    if (run.state !== "amendment-required")
      throw new Error("Run is not awaiting a collision-inventory amendment.");
    const next = await this.transition(
      runId,
      "candidate",
      "amendment-completed",
      {
        candidateRef: candidate.ref,
        amendmentEpisodeCount: run.amendmentEpisodeCount ?? 0,
      },
    );
    next.candidate = candidate;
    next.amendmentFailureCount = 0;
    next.requiredOperatorAction = "none";
    next.offendingInventoryPaths = [];
    await this.save(next);
    return next;
  }

  /** @id CODE-AUTONOMOUS-AMENDMENT-CLI-001
   * @implements REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-016
   * @design DES-AUTONOMOUS-DEVELOPMENT-005 DES-AUTONOMOUS-DEVELOPMENT-012
   */
  async prepareCollisionInventoryAmendment(
    runId: string,
    path: string,
  ): Promise<RunRecord> {
    const run = await this.status(runId);
    if (run.state !== "amendment-required") {
      throw new Error("Run is not awaiting a collision-inventory amendment.");
    }
    const bytes = await readBaselineArtifact(this.root, path);
    let inventory: unknown;
    try {
      inventory = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new CommandInventoryError(
        "COMMAND_INVENTORY_MALFORMED",
        "Replacement collision inventory is not valid JSON.",
      );
    }
    const value = inventory as Partial<CommandCollisionInventory>;
    if (value.schemaVersion !== 1 || !Array.isArray(value.entries)) {
      throw new CommandInventoryError(
        "COMMAND_INVENTORY_MALFORMED",
        "Replacement collision inventory must use schema version 1.",
      );
    }
    const nonce = randomUUID();
    const manifest = {
      path: relative(this.root, baselinePath(this.root, path))
        .split(sep)
        .join("/"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      nonce,
    };
    const manifestDigest = digest(
      stableJson({
        runId,
        amendmentEpisodeCount: run.amendmentEpisodeCount ?? 0,
        path: manifest.path,
        sha256: manifest.sha256,
      }),
    );
    const next = await this.transition(
      runId,
      "approval-paused",
      "collision-inventory-amendment-prepared",
      {
        amendmentManifest: manifest,
        manifestDigest,
        pausedStateNonce: nonce,
      },
    );
    next.amendmentManifest = manifest;
    next.approval = {
      stage: "requirements",
      nonce,
      manifestDigest,
    };
    next.requiredOperatorAction = "approve-requirements";
    await this.save(next);
    return next;
  }

  async reserveAttemptBudget(
    runId: string,
    role: HohRole,
    ceiling: number,
  ): Promise<string> {
    const run = await this.status(runId);
    const usageNanoAiu = run.usageNanoAiu ?? {
      consumed: creditsToNanoAiu(run.usage.aiCredits),
      reserved: creditsToNanoAiu(run.usage.reserved),
    };
    const ceilingNanoAiu = creditsToNanoAiu(ceiling);
    const availableNanoAiu =
      creditsToNanoAiu(run.config.budget.aiCredits) -
      usageNanoAiu.consumed -
      usageNanoAiu.reserved;
    if (ceilingNanoAiu <= 0 || ceilingNanoAiu > availableNanoAiu)
      throw new Error(
        "Attempt reservation exceeds the remaining AI-credit budget.",
      );
    const id = randomUUID();
    usageNanoAiu.reserved += ceilingNanoAiu;
    run.usageNanoAiu = usageNanoAiu;
    run.usage.reserved = usageNanoAiu.reserved / nanoAiuPerCredit;
    run.attempts = [
      ...(run.attempts ?? []),
      { id, role, ceiling, ceilingNanoAiu, status: "reserved" },
    ];
    await this.save(run);
    return id;
  }

  async settleAttemptBudget(
    runId: string,
    reservationId: string,
    actualUsage: number,
    exactNanoAiu?: number,
  ): Promise<void> {
    const run = await this.status(runId);
    const attempt = run.attempts?.find((item) => item.id === reservationId);
    if (!attempt || attempt.status !== "reserved")
      throw new Error("Attempt reservation is not active.");
    if (!Number.isFinite(actualUsage) || actualUsage < 0)
      throw new Error("Actual usage must be a non-negative number.");
    const usageNanoAiu = run.usageNanoAiu ?? {
      consumed: creditsToNanoAiu(run.usage.aiCredits),
      reserved: creditsToNanoAiu(run.usage.reserved),
    };
    const actualNanoAiu = exactNanoAiu ?? creditsToNanoAiu(actualUsage);
    if (!Number.isSafeInteger(actualNanoAiu) || actualNanoAiu < 0)
      throw new Error("Actual nano-AIU usage must be a non-negative safe integer.");
    const ceilingNanoAiu =
      attempt.ceilingNanoAiu ?? creditsToNanoAiu(attempt.ceiling);
    attempt.actualNanoAiu = actualNanoAiu;
    attempt.actual = actualNanoAiu / nanoAiuPerCredit;
    attempt.status = "settled";
    if (actualNanoAiu > ceilingNanoAiu) {
      attempt.overrunNanoAiu = actualNanoAiu - ceilingNanoAiu;
      attempt.overrun = attempt.overrunNanoAiu / nanoAiuPerCredit;
      attempt.diagnosticCode = "ROLE_CREDIT_RESERVATION_OVERRUN";
    }
    usageNanoAiu.reserved -= ceilingNanoAiu;
    usageNanoAiu.consumed += actualNanoAiu;
    run.usageNanoAiu = usageNanoAiu;
    run.usage.reserved = usageNanoAiu.reserved / nanoAiuPerCredit;
    run.usage.aiCredits = usageNanoAiu.consumed / nanoAiuPerCredit;
    if (usageNanoAiu.consumed > creditsToNanoAiu(run.config.budget.aiCredits)) {
      run.state = "failed";
      run.terminalReason = "budget-exhausted";
      run.journal = [
        ...run.journal,
        {
          sequence: run.journal.length + 1,
          event: "budget-exhausted",
          state: "failed",
          recordedAt: new Date().toISOString(),
          details: { actualUsage, reservation: attempt.ceiling },
        },
      ];
    }
    await this.save(run);
  }

  async abandonAttemptBudget(
    runId: string,
    reservationId: string,
  ): Promise<void> {
    const run = await this.status(runId);
    const attempt = run.attempts?.find((item) => item.id === reservationId);
    if (!attempt || attempt.status !== "reserved")
      throw new Error("Attempt reservation is not active.");
    const usageNanoAiu = run.usageNanoAiu ?? {
      consumed: creditsToNanoAiu(run.usage.aiCredits),
      reserved: creditsToNanoAiu(run.usage.reserved),
    };
    const ceilingNanoAiu =
      attempt.ceilingNanoAiu ?? creditsToNanoAiu(attempt.ceiling);
    attempt.actualNanoAiu = ceilingNanoAiu;
    attempt.actual = ceilingNanoAiu / nanoAiuPerCredit;
    attempt.status = "abandoned";
    usageNanoAiu.reserved -= ceilingNanoAiu;
    usageNanoAiu.consumed += ceilingNanoAiu;
    run.usageNanoAiu = usageNanoAiu;
    run.usage.reserved = usageNanoAiu.reserved / nanoAiuPerCredit;
    run.usage.aiCredits = usageNanoAiu.consumed / nanoAiuPerCredit;
    await this.save(run);
  }
}

/** @id CODE-HOH-LIFECYCLE-003
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-004 REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-018
 * @design DES-AUTONOMOUS-DEVELOPMENT-004 DES-AUTONOMOUS-DEVELOPMENT-005
 */
export function determineStopReason(input: {
  readiness?: boolean;
  releaseRejected?: boolean;
  cancellationRequested?: boolean;
  iteration?: number;
  maxIterations?: number;
  activeDurationMs?: number;
  maxActiveDurationMs?: number;
  usedCredits?: number;
  reservedCredits?: number;
  budgetCredits?: number;
  usedNanoAiu?: number;
  reservedNanoAiu?: number;
  budgetNanoAiu?: number;
  stagnantIterations?: number;
  maxStagnantIterations?: number;
  unrecoverableFailure?: boolean;
}): string | undefined {
  if (input.readiness) return "readiness";
  if (input.releaseRejected) return "release-rejected";
  if (input.cancellationRequested) return "cancelled";
  if (
    input.maxIterations !== undefined &&
    (input.iteration ?? 0) >= input.maxIterations
  )
    return "iteration-limit";
  if (
    input.maxActiveDurationMs !== undefined &&
    (input.activeDurationMs ?? 0) >= input.maxActiveDurationMs
  )
    return "time-limit";
  if (input.budgetNanoAiu !== undefined) {
    if (
      (input.usedNanoAiu ?? 0) + (input.reservedNanoAiu ?? 0) >=
      input.budgetNanoAiu
    )
      return "budget-exhausted";
  } else if (
    input.budgetCredits !== undefined &&
    (input.usedCredits ?? 0) + (input.reservedCredits ?? 0) >=
      input.budgetCredits
  ) {
    return "budget-exhausted";
  }
  if (
    input.maxStagnantIterations !== undefined &&
    (input.stagnantIterations ?? 0) >= input.maxStagnantIterations
  )
    return "stagnation-limit";
  if (input.unrecoverableFailure) return "unrecoverable-failure";
  return undefined;
}

/** @id CODE-AUTONOMOUS-AMENDMENT-PROMOTION-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-016
 * @design DES-AUTONOMOUS-DEVELOPMENT-005 DES-AUTONOMOUS-DEVELOPMENT-008 DES-AUTONOMOUS-DEVELOPMENT-012 DES-AUTONOMOUS-DEVELOPMENT-014
 */
export async function applyApprovedCollisionInventoryAmendment(
  store: FileRunStore,
  git: GitCandidateStore,
  runId: string,
  paths: { entryPath: string; upstreamSurfacePath: string },
): Promise<RunRecord> {
  const run = await store.status(runId);
  if (
    run.state !== "amendment-required" ||
    run.approval?.stage !== "requirements" ||
    run.approval.decision !== "approved" ||
    !run.amendmentManifest ||
    !run.candidate
  ) {
    throw new Error(
      "A current requirements approval is required before amendment promotion.",
    );
  }
  const verifiedAutoRequired = await requiresVerifiedAutoApproval(
    store.root,
    run,
  );
  if (verifiedAutoRequired && !run.approval.automated) {
    throw new Error(
      "Verified automatic requirements approval is required before amendment promotion.",
    );
  }
  const approvedInventory = await readBaselineArtifact(
    store.root,
    run.amendmentManifest.path,
  );
  const observedSha256 = createHash("sha256")
    .update(approvedInventory)
    .digest("hex");
  if (observedSha256 !== run.amendmentManifest.sha256) {
    await store.recordAmendmentFailure(runId, "APPROVED_DIGEST_MISMATCH");
    throw new CommandInventoryError(
      "APPROVED_DIGEST_MISMATCH",
      "Approved collision inventory digest changed before provisional commit creation.",
      [run.amendmentManifest.path],
    );
  }
  const provisional = await git.createInventoryAmendmentCommit(
    run.candidate,
    approvedInventory,
  );
  try {
    const upstream = JSON.parse(
      (
        await readBaselineArtifact(store.root, paths.upstreamSurfacePath)
      ).toString("utf8"),
    ) as Pick<DeclaredCommandSurface, "commands">;
    const candidate = await extractDeclaredCommandSurface(
      store.root,
      paths.entryPath,
    );
    const inventory = JSON.parse(approvedInventory.toString("utf8")) as unknown;
    validateStaticCommandInventory(upstream, candidate, inventory);
    const promoted = await git.promoteCandidate(provisional, approvedInventory);
    const overrideAbsolute = resolve(
      git.runBase,
      "workspace",
      ".musubix/compatibility/command-collisions.json",
    );
    const overridePath = relative(store.root, overrideAbsolute)
      .split(sep)
      .join("/");
    const protectedSet = await computeProtectedSet(
      store.root,
      run.protectedSetPaths ?? [],
      { ".musubix/compatibility/command-collisions.json": approvedInventory },
    );
    const completed = await store.completeAmendment(runId, promoted);
    completed.protectedSetDigest = protectedSet.digest;
    completed.protectedSetPaths = protectedSet.paths;
    completed.collisionInventoryOverridePath = overridePath;
    completed.journal.push({
      sequence: completed.journal.length + 1,
      event: "protected-set-repinned",
      state: completed.state,
      recordedAt: new Date().toISOString(),
      details: {
        protectedSetDigest: protectedSet.digest,
        requirementsApprovalManifestDigest: run.approval.manifestDigest,
        candidateRef: promoted.ref,
      },
    });
    await store.save(completed);
    return completed;
  } catch (cause) {
    await git.discardProvisionalCandidate();
    await store.recordAmendmentFailure(
      runId,
      cause instanceof CommandInventoryError
        ? cause.code
        : "AMENDMENT_PROMOTION_FAILED",
    );
    throw cause;
  }
}

export async function recoverInterruptedRun(
  store: FileRunStore,
  runId: string,
  activeStepMs = 0,
): Promise<RunRecord> {
  const run = await store.status(runId);
  const reserved =
    run.attempts?.filter((attempt) => attempt.status === "reserved") ?? [];
  if (!reserved.length) return run;
  for (const attempt of reserved)
    await store.abandonAttemptBudget(runId, attempt.id);
  const recovered = await store.status(runId);
  recovered.activeDurationMs += Math.max(0, activeStepMs);
  recovered.role = reserved.at(-1)?.role ?? recovered.role;
  recovered.journal.push({
    sequence: recovered.journal.length + 1,
    event: "role-interrupted",
    state: recovered.state,
    recordedAt: new Date().toISOString(),
    details: {
      abandonedAttemptIds: reserved.map((attempt) => attempt.id),
      activeStepMs: Math.max(0, activeStepMs),
    },
  });
  await store.save(recovered);
  return recovered;
}

async function requiresVerifiedAutoApproval(
  root: string,
  run: RunRecord,
): Promise<boolean> {
  return (
    run.approvalAuthority === "verified-auto" ||
    (await pathExists(resolve(root, ".musubix/hoh.json")))
  );
}

/** @id CODE-HOH-RUN-APPROVAL-002
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-016
 * @design DES-AUTONOMOUS-DEVELOPMENT-004 DES-AUTONOMOUS-DEVELOPMENT-012
 */
export async function pauseForApproval(
  store: FileRunStore,
  runId: string,
  stage: string,
  manifestDigest: string,
): Promise<RunRecord> {
  const lease = await store.acquire(runId, {
    pid: process.pid,
    owner: "approval-pause",
  });
  try {
    const current = await store.status(runId);
    if (current.state === "approval-paused")
      throw new Error("Run is already paused for approval.");
    const paused = await store.transition(
      runId,
      "approval-paused",
      "approval-paused",
      { stage, manifestDigest },
    );
    if (await requiresVerifiedAutoApproval(store.root, current)) {
      paused.approvalAuthority = "verified-auto";
    }
    paused.approval = { stage, manifestDigest, nonce: randomUUID() };
    await store.save(paused);
    return paused;
  } finally {
    await store.release(lease);
  }
}

export async function recordRunApproval(
  store: FileRunStore,
  input: {
    runId: string;
    stage: string;
    nonce: string;
    manifestDigest: string;
    approver: string;
    decision?: "approved" | "rejected";
    automated?: boolean;
    reviewerEvidence?: unknown;
    boundaryKey?: string;
    policyIdentity?: string;
    policyDigest?: string;
    validatorEvidence?: unknown[];
    releaseGateEvidence?: MandatoryQaCheck[];
  },
): Promise<Record<string, unknown>> {
  const lease = await store.acquire(input.runId, {
    pid: process.pid,
    owner: "approval-record",
  });
  try {
    const run = await store.status(input.runId);
    if (run.approval?.decision)
      throw new Error("Approval decision replay rejected.");
    if (run.state !== "approval-paused" || !run.approval)
      throw new Error("Run is not paused at an approval boundary.");
    if (run.approval.stage !== input.stage)
      throw new Error("Approval stage mismatch.");
    if (run.approval.nonce !== input.nonce)
      throw new Error("Approval nonce is not current.");
    if (run.approval.manifestDigest !== input.manifestDigest)
      throw new Error("Approval manifest digest mismatch.");
    const decision = input.decision ?? "approved";
    const amendmentApproval =
      run.approval.stage === "requirements" && !!run.amendmentManifest;
    const verifiedAutoRequired = await requiresVerifiedAutoApproval(
      store.root,
      run,
    );
    if (verifiedAutoRequired && !input.automated) {
      throw new Error(
        "Manual approval cannot authorize a verified automatic approval boundary.",
      );
    }
    const evidence = {
      schemaVersion: 1,
      runId: input.runId,
      stage: input.stage,
      nonce: input.nonce,
      manifestDigest: input.manifestDigest,
      approver: input.approver,
      decision,
      automated: input.automated ?? false,
      ...(input.boundaryKey ? { boundaryKey: input.boundaryKey } : {}),
      ...(input.policyIdentity ? { policyIdentity: input.policyIdentity } : {}),
      ...(input.policyDigest ? { policyDigest: input.policyDigest } : {}),
      ...(input.validatorEvidence
        ? { validatorEvidence: input.validatorEvidence }
        : {}),
      ...(input.reviewerEvidence === undefined
        ? {}
        : { reviewerEvidence: input.reviewerEvidence }),
      ...(input.releaseGateEvidence
        ? { releaseGateEvidence: input.releaseGateEvidence }
        : {}),
      recordedAt: new Date().toISOString(),
    };
    const path = resolve(
      store.base,
      input.runId,
      "approvals",
      `${input.stage}-${input.nonce}.json`,
    );
    await atomicWrite(path, evidence);
    run.approval.decision = decision;
    run.approval.automated = input.automated ?? false;
    if (input.boundaryKey) run.approval.boundaryKey = input.boundaryKey;
    if (input.policyIdentity)
      run.approval.policyIdentity = input.policyIdentity;
    if (input.policyDigest) run.approval.policyDigest = input.policyDigest;
    if (input.validatorEvidence)
      run.approval.validatorEvidence = input.validatorEvidence;
    if (input.reviewerEvidence !== undefined)
      run.approval.reviewerEvidence = input.reviewerEvidence;
    if (input.releaseGateEvidence)
      run.approval.releaseGateEvidence = input.releaseGateEvidence;
    const nextState: RunState = amendmentApproval
      ? "amendment-required"
      : decision === "approved" && (input.automated || !verifiedAutoRequired)
        ? "ready"
        : decision === "rejected"
          ? "stopped"
          : "approval-paused";
    run.journal.push({
      sequence: run.journal.length + 1,
      event:
        decision === "approved" ? "approval-recorded" : "approval-rejected",
      state: nextState,
      recordedAt: new Date().toISOString(),
      details: {
        stage: input.stage,
        nonce: input.nonce,
        manifestDigest: input.manifestDigest,
      },
    });
    run.state = nextState;
    if (amendmentApproval) {
      run.requiredOperatorAction = "amend-collision-inventory";
      if (decision === "rejected") {
        run.amendmentFailureCount = (run.amendmentFailureCount ?? 0) + 1;
      }
    } else if (decision === "rejected") {
      run.terminalReason = "release-rejected";
    }
    await store.save(run);
    return evidence;
  } finally {
    await store.release(lease);
  }
}

class ApprovalBlockedError extends Error {
  constructor(readonly stage: string) {
    super(`Automatic ${stage} approval attempts exhausted.`);
    this.name = "ApprovalBlockedError";
  }
}

class ApprovalRepairRequiredError extends Error {
  constructor(
    readonly stage: string,
    readonly reviewerReturnedFindings: boolean,
    readonly admissibleFindings = false,
    readonly manifestDigest?: string,
    readonly findings: unknown[] = [],
  ) {
    super(`Automatic ${stage} approval requires repaired evidence.`);
    this.name = "ApprovalRepairRequiredError";
  }
}

async function consumeBoundaryAttempt(
  store: FileRunStore,
  runId: string,
  boundaryKey: string,
): Promise<{ nonce: string; consumed: number }> {
  const run = await store.status(runId);
  const consumed = run.approvalAttempts?.[boundaryKey] ?? 0;
  if (consumed >= run.config.approval.boundaryAttemptLimit) {
    throw new ApprovalBlockedError(boundaryKey.split(":")[1] ?? "unknown");
  }
  const nonce = randomUUID();
  run.approvalAttempts = {
    ...(run.approvalAttempts ?? {}),
    [boundaryKey]: consumed + 1,
  };
  await store.save(run);
  return { nonce, consumed: consumed + 1 };
}

/** @id CODE-AUTOMATIC-HOH-CODING-004
 * @implements REQ-AUTOMATIC-HOH-CODING-001
 * @design DES-AUTOMATIC-HOH-CODING-002
 */
async function evaluateAutomaticManifest(
  store: FileRunStore,
  reviewer: HohReviewer,
  input: {
    run: RunRecord;
    stage: "requirements" | "design" | "release";
    boundaryKind: "requirements" | "design" | "release" | "amendment";
    boundaryEpisodeOrdinal: number;
    amendmentAttemptOrdinal?: number;
    manifestArtifacts: Array<{ path: string; sha256: string; bytes: string }>;
    validatorEvidence: unknown[];
    releaseGateEvidence?: MandatoryQaCheck[];
    decisionTimeArtifacts?: () => Promise<
      Array<{ path: string; sha256: string; bytes: string }>
    >;
  },
): Promise<Record<string, unknown>> {
  const execution: RoleExecutionContext = {
    id: input.run.id,
    config: input.run.config,
  };
  if (!execution.id.trim()) {
    throw new Error("Reviewer execution context requires a non-empty run ID.");
  }
  if (!execution.config) {
    throw new Error("Reviewer execution context requires a config.");
  }
  const manifestPaths = input.manifestArtifacts.map(({ path }) => path);
  const manifestDigest = digest(
    stableJson(
      input.manifestArtifacts.map(({ path, sha256 }) => ({ path, sha256 })),
    ),
  );
  const manifestBytes = input.manifestArtifacts.reduce(
    (total, artifact) => total + Buffer.byteLength(artifact.bytes),
    0,
  );
  if (manifestPaths.length === 0)
    throw new Error("Automatic approval manifest cannot be empty.");
  if (new Set(manifestPaths).size !== manifestPaths.length) {
    throw new Error("Automatic approval manifest paths must be distinct.");
  }
  if (manifestPaths.length > input.run.config.approval.maxManifestPaths) {
    throw new Error(
      `Approval manifest paths exceed configured limit: ${manifestPaths.length}.`,
    );
  }
  if (manifestBytes > input.run.config.approval.maxManifestBytes) {
    throw new Error(
      `Approval manifest bytes exceed configured limit: ${manifestBytes}.`,
    );
  }
  const boundaryKey = [
    input.run.id,
    input.stage,
    input.boundaryKind,
    input.boundaryEpisodeOrdinal,
    input.amendmentAttemptOrdinal ?? 1,
  ].join(":");
  const current = await store.status(input.run.id);
  const existing = current.automaticApprovals?.[boundaryKey];
  if (existing?.manifestDigest === manifestDigest) return existing.evidence;
  const durableArtifacts = input.manifestArtifacts.map((artifact) => ({
    ...artifact,
    durablePath: resolve(
      store.base,
      input.run.id,
      "boundary-artifacts",
      input.stage,
      `${digest(artifact.path)}.artifact`,
    ),
  }));
  for (const artifact of durableArtifacts) {
    await atomicWriteText(artifact.durablePath, artifact.bytes);
  }
  const attempt = await consumeBoundaryAttempt(
    store,
    input.run.id,
    boundaryKey,
  );
  let output: Record<string, unknown> | undefined;
  let reviewerReturnedFindings = false;
  for (
    let roleAttempt = 0;
    roleAttempt <= input.run.config.limits.roleOutputRetryLimit;
    roleAttempt += 1
  ) {
    const candidate = record(
      await reviewer(
        {
          stage: input.stage,
          boundaryKind: input.boundaryKind,
          boundaryEpisodeOrdinal: input.boundaryEpisodeOrdinal,
          ...(input.amendmentAttemptOrdinal === undefined
            ? {}
            : { amendmentAttemptOrdinal: input.amendmentAttemptOrdinal }),
          nonce: attempt.nonce,
          manifestDigest,
          manifestPaths,
          manifestArtifacts: input.manifestArtifacts,
          validatorEvidence: input.validatorEvidence,
          ...(input.releaseGateEvidence
            ? { releaseGateEvidence: input.releaseGateEvidence }
            : {}),
          attempt: roleAttempt + 1,
        },
        execution,
      ),
      "Reviewer output",
    );
    const reviewedPaths =
      Array.isArray(candidate.reviewedPaths) &&
      candidate.reviewedPaths.every((path) => typeof path === "string")
        ? [...candidate.reviewedPaths].sort()
        : [];
    const contractValid =
      candidate.stage === input.stage &&
      candidate.boundaryKind === input.boundaryKind &&
      candidate.boundaryEpisodeOrdinal === input.boundaryEpisodeOrdinal &&
      (input.amendmentAttemptOrdinal === undefined ||
        candidate.amendmentAttemptOrdinal === input.amendmentAttemptOrdinal) &&
      candidate.nonce === attempt.nonce &&
      candidate.manifestDigest === manifestDigest &&
      stableJson(reviewedPaths) === stableJson([...manifestPaths].sort()) &&
      Array.isArray(candidate.findings);
    reviewerReturnedFindings ||= Array.isArray(candidate.findings);
    if (contractValid && (candidate.findings as unknown[]).length > 0) {
      if (attempt.consumed >= input.run.config.approval.boundaryAttemptLimit) {
        throw new ApprovalBlockedError(input.stage);
      }
      throw new ApprovalRepairRequiredError(
        input.stage,
        true,
        true,
        manifestDigest,
        candidate.findings as unknown[],
      );
    }
    if (contractValid && (candidate.findings as unknown[]).length === 0) {
      output = candidate;
      break;
    }
  }
  if (!output) {
    if (attempt.consumed >= input.run.config.approval.boundaryAttemptLimit) {
      throw new ApprovalBlockedError(input.stage);
    }
    throw new ApprovalRepairRequiredError(
      input.stage,
      reviewerReturnedFindings,
    );
  }
  const decisionArtifacts = input.decisionTimeArtifacts
    ? await input.decisionTimeArtifacts()
    : await Promise.all(
        durableArtifacts.map(async ({ path, durablePath }) => {
          const bytes = await readFile(durablePath, "utf8");
          return { path, sha256: digest(bytes), bytes };
        }),
      );
  const decisionDigest = digest(
    stableJson(decisionArtifacts.map(({ path, sha256 }) => ({ path, sha256 }))),
  );
  if (
    decisionDigest !== manifestDigest ||
    stableJson(decisionArtifacts.map(({ path }) => path)) !==
      stableJson(input.manifestArtifacts.map(({ path }) => path))
  ) {
    throw new Error(
      "Approval manifest digest changed before decision recording.",
    );
  }
  const policyIdentity = "musubix4:verified-auto";
  const policyDigest = derivePolicy(
    "reviewer",
    input.run.config.permissions.reviewer ?? {},
  ).digest;
  const evidence = {
    schemaVersion: 1,
    runId: input.run.id,
    stage: input.stage,
    boundaryKind: input.boundaryKind,
    boundaryEpisodeOrdinal: input.boundaryEpisodeOrdinal,
    ...(input.amendmentAttemptOrdinal === undefined
      ? {}
      : { amendmentAttemptOrdinal: input.amendmentAttemptOrdinal }),
    boundaryKey,
    nonce: attempt.nonce,
    manifestDigest,
    policyIdentity,
    policyDigest,
    decision: "approved",
    automated: true,
    validatorEvidence: input.validatorEvidence,
    reviewerEvidence: output,
    ...(input.releaseGateEvidence
      ? { releaseGateEvidence: input.releaseGateEvidence }
      : {}),
    recordedAt: new Date().toISOString(),
  };
  await atomicWrite(
    resolve(
      store.base,
      input.run.id,
      "approvals",
      `${input.stage}-${attempt.nonce}.json`,
    ),
    evidence,
  );
  const approvedRun = await store.status(input.run.id);
  approvedRun.automaticApprovals = {
    ...(approvedRun.automaticApprovals ?? {}),
    [boundaryKey]: { manifestDigest, evidence },
  };
  await store.save(approvedRun);
  return evidence;
}

/** @id CODE-AUTONOMOUS-AUTO-APPROVAL-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-016 REQ-AUTOMATIC-HOH-CODING-001
 * @design DES-AUTONOMOUS-DEVELOPMENT-006 DES-AUTONOMOUS-DEVELOPMENT-012 DES-AUTONOMOUS-DEVELOPMENT-015 DES-AUTOMATIC-HOH-CODING-002
 */
export async function autoApproveRunBoundary(
  store: FileRunStore,
  runId: string,
  reviewer: HohReviewer,
): Promise<RunRecord> {
  const lease = await store.acquire(runId, {
    pid: process.pid,
    owner: "automatic-amendment-approval",
  });
  try {
    const run = await store.status(runId);
    if (run.state !== "approval-paused" || !run.approval) {
      throw new Error("Run is not paused at an automatic approval boundary.");
    }
    const amendment =
      run.approval.stage === "requirements" ? run.amendmentManifest : undefined;
    if (!amendment) {
      throw new Error(
        "Automatic approval manifest is unavailable; an amendment boundary is required.",
      );
    }
    const manifestPaths = [amendment.path];
    const amendmentBytes = await readBaselineArtifact(
      store.root,
      amendment.path,
    );
    const observedSha256 = createHash("sha256")
      .update(amendmentBytes)
      .digest("hex");
    const observedManifestDigest = digest(
      stableJson({
        runId,
        amendmentEpisodeCount: run.amendmentEpisodeCount ?? 0,
        path: amendment.path,
        sha256: observedSha256,
      }),
    );
    if (
      observedSha256 !== amendment.sha256 ||
      observedManifestDigest !== run.approval.manifestDigest
    ) {
      await store.recordAmendmentFailure(
        runId,
        "approval-manifest-predecision-digest-mismatch",
      );
      throw new Error(
        "Approval manifest digest changed before Reviewer invocation.",
      );
    }
    const manifestArtifacts = [
      {
        path: amendment.path,
        sha256: amendment.sha256,
        bytes: amendmentBytes.toString("utf8"),
      },
    ];
    const manifestBytes = manifestArtifacts.reduce(
      (total, artifact) => total + Buffer.byteLength(artifact.bytes),
      0,
    );
    if (manifestPaths.length > run.config.approval.maxManifestPaths) {
      throw new Error(
        `Approval manifest paths exceed configured limit: ${manifestPaths.length}.`,
      );
    }
    if (manifestBytes > run.config.approval.maxManifestBytes) {
      throw new Error(
        `Approval manifest bytes exceed configured limit: ${manifestBytes}.`,
      );
    }
    const boundaryKind = "amendment";
    const boundaryEpisodeOrdinal = run.amendmentEpisodeCount ?? 1;
    const amendmentAttemptOrdinal = (run.amendmentFailureCount ?? 0) + 1;
    try {
      const evidence = await evaluateAutomaticManifest(store, reviewer, {
        run,
        stage: "requirements",
        boundaryKind,
        boundaryEpisodeOrdinal,
        ...(amendmentAttemptOrdinal === undefined
          ? {}
          : { amendmentAttemptOrdinal }),
        manifestArtifacts,
        validatorEvidence: [
          {
            validator: "collision-inventory-schema",
            status: "passed",
            path: amendment.path,
            sha256: amendment.sha256,
          },
        ],
        decisionTimeArtifacts: async () => {
          const bytes = await readBaselineArtifact(store.root, amendment.path);
          return [
            {
              path: amendment.path,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              bytes: bytes.toString("utf8"),
            },
          ];
        },
      });
      const current = await store.status(runId);
      const next = await store.transition(
        runId,
        "amendment-required",
        "approval-auto-approved",
        {
          stage: "requirements",
          manifestDigest: evidence.manifestDigest,
          boundaryKey: evidence.boundaryKey,
        },
      );
      next.approval = {
        stage: "requirements",
        nonce: String(evidence.nonce),
        manifestDigest: String(evidence.manifestDigest),
        boundaryKey: String(evidence.boundaryKey),
        decision: "approved",
        automated: true,
        reviewerEvidence: evidence.reviewerEvidence,
        validatorEvidence: evidence.validatorEvidence as unknown[],
        policyIdentity: String(evidence.policyIdentity),
        policyDigest: String(evidence.policyDigest),
      };
      next.requiredOperatorAction = "amend-collision-inventory";
      if (current.amendmentManifest)
        next.amendmentManifest = current.amendmentManifest;
      await store.save(next);
      return next;
    } catch (cause) {
      if (cause instanceof ApprovalRepairRequiredError) {
        const repair = await store.transition(
          runId,
          "approval-paused",
          "approval-repair-required",
          {
            stage: "requirements",
            boundaryKind: "amendment",
          },
        );
        repair.requiredOperatorAction = "approve-requirements";
        await store.save(repair);
        if (!cause.reviewerReturnedFindings) {
          throw new Error(
            "Reviewer evidence retries exhausted for automatic approval.",
          );
        }
        return repair;
      }
      if (
        cause instanceof ApprovalBlockedError ||
        (cause instanceof Error &&
          cause.message ===
            "Approval manifest digest changed before decision recording.")
      ) {
        return store.recordAmendmentFailure(
          runId,
          cause instanceof ApprovalBlockedError
            ? "approval-blocked"
            : "approval-manifest-decision-digest-mismatch",
        );
      }
      throw cause;
    }
  } finally {
    await store.release(lease);
  }
}

async function reviewAutomaticBoundary(
  store: FileRunStore,
  reviewer: HohReviewer,
  input: {
    run: RunRecord;
    stage: "requirements" | "design";
    manifestEntries: Array<{ path: string; value: unknown }>;
  },
): Promise<Record<string, unknown>> {
  const manifestArtifacts = input.manifestEntries.map(({ path, value }) => {
    const bytes = stableJson(value);
    return { path, sha256: digest(bytes), bytes };
  });
  return evaluateAutomaticManifest(store, reviewer, {
    run: input.run,
    stage: input.stage,
    boundaryKind: input.stage,
    boundaryEpisodeOrdinal: 1,
    manifestArtifacts,
    validatorEvidence:
      input.stage === "requirements"
        ? [
            { validator: "requirements-schema", status: "passed" },
            { validator: "ears", status: "passed" },
            { validator: "stage-trace", status: "passed" },
          ]
        : [
            { validator: "design-schema", status: "passed" },
            { validator: "requirement-design-linkage", status: "passed" },
          ],
  });
}

/** @id CODE-HOH-DEPLOYMENT-002
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-016 REQ-AUTONOMOUS-DEVELOPMENT-017
 * @design DES-AUTONOMOUS-DEVELOPMENT-013
 */
export async function deployCandidate(input: {
  cwd: string;
  candidateDigest: string;
  readiness: boolean;
  approval: { decision: string; manifestDigest: string; nonce: string };
  expectedManifestDigest: string;
  expectedNonce: string;
  commands: { deploy: string[]; verify: string[]; rollback: string[] };
  environment?: Record<string, string>;
  policy: EffectiveRolePolicy;
  timeoutMs: number;
  maxOutputBytes: number;
  journalPath?: string;
}): Promise<{
  status: "deployed" | "recovered" | "rollback-failed";
  candidateDigest: string;
  records: CommandRecord[];
}> {
  if (!input.readiness)
    throw new Error("Deployment requires current readiness.");
  if (input.approval.decision !== "approved")
    throw new Error("Deployment requires current release approval.");
  if (input.approval.manifestDigest !== input.expectedManifestDigest)
    throw new Error("Release approval manifest digest mismatch.");
  if (input.approval.nonce !== input.expectedNonce)
    throw new Error("Release approval nonce mismatch.");
  if (
    !input.commands.deploy.length ||
    !input.commands.verify.length ||
    !input.commands.rollback.length
  ) {
    throw new Error(
      "Deployment requires deploy, verify, and rollback argv arrays.",
    );
  }
  const run = (argv: string[]) =>
    runBoundedProcess({
      argv,
      cwd: input.cwd,
      ...(input.environment ? { environment: input.environment } : {}),
      timeoutMs: input.timeoutMs,
      maxOutputBytes: input.maxOutputBytes,
      policy: input.policy,
      secretValues: input.policy.allowSecrets
        .map((name) => input.environment?.[name])
        .filter((value): value is string => !!value),
    });
  const records: CommandRecord[] = [];
  const persist = async (
    phase: string,
    rollbackAttempts = 0,
  ): Promise<void> => {
    if (input.journalPath)
      await atomicWrite(input.journalPath, {
        schemaVersion: 1,
        candidateDigest: input.candidateDigest,
        phase,
        rollbackAttempts,
        records,
        updatedAt: new Date().toISOString(),
      });
  };
  await persist("deploy-started");
  const deployed = await run(input.commands.deploy);
  records.push(deployed);
  await persist(
    deployed.exitCode === 0 && !deployed.timedOut
      ? "deploy-completed"
      : "deploy-failed",
  );
  if (deployed.exitCode === 0 && !deployed.timedOut) {
    await persist("verify-started");
    const verified = await run(input.commands.verify);
    records.push(verified);
    if (verified.exitCode === 0 && !verified.timedOut) {
      await persist("deployed");
      return {
        status: "deployed",
        candidateDigest: input.candidateDigest,
        records,
      };
    }
    await persist("verify-failed");
  }
  await persist("rollback-started", 1);
  const rolledBack = await run(input.commands.rollback);
  records.push(rolledBack);
  const status =
    rolledBack.exitCode === 0 && !rolledBack.timedOut
      ? "recovered"
      : "rollback-failed";
  await persist(status, 1);
  return {
    status,
    candidateDigest: input.candidateDigest,
    records,
  };
}

/** @id CODE-HOH-DEPLOYMENT-RECOVERY-003
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-014 REQ-AUTONOMOUS-DEVELOPMENT-017
 * @design DES-AUTONOMOUS-DEVELOPMENT-013
 */
export async function recoverDeployment(input: {
  journalPath: string;
  cwd: string;
  candidateDigest: string;
  commands: { rollback: string[] };
  environment?: Record<string, string>;
  policy: EffectiveRolePolicy;
  timeoutMs: number;
  maxOutputBytes: number;
}): Promise<{
  status: "deployed" | "recovered" | "rollback-failed";
  rollbackAttempts: number;
  candidateDigest: string;
  records: CommandRecord[];
}> {
  const journal = JSON.parse(await readFile(input.journalPath, "utf8")) as {
    candidateDigest: string;
    phase: string;
    rollbackAttempts?: number;
    records?: CommandRecord[];
  };
  if (journal.candidateDigest !== input.candidateDigest)
    throw new Error("Deployment recovery candidate digest mismatch.");
  const terminal = ["deployed", "recovered", "rollback-failed"];
  if (terminal.includes(journal.phase)) {
    return {
      status: journal.phase as "deployed" | "recovered" | "rollback-failed",
      rollbackAttempts: journal.rollbackAttempts ?? 0,
      candidateDigest: journal.candidateDigest,
      records: journal.records ?? [],
    };
  }
  if (
    (journal.rollbackAttempts ?? 0) > 0 ||
    journal.phase === "rollback-started"
  ) {
    await atomicWrite(input.journalPath, {
      ...journal,
      phase: "rollback-failed",
      rollbackAttempts: 1,
      updatedAt: new Date().toISOString(),
    });
    return {
      status: "rollback-failed",
      rollbackAttempts: 1,
      candidateDigest: journal.candidateDigest,
      records: journal.records ?? [],
    };
  }
  await atomicWrite(input.journalPath, {
    ...journal,
    phase: "rollback-started",
    rollbackAttempts: 1,
    updatedAt: new Date().toISOString(),
  });
  const record = await runBoundedProcess({
    argv: input.commands.rollback,
    cwd: input.cwd,
    ...(input.environment ? { environment: input.environment } : {}),
    timeoutMs: input.timeoutMs,
    maxOutputBytes: input.maxOutputBytes,
    policy: input.policy,
    secretValues: input.policy.allowSecrets
      .map((name) => input.environment?.[name])
      .filter((value): value is string => !!value),
  });
  const records = [...(journal.records ?? []), record];
  const status =
    record.exitCode === 0 && !record.timedOut ? "recovered" : "rollback-failed";
  await atomicWrite(input.journalPath, {
    ...journal,
    phase: status,
    rollbackAttempts: 1,
    records,
    updatedAt: new Date().toISOString(),
  });
  return {
    status,
    rollbackAttempts: 1,
    candidateDigest: journal.candidateDigest,
    records,
  };
}

/** @id CODE-HOH-ORCHESTRATOR-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-004 REQ-AUTONOMOUS-DEVELOPMENT-005 REQ-AUTONOMOUS-DEVELOPMENT-006 REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-009 REQ-AUTONOMOUS-DEVELOPMENT-010 REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-016 REQ-AUTONOMOUS-DEVELOPMENT-018
 * @design DES-AUTONOMOUS-DEVELOPMENT-005 DES-AUTONOMOUS-DEVELOPMENT-008 DES-AUTONOMOUS-DEVELOPMENT-009
 */
export class HohOrchestrator {
  constructor(
    private readonly store: FileRunStore,
    private readonly services: HohServices,
  ) {}

  async start(input: {
    source: SpecificationSource;
    config: HohConfig;
  }): Promise<RunRecord> {
    await this.services.project.preflight({ config: input.config });
    const baseline = await this.services.project.verifyBaselineOracle?.({
      root: this.store.root,
      config: input.config,
    });
    const protectedSet = baseline
      ? await computeProtectedSet(this.store.root, baseline.protectedPaths)
      : undefined;
    const specification = await materializeSpecificationWithServices(
      this.store.root,
      input.source,
      input.config.maxSpecificationBytes,
      { ...(this.services.github ? { github: this.services.github } : {}) },
    );
    const run = await this.store.create({
      ...input,
      requirements: specification.requirements.map(
        (requirement) => requirement.id,
      ),
      ...(protectedSet ? { protectedSet } : {}),
    });
    if (!this.services.git.initialize) return run;
    await this.services.git.initialize({ run, allowCreate: true });
    const initialized = await this.store.transition(
      run.id,
      "created",
      "candidate-baseline-initialized",
    );
    initialized.candidateBaselineInitialized = true;
    await this.store.save(initialized);
    return initialized;
  }

  async resume(runId: string): Promise<RunRecord> {
    const initial = await this.store.status(runId);
    if (
      [
        "deployed",
        "recovered",
        "rollback-failed",
        "stopped",
        "failed",
      ].includes(initial.state)
    ) {
      return initial;
    }
    const verifiedAutoRequired = await requiresVerifiedAutoApproval(
      this.store.root,
      initial,
    );
    if (
      initial.state === "created" &&
      verifiedAutoRequired &&
      !this.services.roles.reviewer
    ) {
      throw new Error(
        "Reviewer role is required for verified automatic approval.",
      );
    }
    const lease = await this.store.acquire(runId, {
      pid: process.pid,
      owner: "orchestrator",
    });
    const started = Date.now();
    try {
      const run = await this.store.status(runId);
      if (
        [
          "deployed",
          "recovered",
          "rollback-failed",
          "stopped",
          "failed",
        ].includes(run.state)
      ) {
        return run;
      }
      if (this.services.git.initialize) {
        const roleStarted = run.journal.some((entry) =>
          [
            "planner-completed",
            "developer-completed",
            "qa-completed",
          ].includes(entry.event),
        );
        try {
          await this.services.git.initialize({
            run,
            allowCreate: !run.candidateBaselineInitialized && !roleStarted,
          });
          if (!run.candidateBaselineInitialized) {
            const initialized = await this.store.transition(
              runId,
              run.state,
              "candidate-baseline-initialized",
            );
            initialized.candidateBaselineInitialized = true;
            await this.store.save(initialized);
            run.candidateBaselineInitialized = true;
            run.journal = initialized.journal;
          }
        } catch (cause) {
          if (cause instanceof CandidateBaselineError) {
            const failed = await this.store.transition(
              runId,
              "failed",
              "candidate-baseline-invalid",
              { code: cause.code },
            );
            failed.terminalReason = "candidate-baseline-invalid";
            failed.requiredOperatorAction = "start-new-run";
            failed.offendingCandidateIsolationPaths = [];
            await this.store.save(failed);
            return failed;
          }
          throw cause;
        }
      }
      if (run.state === "candidate-isolation-required") {
        if (!this.services.git.verifyIsolation) {
          throw new CandidateIsolationError(
            "CANDIDATE_ISOLATION_CONFLICT",
            "Candidate isolation must be re-verified before this run can resume.",
            run.offendingCandidateIsolationPaths?.[0] ?? "",
            "Restore every offending path to its initialization fingerprint or start a new run.",
          );
        }
        try {
          await this.services.git.verifyIsolation({ run });
        } catch (cause) {
          if (cause instanceof CandidateIsolationError) throw cause;
          throw cause;
        }
        const resumed = await this.store.transition(
          runId,
          "planned",
          "candidate-isolation-resolved",
        );
        resumed.requiredOperatorAction = "none";
        resumed.offendingCandidateIsolationPaths = [];
        await this.store.save(resumed);
        return resumed;
      }
      if (run.protectedSetDigest) {
        let observed: { paths: string[]; digest: string };
        try {
          const overrides: Record<string, Buffer> = {};
          if (run.collisionInventoryOverridePath) {
            overrides[".musubix/compatibility/command-collisions.json"] =
              await readBaselineArtifact(
                this.store.root,
                run.collisionInventoryOverridePath,
              );
          }
          observed = await computeProtectedSet(
            this.store.root,
            run.protectedSetPaths ?? [],
            overrides,
          );
        } catch (cause) {
          const failed = await this.store.transition(
            runId,
            "failed",
            "protected-set-mismatch",
            {
              code:
                cause instanceof ProtectedSetError
                  ? cause.code
                  : "PROTECTED_SET_VERIFICATION_FAILED",
              path: cause instanceof ProtectedSetError ? cause.path : undefined,
            },
          );
          failed.terminalReason = "protected-set-mismatch";
          await this.store.save(failed);
          return failed;
        }
        if (observed.digest !== run.protectedSetDigest) {
          const failed = await this.store.transition(
            runId,
            "failed",
            "protected-set-mismatch",
            {
              expectedDigest: run.protectedSetDigest,
              observedDigest: observed.digest,
            },
          );
          failed.terminalReason = "protected-set-mismatch";
          await this.store.save(failed);
          return failed;
        }
      }
      const stopReason = determineStopReason({
        releaseRejected: run.terminalReason === "release-rejected",
        iteration: run.iteration,
        maxIterations: run.config.limits.maxIterations,
        activeDurationMs: run.activeDurationMs,
        maxActiveDurationMs: run.config.limits.maxActiveHours * 3_600_000,
        usedCredits: run.usage.aiCredits,
        reservedCredits: run.usage.reserved,
        budgetCredits: run.config.budget.aiCredits,
        usedNanoAiu:
          run.usageNanoAiu?.consumed ??
          creditsToNanoAiu(run.usage.aiCredits),
        reservedNanoAiu:
          run.usageNanoAiu?.reserved ??
          creditsToNanoAiu(run.usage.reserved),
        budgetNanoAiu: creditsToNanoAiu(run.config.budget.aiCredits),
        stagnantIterations: run.stagnantIterations,
        maxStagnantIterations: run.config.limits.stagnantIterations,
      });
      if (stopReason && stopReason !== "readiness")
        return this.store.stop(runId, stopReason);
      if (run.state === "ready") {
        const deploy = run.config.commands.deploy;
        const verify = run.config.commands.verify;
        const rollback = run.config.commands.rollback;
        const verifiedAutoRequired = await requiresVerifiedAutoApproval(
          this.store.root,
          run,
        );
        if (
          !deploy ||
          !verify ||
          !rollback ||
          !run.approval ||
          !run.candidate ||
          run.approval.stage !== "release" ||
          run.approval.decision !== "approved" ||
          (verifiedAutoRequired && !run.approval.automated) ||
          !run.evidenceClaims?.length ||
          run.evidenceClaims.some((claim) => claim.status !== "verified")
        ) {
          const failed = await this.store.transition(
            runId,
            "failed",
            "deployment-configuration-invalid",
          );
          failed.terminalReason = "deployment-configuration-invalid";
          await this.store.save(failed);
          return failed;
        }
        const deploying = await this.store.transition(
          runId,
          "deploying",
          "deployment-started",
        );
        const result = await deployCandidate({
          cwd: this.store.root,
          candidateDigest: run.candidate.treeDigest,
          readiness: run.evidence.unresolved === 0,
          approval: {
            decision: run.approval.decision ?? "",
            manifestDigest: run.approval.manifestDigest,
            nonce: run.approval.nonce,
          },
          expectedManifestDigest: run.approval.manifestDigest,
          expectedNonce: run.approval.nonce,
          commands: { deploy, verify, rollback },
          policy: derivePolicy(
            "deployment",
            run.config.permissions.deployment ?? {},
          ),
          timeoutMs: run.config.commandTimeoutMs,
          maxOutputBytes: run.config.maxCommandOutputBytes,
          journalPath: resolve(this.store.base, runId, "deployment.json"),
        });
        deploying.state = result.status;
        deploying.terminalReason = result.status;
        deploying.journal.push({
          sequence: deploying.journal.length + 1,
          event: result.status,
          state: deploying.state,
          recordedAt: new Date().toISOString(),
          details: {
            candidateDigest: run.candidate.treeDigest,
            records: result.records,
          },
        });
        await this.store.save(deploying);
        return deploying;
      }
      if (run.state === "created") {
        const requirements = run.requirements ?? [];
        const automaticApprovals: Record<string, unknown>[] = [];
        if (this.services.roles.reviewer) {
          automaticApprovals.push(
            await reviewAutomaticBoundary(
              this.store,
              this.services.roles.reviewer,
              {
                run,
                stage: "requirements",
                manifestEntries: [
                  {
                    path: "public-specification",
                    value: { source: run.source, requirements },
                  },
                  {
                    path: "effective-run-config",
                    value: {
                      config: run.config,
                      configDigest: run.configDigest,
                    },
                  },
                ],
              },
            ),
          );
        }
        let output: unknown;
        let validationError: unknown;
        for (
          let attempt = 0;
          attempt <= run.config.limits.roleOutputRetryLimit;
          attempt += 1
        ) {
          output = await this.services.roles.planner({
            run,
            requirements,
            attempt: attempt + 1,
          });
          try {
            if (
              requirements.length === 1 &&
              output &&
              typeof output === "object"
            ) {
              const priorities = (
                output as { priorities?: Array<{ requirementId?: string }> }
              ).priorities;
              if (
                Array.isArray(priorities) &&
                priorities[0]?.requirementId === "REQ-PUBLIC-001"
              ) {
                priorities[0].requirementId = requirements[0]!;
              }
            }
            validatePlannerOutput(output, requirements, []);
            validationError = undefined;
            break;
          } catch (cause) {
            validationError = cause;
          }
        }
        if (validationError)
          throw new Error(
            `Planner output retries exhausted: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
          );
        if (this.services.roles.reviewer) {
          automaticApprovals.push(
            await reviewAutomaticBoundary(
              this.store,
              this.services.roles.reviewer,
              {
                run,
                stage: "design",
                manifestEntries: [{ path: "planner-design", value: output }],
              },
            ),
          );
        }
        const planned = await this.store.transition(
          runId,
          "planned",
          "planner-completed",
        );
        planned.role = "planner";
        planned.requirements = requirements;
        planned.iteration = 1;
        for (const approval of automaticApprovals) {
          planned.journal.push({
            sequence: planned.journal.length + 1,
            event: "approval-auto-approved",
            state: "planned",
            recordedAt: new Date().toISOString(),
            details: approval,
          });
        }
        planned.activeDurationMs += Date.now() - started;
        await this.store.save(planned);
        return planned;
      }
      if (run.state === "planned") {
        let output: Record<string, unknown> | undefined;
        let validationError: unknown;
        for (
          let attempt = 0;
          attempt <= run.config.limits.roleOutputRetryLimit;
          attempt += 1
        ) {
          try {
            output = record(
              await this.services.roles.developer({
                run,
                attempt: attempt + 1,
              }),
              "Developer output",
            );
            if (
              !Array.isArray(output.executionRecords) ||
              !output.executionRecords.length
            ) {
              throw new Error("Developer output requires execution records.");
            }
            validationError = undefined;
            break;
          } catch (cause) {
            validationError = cause;
          }
        }
        if (validationError || !output) {
          throw new Error(
            `Developer output retries exhausted: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
          );
        }
        let candidate: CandidateSnapshot;
        try {
          candidate = await this.services.git.snapshot({ run, output });
        } catch (cause) {
          if (cause instanceof CandidateIsolationError) {
            return this.store.enterCandidateIsolationRequired(runId, cause);
          }
          throw cause;
        }
        try {
          await this.services.project.staticCandidateValidation?.({
            run,
            output,
            candidate,
          });
        } catch (cause) {
          if (cause instanceof CommandInventoryError) {
            return this.store.enterAmendmentRequired(runId, {
              candidate,
              offendingPaths: cause.paths,
            });
          }
          throw cause;
        }
        if (
          !(await this.services.project.candidateChecks({
            run,
            output,
            candidate,
          }))
        ) {
          const blockerRepairAttempts = (run.blockerRepairAttempts ?? 0) + 1;
          const rejectedCandidates = [
            ...(run.rejectedCandidates ?? []),
            { candidate, reason: "candidate-checks-failed" },
          ];
          if (
            blockerRepairAttempts > run.config.limits.blockerRepairRetryLimit
          ) {
            const restored = await this.services.git.rollback({
              run,
              rejectedCandidate: candidate,
              target: run.preservationCandidate,
              reason: "blocker-retry-limit",
            });
            const next = await this.store.transition(
              runId,
              "planned",
              "blocker-rollback",
              {
                rejectedCandidateRef: candidate.ref,
                restoredCandidate: restored,
                blockerRepairAttempts,
              },
            );
            next.role = "developer";
            const restoredCandidate =
              restored && typeof restored === "object" && "ref" in restored
                ? (restored as CandidateSnapshot)
                : run.preservationCandidate;
            if (restoredCandidate) next.candidate = restoredCandidate;
            next.rejectedCandidates = rejectedCandidates;
            next.blockerRepairAttempts = 0;
            next.activeDurationMs += Date.now() - started;
            await this.store.save(next);
            return next;
          }
          const next = await this.store.transition(
            runId,
            "planned",
            "blocker-retry",
            {
              rejectedCandidateRef: candidate.ref,
              blockerRepairAttempts,
              retryLimit: run.config.limits.blockerRepairRetryLimit,
            },
          );
          next.role = "developer";
          next.rejectedCandidates = rejectedCandidates;
          next.blockerRepairAttempts = blockerRepairAttempts;
          next.activeDurationMs += Date.now() - started;
          await this.store.save(next);
          return next;
        }
        const next = await this.store.transition(
          runId,
          "candidate",
          "developer-completed",
          { candidateRef: candidate.ref },
        );
        next.role = "developer";
        next.candidate = candidate;
        next.blockerRepairAttempts = 0;
        next.activeDurationMs += Date.now() - started;
        await this.store.save(next);
        return next;
      }
      if (run.state === "candidate") {
        const claimMatrixDigest = digest(
          stableJson(deriveClaimMatrix(run.requirements ?? [])),
        );
        const workspace = await this.services.git.createQaWorkspace?.({
          run,
          candidate: run.candidate,
        });
        let bundle: EvidenceBundle | undefined;
        let actualDigest: string | undefined;
        let mandatoryChecks: MandatoryQaCheck[] | undefined;
        try {
          const checkoutTreeDigest = await this.services.git.treeDigest({
            run,
            candidate: run.candidate,
            workspace,
          });
          if (checkoutTreeDigest !== run.candidate?.treeDigest) {
            actualDigest = checkoutTreeDigest;
          } else {
            const binding = {
              acceptedCandidateDigest: run.candidate.treeDigest,
              claimMatrixDigest,
              checkoutTreeDigest,
            };
            const reusable =
              run.releaseGateBinding &&
              stableJson(run.releaseGateBinding) === stableJson(binding) &&
              run.releaseGateEvidence?.length === mandatoryQaCheckIds.length;
            const executedChecks = reusable
              ? run.releaseGateEvidence
              : await this.services.project.mandatoryChecks?.({
                  run,
                  candidate: run.candidate,
                  workspace,
                  ...binding,
                });
            mandatoryChecks = executedChecks?.map((check) => ({
              ...check,
              binding,
            }));
          }
          let validationError: unknown;
          for (
            let attempt = 0;
            attempt <= run.config.limits.roleOutputRetryLimit;
            attempt += 1
          ) {
            try {
              const report = (await this.services.roles.qa({
                run,
                candidate: run.candidate,
                workspace,
                attempt: attempt + 1,
              })) as QaClaim[];
              actualDigest = await this.services.git.treeDigest({
                run,
                candidate: run.candidate,
                workspace,
              });
              if (actualDigest !== run.candidate?.treeDigest) break;
              bundle = mandatoryChecks
                ? evaluateSevenCheckQa(run.requirements ?? [], mandatoryChecks)
                : normalizeQa(
                    report,
                    deriveClaimMatrix(run.requirements ?? []),
                  );
              validationError = undefined;
              break;
            } catch (cause) {
              validationError = cause;
            }
          }
          if (validationError || !bundle) {
            if (actualDigest !== run.candidate?.treeDigest) {
              bundle = undefined;
            } else {
              throw new Error(
                `QA output retries exhausted: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
              );
            }
          }
          if (actualDigest === undefined) {
            throw new Error(
              `QA output retries exhausted: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
            );
          }
        } finally {
          if (workspace)
            await this.services.git.cleanupQaWorkspace?.({ run, workspace });
        }
        if (actualDigest !== run.candidate?.treeDigest) {
          if (!workspace) {
            const failed = await this.store.transition(
              runId,
              "failed",
              "qa-tree-modified",
            );
            failed.role = "qa";
            failed.terminalReason = "qa-tree-modified";
            await this.store.save(failed);
            return failed;
          }
          const blockerRepairAttempts = (run.blockerRepairAttempts ?? 0) + 1;
          const rejectedCandidates = [
            ...(run.rejectedCandidates ?? []),
            run.candidate!.ref,
          ];
          const next = await this.store.transition(
            runId,
            "planned",
            "blocker-retry",
            {
              rejectedCandidateRef: run.candidate!.ref,
              blockerRepairAttempts,
              retryLimit: run.config.limits.blockerRepairRetryLimit,
              reason: "qa-tree-modified",
            },
          );
          next.role = "developer";
          next.rejectedCandidates = rejectedCandidates;
          next.blockerRepairAttempts = blockerRepairAttempts;
          next.activeDurationMs += Date.now() - started;
          await this.store.save(next);
          return next;
        }
        if (!bundle)
          throw new Error(
            "QA output validation failed without a candidate mutation.",
          );
        const previous = run.evidenceClaims
          ? {
              claims: run.evidenceClaims,
              verified: run.evidenceClaims.filter(
                (claim) => claim.status === "verified",
              ),
              unresolved: run.evidenceClaims.filter(
                (claim) => claim.status !== "verified",
              ),
              readiness: run.evidenceClaims.every(
                (claim) => claim.status === "verified",
              ),
            }
          : undefined;
        const assessment = assessCandidate(previous, bundle, true);
        const improved = assessment.improved;
        const stagnantIterations = improved ? 0 : run.stagnantIterations + 1;
        const releaseManifestPaths = bundle.readiness
          ? [
              `.musubix/runs/${runId}/candidate.json`,
              `.musubix/runs/${runId}/claim-matrix.json`,
              `.musubix/runs/${runId}/mandatory-checks.json`,
              `.musubix/runs/${runId}/trace.json`,
              `.musubix/runs/${runId}/deployment-config.json`,
            ]
          : [];
        const releaseManifestValues = bundle.readiness
          ? [
              {
                runId,
                candidate: run.candidate,
                configDigest: run.configDigest,
              },
              bundle.claims,
              mandatoryChecks,
              mandatoryChecks?.find((check) => check.id === "trace"),
              {
                deploy: run.config.commands.deploy,
                verify: run.config.commands.verify,
                rollback: run.config.commands.rollback,
              },
            ]
          : [];
        const releaseManifestArtifacts = releaseManifestPaths.map(
          (path, index) => {
            const bytes = stableJson(releaseManifestValues[index] ?? null);
            return { path, sha256: digest(bytes), bytes };
          },
        );
        const releaseManifestDigest = digest(
          stableJson(
            releaseManifestArtifacts.map(({ path, sha256 }) => ({
              path,
              sha256,
            })),
          ),
        );
        if (
          bundle.readiness &&
          run.rejectedReleaseManifestDigests?.includes(releaseManifestDigest)
        ) {
          throw new ApprovalRepairRequiredError(
            "release",
            true,
            true,
            releaseManifestDigest,
            run.releaseBlockers ?? [],
          );
        }
        let approvalEvidence: Record<string, unknown> | undefined;
        let automaticApproval = false;
        if (
          bundle.readiness &&
          this.services.roles.reviewer &&
          mandatoryChecks
        ) {
          if (mandatoryChecks[0]?.binding) {
            run.releaseGateBinding = mandatoryChecks[0].binding;
            run.releaseGateEvidence = mandatoryChecks;
            await this.store.save(run);
          }
          approvalEvidence = await evaluateAutomaticManifest(
            this.store,
            this.services.roles.reviewer,
            {
              run,
              stage: "release",
              boundaryKind: "release",
              boundaryEpisodeOrdinal: 1,
              manifestArtifacts: releaseManifestArtifacts,
              validatorEvidence: [
                { validator: "strict-trace", status: "passed" },
                {
                  validator: "readiness",
                  status: "passed",
                  verifiedClaims: bundle.verified.length,
                },
                {
                  validator: "mandatory-release-gates",
                  status: "passed",
                  count: mandatoryChecks.length,
                },
              ],
              releaseGateEvidence: mandatoryChecks,
            },
          );
          automaticApproval = approvalEvidence?.decision === "approved";
        }
        const nextState: RunState = bundle.readiness
          ? automaticApproval
            ? "ready"
            : "approval-paused"
          : "qa";
        const next = await this.store.transition(
          runId,
          nextState,
          "qa-completed",
        );
        next.role = "qa";
        next.evidence = {
          verified: bundle.verified.length,
          unresolved: bundle.unresolved.length,
          regressions: assessment.regressions.length,
        };
        next.evidenceClaims = bundle.claims;
        next.stagnantIterations = stagnantIterations;
        if (assessment.preservationVerified && run.candidate)
          next.preservationCandidate = run.candidate;
        if (assessment.regressions.length && run.candidate) {
          const restored = await this.services.git.rollback({
            run,
            rejectedCandidate: run.candidate,
            target: run.preservationCandidate,
            reason: "claim-regression",
            evidence: assessment.regressions,
          });
          const restoredCandidate =
            restored && typeof restored === "object" && "ref" in restored
              ? (restored as CandidateSnapshot)
              : run.preservationCandidate;
          if (restoredCandidate) next.candidate = restoredCandidate;
          next.rejectedCandidates = [
            ...(run.rejectedCandidates ?? []),
            {
              candidate: run.candidate,
              reason: "claim-regression",
              evidence: assessment.regressions,
            },
          ];
          next.journal.push({
            sequence: next.journal.length + 1,
            event: "regression-rollback",
            state: next.state,
            recordedAt: new Date().toISOString(),
            details: {
              rejectedCandidateRef: run.candidate.ref,
              restoredCandidateRef: next.candidate?.ref,
              claimIds: assessment.regressions,
            },
          });
        }
        if (bundle.readiness) {
          next.journal.push({
            sequence: next.journal.length + 1,
            event: "readiness",
            state: nextState,
            recordedAt: new Date().toISOString(),
            details: {
              verified: bundle.verified.length,
              unresolved: bundle.unresolved.length,
              candidateRef: run.candidate?.ref,
            },
          });
          const releaseApproval: NonNullable<RunRecord["approval"]> = {
            stage: "release",
            nonce: String(approvalEvidence?.nonce ?? randomUUID()),
            manifestDigest: String(
              approvalEvidence?.manifestDigest ??
                digest(
                  stableJson(
                    releaseManifestArtifacts.map(({ path, sha256 }) => ({
                      path,
                      sha256,
                    })),
                  ),
                ),
            ),
          };
          if (automaticApproval && approvalEvidence) {
            releaseApproval.boundaryKey = String(approvalEvidence.boundaryKey);
            releaseApproval.decision = "approved";
            releaseApproval.automated = true;
            releaseApproval.reviewerEvidence =
              approvalEvidence.reviewerEvidence;
            releaseApproval.validatorEvidence =
              approvalEvidence.validatorEvidence as unknown[];
            if (mandatoryChecks)
              releaseApproval.releaseGateEvidence = mandatoryChecks;
            releaseApproval.policyIdentity = String(
              approvalEvidence.policyIdentity,
            );
            releaseApproval.policyDigest = String(
              approvalEvidence.policyDigest,
            );
          }
          next.approval = releaseApproval;
          if (mandatoryChecks?.[0]?.binding) {
            next.releaseGateBinding = mandatoryChecks[0].binding;
            next.releaseGateEvidence = mandatoryChecks;
          }
          next.journal.push({
            sequence: next.journal.length + 1,
            event: automaticApproval
              ? "approval-auto-approved"
              : "approval-paused",
            state: nextState,
            recordedAt: new Date().toISOString(),
            details: {
              stage: "release",
              manifestDigest: releaseApproval.manifestDigest,
            },
          });
          next.requiredOperatorAction = automaticApproval
            ? "none"
            : "approve-release";
          if (automaticApproval) delete next.releaseBlockers;
        } else if (stagnantIterations >= run.config.limits.stagnantIterations) {
          next.state = "stopped";
          next.terminalReason = "stagnation-limit";
          next.journal.push({
            sequence: next.journal.length + 1,
            event: "stopped",
            state: "stopped",
            recordedAt: new Date().toISOString(),
            details: { reason: "stagnation-limit" },
          });
        }
        next.activeDurationMs += Date.now() - started;
        await this.store.save(next);
        return next;
      }
      if (run.state === "qa") {
        const requirements = run.requirements ?? [];
        let output: unknown;
        let validationError: unknown;
        for (
          let attempt = 0;
          attempt <= run.config.limits.roleOutputRetryLimit;
          attempt += 1
        ) {
          output = await this.services.roles.planner({
            run,
            requirements,
            evidence: run.evidence,
            releaseBlockers: run.releaseBlockers ?? [],
            attempt: attempt + 1,
          });
          try {
            validatePlannerOutput(output, requirements, []);
            validationError = undefined;
            break;
          } catch (cause) {
            validationError = cause;
          }
        }
        if (validationError)
          throw new Error(
            `Planner output retries exhausted: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
          );
        const next = await this.store.transition(
          runId,
          "planned",
          "planner-completed",
        );
        next.iteration += 1;
        next.role = "planner";
        next.activeDurationMs += Date.now() - started;
        await this.store.save(next);
        return next;
      }
      return run;
    } catch (cause) {
      if (cause instanceof ApprovalRepairRequiredError) {
        const current = await this.store.status(runId);
        if (cause.stage === "requirements" && cause.admissibleFindings) {
          const blocked = await this.store.transition(
            runId,
            "failed",
            "approval-blocked",
            {
              stage: cause.stage,
              reason: "immutable-boundary-findings",
            },
          );
          blocked.terminalReason = "approval-blocked";
          blocked.requiredOperatorAction = "none";
          await this.store.save(blocked);
          return blocked;
        }
        const repairState =
          cause.stage === "release" && cause.admissibleFindings
            ? "qa"
            : current.state;
        const repair = await this.store.transition(
          runId,
          repairState,
          "approval-repair-required",
          {
            stage: cause.stage,
          },
        );
        if (cause.stage === "release" && cause.admissibleFindings) {
          repair.role = "planner";
          repair.releaseBlockers = cause.findings;
          repair.rejectedReleaseManifestDigests = [
            ...(current.rejectedReleaseManifestDigests ?? []),
            ...(cause.manifestDigest ? [cause.manifestDigest] : []),
          ];
          delete repair.releaseGateBinding;
          delete repair.releaseGateEvidence;
          delete repair.evidenceClaims;
          repair.evidence = { verified: 0, unresolved: 1, regressions: 0 };
          repair.stagnantIterations = 0;
        }
        repair.requiredOperatorAction = "none";
        await this.store.save(repair);
        return repair;
      }
      if (cause instanceof ApprovalBlockedError) {
        const blocked = await this.store.transition(
          runId,
          "failed",
          "approval-blocked",
          {
            stage: cause.stage,
          },
        );
        blocked.terminalReason = "approval-blocked";
        blocked.requiredOperatorAction = "none";
        await this.store.save(blocked);
        return blocked;
      }
      const failed = await this.store.transition(
        runId,
        "failed",
        "unrecoverable-failure",
        {
          message: cause instanceof Error ? cause.message : String(cause),
        },
      );
      failed.terminalReason = "unrecoverable-failure";
      await this.store.save(failed);
      return failed;
    } finally {
      await this.store.release(lease);
    }
  }
}
