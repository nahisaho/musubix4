import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import ts from 'typescript';
import { readText } from './files.js';

export const GRAPH_PERFORMANCE_PIN_PATH = '.musubix/benchmarks/graph-cache-target.json';
export const GRAPH_PERFORMANCE_EVIDENCE_PATH = '.musubix/evidence/graph-performance.json';

export const GRAPH_BENCHMARK_COMMANDS = [
  { name: 'requirementsValidate', args: ['requirements', 'validate', '.musubix/features/safe-workflow-speed/requirements.md'] },
  { name: 'designValidate', args: ['design', 'validate', '.musubix/features/safe-workflow-speed/design.md'] },
  { name: 'traceBuild', args: ['trace', 'build'] },
  { name: 'traceCheckStrict', args: ['trace', 'check', '--strict'] },
  { name: 'graphIndex', args: ['graph', 'index'] },
  { name: 'graphGate', args: ['graph', 'gate'] },
  { name: 'graphImpact', args: ['graph', 'impact', 'packages/analysis/src/graph.ts'] },
  { name: 'status', args: ['status'] },
  { name: 'knowledgeBuild', args: ['knowledge', 'build'] },
] as const;

const PERFORMANCE_ROOTS = [
  'packages/analysis/src/graph.ts',
  'packages/analysis/src/gate.ts',
  'packages/analysis/src/change.ts',
  'packages/cli/src/main.ts',
] as const;

const candidateOnlyPaths = ['scripts/benchmark-graph-cache.mjs'] as const;

export interface GraphPerformancePin {
  schemaVersion: 1;
  repository: string;
  commit: string;
  targetContentSha256: string;
  targetDigestAlgorithm: 'sha256-sorted-git-path-nul-blob-bytes-nul-v1';
  lockfilePath: string;
  lockfileSha256: string;
}

interface TimedProcess {
  executable: string;
  args: string[];
  durationMs: number;
  exitCode: number;
}

interface CommandMeasurements {
  samples: Record<'improvementReference' | 'regressionReference' | 'candidate', TimedProcess[]>;
  medians: Record<'improvementReference' | 'regressionReference' | 'candidate', number>;
  improvementRatio?: number;
  regressionRatio: number;
  passed: boolean;
}

export interface GraphPerformanceEvidence {
  schemaVersion: 2;
  outcome: 'passed';
  generatedAt: string;
  passed: boolean;
  diagnostic?: string;
  platform: string;
  architecture: string;
  nodeVersion: string;
  typescriptVersion: string;
  pin: GraphPerformancePin & { fileSha256: string };
  commands: Array<{ name: string; args: string[] }>;
  warmups: Record<'improvementReference' | 'regressionReference' | 'candidate', TimedProcess>;
  setup: Array<{
    build: string;
    kind: string;
    executable: string;
    args: string[];
    durationMs: number;
    exitCode: number;
  }>;
  builds: {
    improvementReference: { version: string; performanceSurfaceSha256: string };
    regressionReference: { version: string; performanceSurfaceSha256: string };
    candidate: { version: string; performanceSurfaceSha256: string };
  };
  results: Record<string, CommandMeasurements>;
}

export function graphPerformanceOutcome(passed: boolean): 'passed' | 'failed' {
  return passed ? 'passed' : 'failed';
}

export function graphPerformanceFailureDiagnostic(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const evidence = value as {
    schemaVersion?: unknown;
    outcome?: unknown;
    passed?: unknown;
    diagnostic?: unknown;
  };
  return evidence.schemaVersion === 2
    && evidence.outcome === 'failed'
    && evidence.passed === false
    && typeof evidence.diagnostic === 'string'
    && evidence.diagnostic.length > 0
    ? evidence.diagnostic
    : null;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveSourceModule(root: string, importer: string, specifier: string): Promise<string | null> {
  if (!specifier.startsWith('.')) return null;
  const exact = resolve(dirname(importer), specifier);
  const candidates = [
    exact,
    exact.replace(/\.js$/, '.ts'),
    exact.replace(/\.js$/, '.tsx'),
    exact.replace(/\.mjs$/, '.mts'),
    exact.replace(/\.cjs$/, '.cts'),
    `${exact}.ts`,
    `${exact}.tsx`,
    resolve(exact, 'index.ts'),
    resolve(exact, 'index.js'),
  ];
  for (const candidate of [...new Set(candidates)]) {
    const normalized = resolve(candidate);
    const path = relative(root, normalized).replaceAll('\\', '/');
    if (path === '..' || path.startsWith('../') || isAbsolute(path)) {
      throw new Error(`Performance source module escapes repository root: ${specifier} from ${relative(root, importer)}`);
    }
    if (await pathExists(normalized)) return normalized;
  }
  throw new Error(`Performance source module is unresolved: ${specifier} from ${relative(root, importer)}`);
}

export async function graphPerformanceSurfaceDigest(root: string, candidate: boolean): Promise<string> {
  const pending = PERFORMANCE_ROOTS.map((path) => resolve(root, path));
  const visited = new Map<string, Buffer>();
  while (pending.length > 0) {
    const path = resolve(pending.pop()!);
    if (visited.has(path)) continue;
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Performance source is unreadable: ${relative(root, path)}: ${message}`);
    }
    visited.set(path, bytes);
    for (const imported of ts.preProcessFile(bytes.toString('utf8'), true, true).importedFiles) {
      const target = await resolveSourceModule(root, path, imported.fileName);
      if (target) pending.push(target);
    }
  }
  if (candidate) {
    for (const path of candidateOnlyPaths) {
      const absolute = resolve(root, path);
      try {
        visited.set(absolute, await readFile(absolute));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Performance source is unreadable: ${path}: ${message}`);
      }
    }
  }
  const hash = createHash('sha256');
  for (const [path, bytes] of [...visited].sort(([left], [right]) =>
    Buffer.from(relative(root, left).replaceAll('\\', '/'))
      .compare(Buffer.from(relative(root, right).replaceAll('\\', '/'))))) {
    hash.update(relative(root, path).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

export function graphPerformanceThresholdPass(
  commandName: string,
  medians: {
    improvementReference: number;
    regressionReference: number;
    candidate: number;
  },
): boolean {
  return commandName === 'graphIndex' || commandName === 'graphGate'
    ? medians.candidate / medians.improvementReference <= 0.8
    : medians.candidate / medians.regressionReference <= 1.05;
}

function stableVersions(changelog: string): string[] {
  return changelog.split(/\r?\n/)
    .flatMap((line) => /^##\s+(\d+\.\d+\.\d+)\s+-\s+\d{4}-\d{2}-\d{2}$/.exec(line)?.[1] ?? [])
    .filter((value, index, values) => values.indexOf(value) === index);
}

function compareStable(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = a[index]! - b[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

export async function loadGraphPerformancePin(root: string): Promise<GraphPerformancePin & { fileSha256: string }> {
  const pinText = await readText(root, GRAPH_PERFORMANCE_PIN_PATH);
  const requirement = await readText(root, '.musubix/features/safe-workflow-speed/requirements.md');
  const matches = [...requirement.matchAll(
    /`\.musubix\/benchmarks\/graph-cache-target\.json`, whose approved file SHA-256 is `([a-f0-9]{64})`/g,
  )];
  if (matches.length !== 1) throw new Error('REQ-SAFE-WORKFLOW-SPEED-003 must contain exactly one benchmark pin SHA-256.');
  const fileSha256 = createHash('sha256').update(pinText).digest('hex');
  if (fileSha256 !== matches[0]![1]) throw new Error(`${GRAPH_PERFORMANCE_PIN_PATH} does not match its approved SHA-256.`);
  const value = JSON.parse(pinText) as Partial<GraphPerformancePin>;
  if (value.schemaVersion !== 1
    || typeof value.repository !== 'string'
    || !/^[a-f0-9]{40}$/.test(value.commit ?? '')
    || !/^[a-f0-9]{64}$/.test(value.targetContentSha256 ?? '')
    || value.targetDigestAlgorithm !== 'sha256-sorted-git-path-nul-blob-bytes-nul-v1'
    || typeof value.lockfilePath !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.lockfileSha256 ?? '')) {
    throw new Error(`${GRAPH_PERFORMANCE_PIN_PATH} is malformed.`);
  }
  return { ...(value as GraphPerformancePin), fileSha256 };
}

/** @id CODE-SAFE-WORKFLOW-SPEED-006
 * @implements REQ-SAFE-WORKFLOW-SPEED-003
 * @design DES-SAFE-WORKFLOW-SPEED-006
 */
export async function validateGraphPerformanceEvidence(root: string): Promise<GraphPerformanceEvidence> {
  let evidence: GraphPerformanceEvidence;
  try {
    evidence = JSON.parse(await readText(root, GRAPH_PERFORMANCE_EVIDENCE_PATH)) as GraphPerformanceEvidence;
  } catch (cause) {
    throw new Error(`${GRAPH_PERFORMANCE_EVIDENCE_PATH} is missing or malformed; run node scripts/benchmark-graph-cache.mjs. ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const failureDiagnostic = graphPerformanceFailureDiagnostic(evidence);
  if (failureDiagnostic) {
    throw new Error(`${GRAPH_PERFORMANCE_EVIDENCE_PATH} reports a failed benchmark: ${failureDiagnostic}`);
  }
  const pin = await loadGraphPerformancePin(root);
  const pkg = JSON.parse(await readText(root, 'package.json')) as { version?: unknown };
  const versions = stableVersions(await readText(root, 'CHANGELOG.md'));
  const preceding = versions.filter((version) =>
    typeof pkg.version === 'string' && compareStable(version, pkg.version) < 0)
    .sort(compareStable)
    .at(-1);
  const expectedCommands = GRAPH_BENCHMARK_COMMANDS.map(({ name, args }) => ({ name, args: [...args] }));
  const candidateDigest = await graphPerformanceSurfaceDigest(root, true);
  if (evidence.schemaVersion !== 2
    || evidence.outcome !== 'passed'
    || evidence.passed !== true
    || JSON.stringify(evidence.pin) !== JSON.stringify(pin)
    || JSON.stringify(evidence.commands) !== JSON.stringify(expectedCommands)
    || evidence.builds?.candidate?.version !== pkg.version
    || evidence.builds.candidate.performanceSurfaceSha256 !== candidateDigest
    || evidence.builds?.improvementReference?.version !== '0.1.2'
    || evidence.builds?.regressionReference?.version !== preceding) {
    throw new Error(`${GRAPH_PERFORMANCE_EVIDENCE_PATH} is stale or failing; run node scripts/benchmark-graph-cache.mjs.`);
  }
  if (!Array.isArray(evidence.setup) || evidence.setup.length === 0
    || evidence.setup.some((entry) =>
      entry.exitCode !== 0
      || !Number.isFinite(entry.durationMs)
      || entry.durationMs < 0
      || typeof entry.executable !== 'string'
      || entry.executable.length === 0
      || !Array.isArray(entry.args))) {
    throw new Error(`${GRAPH_PERFORMANCE_EVIDENCE_PATH} has invalid setup execution evidence; run node scripts/benchmark-graph-cache.mjs.`);
  }
  for (const key of ['improvementReference', 'regressionReference', 'candidate'] as const) {
    const warmup = evidence.warmups?.[key];
    if (!warmup
      || warmup.exitCode !== 0
      || !Number.isFinite(warmup.durationMs)
      || warmup.durationMs < 0
      || typeof warmup.executable !== 'string'
      || warmup.executable.length === 0
      || JSON.stringify(warmup.args) !== JSON.stringify(['graph', 'index'])) {
      throw new Error(`${GRAPH_PERFORMANCE_EVIDENCE_PATH} has invalid ${key} warm-up evidence; run node scripts/benchmark-graph-cache.mjs.`);
    }
  }
  for (const command of GRAPH_BENCHMARK_COMMANDS) {
    const result = evidence.results?.[command.name];
    if (!result) throw new Error(`${GRAPH_PERFORMANCE_EVIDENCE_PATH} is missing ${command.name}; run node scripts/benchmark-graph-cache.mjs.`);
    for (const key of ['improvementReference', 'regressionReference', 'candidate'] as const) {
      const samples = result.samples?.[key];
      if (!Array.isArray(samples) || samples.length !== 5 || samples.some((sample) =>
        sample.exitCode !== 0
        || !Number.isFinite(sample.durationMs)
        || sample.durationMs < 0
        || typeof sample.executable !== 'string'
        || sample.executable.length === 0
        || JSON.stringify(sample.args) !== JSON.stringify(command.args))) {
        throw new Error(`${GRAPH_PERFORMANCE_EVIDENCE_PATH} has invalid ${command.name} ${key} samples; run node scripts/benchmark-graph-cache.mjs.`);
      }
      if (Math.abs(result.medians[key] - median(samples.map((sample) => sample.durationMs))) > 0.001) {
        throw new Error(`${GRAPH_PERFORMANCE_EVIDENCE_PATH} has an invalid ${command.name} ${key} median; run node scripts/benchmark-graph-cache.mjs.`);
      }
    }
    const expectedRegression = result.medians.candidate / result.medians.regressionReference;
    if (Math.abs(result.regressionRatio - expectedRegression) > 0.000001) {
      throw new Error(`${GRAPH_PERFORMANCE_EVIDENCE_PATH} has an invalid ${command.name} regression ratio; run node scripts/benchmark-graph-cache.mjs.`);
    }
    const expectedPass = graphPerformanceThresholdPass(command.name, result.medians);
    if (command.name === 'graphIndex' || command.name === 'graphGate') {
      const expectedImprovement = result.medians.candidate / result.medians.improvementReference;
      if (Math.abs((result.improvementRatio ?? Number.NaN) - expectedImprovement) > 0.000001) {
        throw new Error(`${GRAPH_PERFORMANCE_EVIDENCE_PATH} has an invalid ${command.name} improvement ratio; run node scripts/benchmark-graph-cache.mjs.`);
      }
    }
    if (result.passed !== expectedPass || !expectedPass) {
      throw new Error(`${GRAPH_PERFORMANCE_EVIDENCE_PATH} reports failed or inconsistent ${command.name}; run node scripts/benchmark-graph-cache.mjs.`);
    }
  }
  return evidence;
}
