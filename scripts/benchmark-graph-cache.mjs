import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const root = resolve('.');
const workspace = resolve('.test-work', `graph-benchmark-${randomUUID()}`);
const activeWorktrees = [];
const maxBuffer = 64 * 1024 * 1024;
const failureState = {
  pin: undefined,
  commands: [],
  setup: [],
  builds: {},
  roles: {},
  executions: {},
};
const evidencePath = resolve(root, '.musubix/evidence/graph-performance.json');

function stripProcessOutput(record) {
  const { stdout: _stdout, stderr: _stderr, ...result } = record;
  return result;
}

function writeAtomicEvidence(evidence) {
  mkdirSync(dirname(evidencePath), { recursive: true });
  const temporary = `${evidencePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`);
  renameSync(temporary, evidencePath);
}

let writeFailureEvidence = async (diagnostic) => {
  writeAtomicEvidence({
    schemaVersion: 2,
    outcome: 'failed',
    generatedAt: new Date().toISOString(),
    passed: false,
    diagnostic,
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    completed: {},
  });
};

/** @id CODE-SAFE-WORKFLOW-SPEED-007
 * @implements REQ-SAFE-WORKFLOW-SPEED-003
 * @design DES-SAFE-WORKFLOW-SPEED-006
 */
function run(command, args, options = {}) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    maxBuffer,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs ?? 300_000,
  });
  const record = {
    executable: options.recordExecutable ?? command,
    args: [...(options.recordArgs ?? args)],
    durationMs: performance.now() - started,
    exitCode: result.status ?? -1,
  };
  if (options.requireSuccess !== false && (result.error || result.status !== 0)) {
    const detail = result.error?.message ?? result.stderr ?? result.stdout;
    throw new Error(`${command} ${args.join(' ')} failed with exit ${record.exitCode}: ${detail}`);
  }
  return { ...record, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function addWorktree(path, ref) {
  run('git', ['worktree', 'add', '--detach', path, ref], { timeoutMs: 120_000 });
  activeWorktrees.push(path);
}

function verifyCleanCheckout(path, commit) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: path,
    encoding: 'utf8',
  }).trim();
  if (head !== commit) throw new Error(`Benchmark checkout ${path} resolved ${head}, expected ${commit}.`);
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: path,
    encoding: 'utf8',
  });
  if (status) throw new Error(`Benchmark checkout ${path} is not pristine before installation.`);
}

function targetDigest(commit) {
  const rows = execFileSync('git', ['ls-tree', '-r', '-z', commit], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer,
  }).toString('utf8').split('\0').filter(Boolean);
  const entries = rows.map((row) => {
    const tab = row.indexOf('\t');
    const [mode, type, object] = row.slice(0, tab).split(' ');
    return { mode, type, object, path: row.slice(tab + 1) };
  }).filter((entry) => entry.type === 'blob' && entry.mode !== '120000')
    .sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(entry.path.replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(execFileSync('git', ['cat-file', 'blob', entry.object], {
      cwd: root,
      encoding: 'buffer',
      maxBuffer,
    }));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function lockfileDigest(commit, path) {
  return createHash('sha256').update(execFileSync('git', ['show', `${commit}:${path}`], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer,
  })).digest('hex');
}

function median(samples) {
  const values = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)];
}

async function main() {
  mkdirSync(workspace, { recursive: true });
  rmSync(evidencePath, { force: true });

  const {
    GRAPH_BENCHMARK_COMMANDS,
    graphPerformanceOutcome,
    graphPerformanceThresholdPass,
    graphPerformanceSurfaceDigest,
    loadGraphPerformancePin,
    writeJson,
  } = await import('../dist/packages/analysis/src/index.js');
  const pin = await loadGraphPerformancePin(root);
  failureState.pin = pin;
  failureState.commands = GRAPH_BENCHMARK_COMMANDS.map(({ name, args }) => ({ name, args: [...args] }));
  writeFailureEvidence = async (diagnostic) => {
    await writeJson(root, '.musubix/evidence/graph-performance.json', {
      schemaVersion: 2,
      outcome: 'failed',
      generatedAt: new Date().toISOString(),
      passed: false,
      diagnostic,
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      typescriptVersion: (await import('typescript')).default.version,
      pin: failureState.pin,
      commands: failureState.commands,
      setup: failureState.setup.map(stripProcessOutput),
      completed: {
        builds: Object.fromEntries(Object.entries(failureState.roles)
          .flatMap(([role, version]) => failureState.builds[version]
            ? [[role, failureState.builds[version]]]
            : [])),
        executions: Object.fromEntries(Object.entries(failureState.executions).map(([role, results]) => [
          role,
          Object.fromEntries(Object.entries(results).map(([name, result]) => [
            name,
            {
              warmup: stripProcessOutput(result.warmup),
              samples: result.samples.map(stripProcessOutput),
            },
          ])),
        ])),
      },
    });
  };
  if (targetDigest(pin.commit) !== pin.targetContentSha256) {
    throw new Error('Pinned benchmark target content digest does not match its commit.');
  }
  if (lockfileDigest(pin.commit, pin.lockfilePath) !== pin.lockfileSha256) {
    throw new Error('Pinned benchmark target lockfile digest does not match its commit.');
  }

  const candidatePackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
  const stableVersions = [...changelog.matchAll(/^##\s+(\d+\.\d+\.\d+)\s+-\s+\d{4}-\d{2}-\d{2}$/gm)]
    .map((match) => match[1]);
  const compare = (left, right) => {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
      if (a[index] !== b[index]) return a[index] - b[index];
    }
    return 0;
  };
  const regressionVersion = stableVersions
    .filter((version) => compare(version, candidatePackage.version) < 0)
    .sort(compare)
    .at(-1);
  if (!regressionVersion) throw new Error('No preceding stable CHANGELOG version exists.');

  const improvementVersion = '0.1.2';
  failureState.roles = {
    improvementReference: improvementVersion,
    regressionReference: regressionVersion,
    candidate: 'candidate',
  };
  const referenceVersions = [...new Set([improvementVersion, regressionVersion])];
  const builds = failureState.builds;
  const buildRoots = {};
  for (const version of referenceVersions) {
    const buildRoot = resolve(workspace, `build-${version}`);
    addWorktree(buildRoot, `v${version}`);
    const releaseCommit = execFileSync('git', ['rev-list', '-n', '1', `v${version}`], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    verifyCleanCheckout(buildRoot, releaseCommit);
    const install = run('npm', ['ci'], { cwd: buildRoot, timeoutMs: 300_000 });
    failureState.setup.push({ build: version, kind: 'install', ...install });
    const build = run('npm', ['run', 'build'], { cwd: buildRoot, timeoutMs: 180_000 });
    failureState.setup.push({ build: version, kind: 'build', ...build });
    builds[version] = {
      version,
      performanceSurfaceSha256: await graphPerformanceSurfaceDigest(buildRoot, false),
    };
    buildRoots[version] = buildRoot;
  }

  const targetPlans = {};
  for (const [key, version] of [
    ['improvementReference', improvementVersion],
    ['regressionReference', regressionVersion],
    ['candidate', 'candidate'],
  ]) {
    if (version !== 'candidate' && targetPlans[version]) {
      targetPlans[key] = targetPlans[version];
      continue;
    }
    const targetRoot = resolve(workspace, `target-${key}`);
    addWorktree(targetRoot, pin.commit);
    verifyCleanCheckout(targetRoot, pin.commit);
    if (targetDigest(pin.commit) !== pin.targetContentSha256
      || lockfileDigest(pin.commit, pin.lockfilePath) !== pin.lockfileSha256) {
      throw new Error(`Target identity changed before ${key} installation.`);
    }
    const install = run('npm', ['ci'], { cwd: targetRoot, timeoutMs: 300_000 });
    failureState.setup.push({ build: key, kind: 'target-install', ...install });
    const cliRoot = version === 'candidate' ? root : buildRoots[version];
    const cli = resolve(cliRoot, 'dist/packages/cli/src/main.js');
    const plan = { cli, targetRoot };
    targetPlans[key] = plan;
    if (version !== 'candidate') targetPlans[version] = plan;
  }

  const candidateDigestBefore = await graphPerformanceSurfaceDigest(root, true);
  builds.candidate = {
    version: candidatePackage.version,
    performanceSurfaceSha256: candidateDigestBefore,
  };
  const candidateBuild = run('npm', ['run', 'build'], { timeoutMs: 180_000 });
  failureState.setup.push({ build: 'candidate', kind: 'build', ...candidateBuild });
  const candidateDigestBuilt = await graphPerformanceSurfaceDigest(root, true);
  if (candidateDigestBuilt !== candidateDigestBefore) {
    throw new Error('Candidate performance source changed while building immediately before measurement.');
  }

  const executions = failureState.executions;
  const completedByVersion = {};
  for (const [key, version] of [
    ['improvementReference', improvementVersion],
    ['regressionReference', regressionVersion],
    ['candidate', 'candidate'],
  ]) {
    if (version !== 'candidate' && completedByVersion[version]) {
      executions[key] = completedByVersion[version];
      continue;
    }
    const { cli, targetRoot } = targetPlans[key];
    const warmup = run(process.execPath, [cli, 'graph', 'index'], {
      cwd: targetRoot,
      timeoutMs: 120_000,
      recordExecutable: cli,
      recordArgs: ['graph', 'index'],
    });
    const results = Object.fromEntries(GRAPH_BENCHMARK_COMMANDS.map((command) => [
      command.name,
      { warmup, samples: [] },
    ]));
    executions[key] = results;
    for (let sample = 0; sample < 5; sample += 1) {
      for (const command of GRAPH_BENCHMARK_COMMANDS) {
        results[command.name].samples.push(run(process.execPath, [cli, ...command.args], {
          cwd: targetRoot,
          timeoutMs: 120_000,
          recordExecutable: cli,
          recordArgs: command.args,
        }));
      }
    }
    if (version !== 'candidate') completedByVersion[version] = results;
  }

  const results = {};
  let passed = true;
  for (const command of GRAPH_BENCHMARK_COMMANDS) {
    const samples = {
      improvementReference: executions.improvementReference[command.name].samples.map(stripProcessOutput),
      regressionReference: executions.regressionReference[command.name].samples.map(stripProcessOutput),
      candidate: executions.candidate[command.name].samples.map(stripProcessOutput),
    };
    const medians = {
      improvementReference: median(samples.improvementReference),
      regressionReference: median(samples.regressionReference),
      candidate: median(samples.candidate),
    };
    const improvementRatio = medians.candidate / medians.improvementReference;
    const regressionRatio = medians.candidate / medians.regressionReference;
    const commandPassed = graphPerformanceThresholdPass(command.name, medians);
    passed &&= commandPassed;
    results[command.name] = {
      samples,
      medians,
      ...(command.name === 'graphIndex' || command.name === 'graphGate'
        ? { improvementRatio }
        : {}),
      regressionRatio,
      passed: commandPassed,
    };
  }

  const candidateDigestAfter = await graphPerformanceSurfaceDigest(root, true);
  if (candidateDigestAfter !== candidateDigestBefore) {
    throw new Error('Candidate performance source changed during benchmark execution.');
  }
  const evidence = {
    schemaVersion: 2,
    outcome: graphPerformanceOutcome(passed),
    generatedAt: new Date().toISOString(),
    passed,
    ...(passed
      ? {}
      : {
          diagnostic: `Performance thresholds failed: ${Object.entries(results)
            .filter(([, result]) => !result.passed)
            .map(([name, result]) => `${name} regression=${result.regressionRatio.toFixed(6)}${result.improvementRatio === undefined ? '' : ` improvement=${result.improvementRatio.toFixed(6)}`}`)
            .join(', ')}. Re-run node scripts/benchmark-graph-cache.mjs after correcting the regression.`,
        }),
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    typescriptVersion: (await import('typescript')).default.version,
    pin,
    commands: failureState.commands,
    warmups: {
      improvementReference: stripProcessOutput(executions.improvementReference.graphIndex.warmup),
      regressionReference: stripProcessOutput(executions.regressionReference.graphIndex.warmup),
      candidate: stripProcessOutput(executions.candidate.graphIndex.warmup),
    },
    setup: failureState.setup.map(stripProcessOutput),
    builds: {
      improvementReference: builds[improvementVersion],
      regressionReference: builds[regressionVersion],
      candidate: builds.candidate,
    },
    results,
  };
  await writeJson(root, '.musubix/evidence/graph-performance.json', evidence);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  if (!passed) process.exitCode = 1;
}

try {
  await main();
} catch (cause) {
  const diagnostic = cause instanceof Error ? cause.message : String(cause);
  if (writeFailureEvidence) {
    try {
      await writeFailureEvidence(`${diagnostic} Re-run node scripts/benchmark-graph-cache.mjs after correcting the reported failure.`);
    } catch (writeCause) {
      process.stderr.write(`Unable to write failing benchmark evidence: ${writeCause instanceof Error ? writeCause.message : String(writeCause)}\n`);
    }
  }
  process.stderr.write(`${diagnostic}\n`);
  process.exitCode = 1;
} finally {
  for (const path of activeWorktrees.reverse()) {
    spawnSync('git', ['worktree', 'remove', '--force', path], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  rmSync(workspace, { recursive: true, force: true });
}
