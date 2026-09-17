import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, readdir, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import {
  buildTrace, exists, FileRunStore, githubOidcAudience, HohOrchestrator, loadConfig, parseHohConfig, readText, runProcess, writeJson, writeText,
} from '../packages/analysis/src/index.js';
import { skillNames } from '../packages/cli/src/install.js';
import { localHohServices } from '../packages/cli/src/main.js';
import { fixture, project, repository, req } from './helpers.js';

const cli = resolve('dist/packages/cli/src/main.js');
async function invoke(root: string, args: string[]): Promise<Awaited<ReturnType<typeof runProcess>>> {
  return runProcess(process.execPath, [cli, ...args], { cwd: root, timeoutMs: 20_000 });
}

describe('CLI contracts', () => {
  it('prints version/help and JSON validation with nonzero failure', async () => {
    const root = await fixture({ 'requirements.md': req() });
    const releaseVersion = JSON.parse(await readText(repository, 'package.json')).version;
    expect((await invoke(root, ['--version'])).stdout.trim()).toBe(releaseVersion);
    expect((await invoke(root, ['--help'])).stdout).toContain('trace');
    const valid = await invoke(root, ['requirements', 'validate', 'requirements.md', '--json']);
    expect(valid.exitCode).toBe(0);
    expect(JSON.parse(valid.stdout).valid).toBe(true);
    await writeText(root, 'requirements.md', req('The system should work.'));
    const invalid = await invoke(root, ['requirements', 'validate', 'requirements.md', '--json']);
    expect(invalid.exitCode).toBe(1);
    expect(JSON.parse(invalid.stdout).valid).toBe(false);
  });

  it('returns structured errors for missing files, invalid solver and unknown commands', async () => {
    const root = await fixture();
    for (const args of [
      ['requirements', 'validate', 'missing.md', '--json'],
      ['formal', 'check', 'missing.md', '--solver', 'fake', '--json'],
      ['unexpected', '--json'],
    ]) {
      const result = await invoke(root, args);
      expect(result.exitCode).toBe(2);
      expect(JSON.parse(result.stdout).error.code).toBe('CLI_ERROR');
    }
  });

  it('supports init alias, dry-run, status and native-bin symlink invocation', async () => {
    const root = await fixture();
    const preview = await invoke(root, ['install', '--dry-run', '--json']);
    expect(JSON.parse(preview.stdout).dryRun).toBe(true);
    expect(await readdir(root)).toEqual([]);
    expect((await invoke(root, ['install', '--json'])).exitCode).toBe(0);
    const status = JSON.parse((await invoke(root, ['status', '--json'])).stdout);
    expect(status.initialized).toBe(true);
    expect(status.gate.ready).toBe(false);
    await symlink(cli, resolve(root, 'musubix4-bin'));
    const linked = await runProcess(process.execPath, [resolve(root, 'musubix4-bin'), '--version'], { cwd: root, timeoutMs: 10_000 });
    const releaseVersion = JSON.parse(await readText(repository, 'package.json')).version;
    expect(linked.stdout.trim()).toBe(releaseVersion);
  });

  it('requires explicit confirmation before recording human approval', async () => {
    const root = await fixture();
    expect((await invoke(root, ['init', '--json'])).exitCode).toBe(0);
    const prepared = JSON.parse((await invoke(root, ['approval', 'prepare', 'requirements', '--json'])).stdout);
    const missingConfirm = await invoke(root, [
      'approval', 'record', 'requirements', '--approver', 'Human Reviewer',
      '--artifact-sha256', prepared.artifactSha256, '--json',
    ]);
    expect(missingConfirm.exitCode).toBe(2);
    expect(await exists(resolve(root, '.musubix/evidence/approvals/requirements.json'))).toBe(false);
    const wrongManifest = await invoke(root, [
      'approval', 'record', 'requirements', '--approver', 'Human Reviewer',
      '--artifact-sha256', '0'.repeat(64), '--confirm', '--json',
    ]);
    expect(wrongManifest.exitCode).toBe(2);

    const recorded = await invoke(root, [
      'approval', 'record', 'requirements', '--approver', 'Human Reviewer',
      '--artifact-sha256', prepared.artifactSha256, '--confirm', '--json',
    ]);
    expect(recorded.exitCode, recorded.stderr).toBe(0);
    expect(JSON.parse(recorded.stdout)).toMatchObject({
      stage: 'requirements',
      approver: 'Human Reviewer',
      artifactSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect((await invoke(root, ['approval', 'validate', '--json'])).exitCode).toBe(1);
  });

  it('runs full workflow and reports JSON evidence', async () => {
    const root = await project();
    const workflowTime = new Date(0).toISOString();
    await writeText(root, 'copilot.jsonl', `${JSON.stringify({
      type: 'tool.execution_start',
      timestamp: workflowTime,
      data: { toolCallId: 'call-1', toolName: 'skill', arguments: { skill: 'sdd-change' } },
    })}\n${JSON.stringify({
      type: 'tool.execution_complete',
      timestamp: workflowTime,
      data: { toolCallId: 'call-1', success: true },
    })}\n`);
    for (const args of [
      ['constitution', 'validate', '--json'],
      ['design', 'validate', '.musubix/features/example/design.md', '--json'],
      ['trace', 'build', '--json'],
      ['trace', 'check', '--strict', '--json'],
      ['trace', 'impact', 'REQ-EXAMPLE-001', '--json'],
      ['graph', 'index', '--json'],
      ['graph', 'impact', 'readiness', '--json'],
      ['graph', 'cycles', '--json'],
      ['graph', 'gate', '--json'],
      ['knowledge', 'build', '--json'],
      ['knowledge', 'query', 'readiness', '--json'],
      ['formal', 'generate', '.musubix/features/example/requirements.md', '--json'],
      ['formal', 'check', '.musubix/features/example/requirements.md', '--solver', 'none', '--json'],
      ['formal', 'doctor', '--json'],
      ['workflow-record', 'sdd-change', 'quality', '--status', 'completed', '--command', 'npm test', '--json'],
      ['workflow-verify', 'copilot.jsonl', '--json'],
      ['evidence', 'refresh', '--json'],
      ['gate', '--json'],
    ]) {
      const result = await invoke(root, args);
      expect(result.exitCode, `${args.join(' ')}: ${result.stdout} ${result.stderr}`).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    }
    const diagram = await invoke(root, ['design', 'c4', '.musubix/features/example/design.md']);
    expect(diagram.stdout).toContain('flowchart LR');
    const workflow = await readText(root, '.musubix/evidence/workflow.json');
    expect(workflow).not.toContain('npm test');
    expect(JSON.parse(workflow).events[0]).toMatchObject({ skill: 'sdd-change', phase: 'quality', status: 'completed' });
    expect(JSON.parse((await invoke(root, ['status', '--json'])).stdout).gate.ready).toBe(true);
  }, 60_000);

  it('reports and enforces strict Code Graph mode through CLI gates and status', async () => {
    const root = await project();
    await writeText(root, 'src/dynamic.ts', 'const target = getTarget(); import(target);');
    const config = await loadConfig(root);
    config.codeGraph.mode = 'strict';
    await writeJson(root, '.musubix/config.json', config);
    const baseline = JSON.parse(await readText(root, '.musubix/policy-baseline.json'));
    baseline.codeGraph.mode = 'strict';
    await writeJson(root, '.musubix/policy-baseline.json', baseline);

    const graphGate = await invoke(root, ['graph', 'gate', '--json']);
    expect(graphGate.exitCode).toBe(1);
    expect(JSON.parse(graphGate.stdout).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'GRAPH_DYNAMIC', severity: 'error' }));
    const gate = await invoke(root, ['gate', '--json']);
    expect(gate.exitCode).toBe(1);
    expect(JSON.parse(gate.stdout).checks.find((check: { name: string }) => check.name === 'graph'))
      .toMatchObject({ required: true, status: 'fail' });
    expect(JSON.parse((await invoke(root, ['status', '--json'])).stdout))
      .toMatchObject({ codeGraph: { mode: 'strict' }, gate: { status: 'fail', ready: false } });
  });

  it('enforces strict workflow session identity from config and CLI', async () => {
    const root = await project();
    const sessionId = '123e4567-e89b-42d3-a456-426614174000';
    const config = await loadConfig(root);
    config.workflow = { mode: 'strict', expectedSessionId: sessionId };
    await writeJson(root, '.musubix/config.json', config);
    const terminalTime = Date.now();
    await writeText(root, 'copilot.jsonl', [
      {
        type: 'tool.execution_start',
        timestamp: new Date(terminalTime - 2_000).toISOString(),
        data: { toolCallId: 'call-1', toolName: 'skill', arguments: { skill: 'sdd-change' } },
      },
      {
        type: 'tool.execution_complete',
        timestamp: new Date(terminalTime - 1_000).toISOString(),
        data: { toolCallId: 'call-1', success: true },
      },
      { type: 'result', timestamp: new Date(terminalTime).toISOString(), sessionId, exitCode: 0 },
    ].map((event) => JSON.stringify(event)).join('\n'));
    expect((await invoke(root, [
      'workflow-record', 'sdd-change', 'complete', '--status', 'completed', '--json',
    ])).exitCode).toBe(0);
    const verified = await invoke(root, ['workflow-verify', 'copilot.jsonl', '--json']);
    expect(verified.exitCode, verified.stderr).toBe(0);
    expect(JSON.parse(verified.stdout).verification).toMatchObject({ mode: 'strict', sessionId, exitCode: 0 });
    const sanitized = await invoke(root, [
      'workflow-sanitize', 'copilot.jsonl', 'evidence/workflow.sanitized.jsonl', '--json',
    ]);
    expect(sanitized.exitCode, sanitized.stderr).toBe(0);
    expect(JSON.parse(sanitized.stdout)).toMatchObject({ outputEvents: 3, skillInvocations: 1, sessionId });
    expect((await invoke(root, [
      'workflow-verify', 'evidence/workflow.sanitized.jsonl', '--strict', '--session-id', sessionId, '--json',
    ])).exitCode).toBe(0);
    const mismatch = await invoke(root, [
      'workflow-verify', 'copilot.jsonl', '--session-id', '123e4567-e89b-42d3-a456-426614174001', '--json',
    ]);
    expect(mismatch.exitCode).toBe(2);
    expect(JSON.parse(mismatch.stdout).error.message).toContain('does not match');

    config.workflow.maxTranscriptBytes = 1;
    config.workflow.maxTranscriptLineBytes = 1;
    await writeJson(root, '.musubix/config.json', config);
    const sizeLimited = await invoke(root, [
      'workflow-sanitize', 'copilot.jsonl', 'evidence/workflow.too-small.jsonl', '--json',
    ]);
    expect(sizeLimited.exitCode).toBe(2);
    expect(JSON.parse(sizeLimited.stdout).error.message).toContain('maximum total size');

    config.workflow.maxTranscriptBytes = 200_000_000;
    config.workflow.maxTranscriptLineBytes = 2_000_000;
    config.workflow.maxEventSkewMs = 0;
    await writeJson(root, '.musubix/config.json', config);
    await writeText(root, 'copilot.jsonl', [
      {
        type: 'tool.execution_start',
        timestamp: new Date(terminalTime - 1_000).toISOString(),
        data: { toolCallId: 'call-1', toolName: 'skill', arguments: { skill: 'sdd-change' } },
      },
      {
        type: 'tool.execution_complete',
        timestamp: new Date(terminalTime - 1_500).toISOString(),
        data: { toolCallId: 'call-1', success: true },
      },
      { type: 'result', timestamp: new Date(terminalTime).toISOString(), sessionId, exitCode: 0 },
    ].map((event) => JSON.stringify(event)).join('\n'));
    const skewed = await invoke(root, ['workflow-verify', 'copilot.jsonl', '--json']);
    expect(skewed.exitCode).toBe(2);
    expect(JSON.parse(skewed.stdout).error.message).toContain('timestamp order');
  });

  it('derives the configured GitHub OIDC audience without reading a private key', async () => {
    const root = await project();
    const config = await loadConfig(root);
    config.attestation = {
      mode: 'ci-required',
      repository: 'owner/repository',
      maxAgeSeconds: 600,
      maxFutureSkewSeconds: 30,
      trustedPublicKeys: [],
      githubOidc: {
        mode: 'strict',
        audience: 'https://musubix.dev/attestation',
        keyBinding: 'public-key',
      },
    };
    await writeJson(root, '.musubix/config.json', config);
    const { publicKey } = generateKeyPairSync('ed25519');
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await writeText(root, 'public.pem', pem);
    const result = await invoke(root, [
      'attestation', 'oidc-audience', '--key-id', 'run-key', '--public-key-file', 'public.pem', '--json',
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      audience: githubOidcAudience('https://musubix.dev/attestation', 'public-key', 'run-key', pem),
      keyBinding: 'public-key',
    });
    expect(await readText(root, 'public.pem')).not.toContain('PRIVATE KEY');
  });

  it('records a staged change checkpoint through the CLI', async () => {
    const root = await project();
    await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\n');
    const result = await invoke(root, [
      'change-record', 'CHANGE-0001', 'impact', '--requirement', 'REQ-EXAMPLE-001', '--json',
    ]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).changes[0]).toMatchObject({
      changeId: 'CHANGE-0001',
      requirementIds: ['REQ-EXAMPLE-001'],
    });
    const gate = JSON.parse((await invoke(root, ['gate', '--json'])).stdout);
    expect(gate.checks.find((check: { name: string }) => check.name === 'change-history'))
      .toMatchObject({ required: true, status: 'fail' });
  });

  it('returns exit 1 for incomplete starter gates and contradictory requirements', async () => {
    const root = await fixture();
    await invoke(root, ['init', '--json']);
    const gate = await invoke(root, ['gate', '--json']);
    expect(gate.exitCode).toBe(1);
    expect(JSON.parse(gate.stdout).checks.some((c: { status: string }) => c.status === 'skipped')).toBe(true);
    await writeText(root, 'contradiction.md', req() + req('The system shall not report its readiness.', 'REQ-EXAMPLE-002'));
    const formal = await invoke(root, ['formal', 'check', 'contradiction.md', '--solver', 'none', '--json']);
    expect(formal.exitCode).toBe(1);
    expect(JSON.parse(formal.stdout).consistency).toBe('inconsistent');
    const timeout = await invoke(root, ['formal', 'check', 'contradiction.md', '--timeout', '1', '--json']);
    expect(timeout.exitCode).toBe(2);
    expect(JSON.parse(timeout.stdout).error.message).toContain('--timeout');
  });

  it('executes a complete CLI TDD cycle and exposes it to the gate', async () => {
    const root = await project();
    const config = await loadConfig(root);
    config.requiredChecks.push('tdd');
    config.commands[0]!.args = [
      '-e',
      "const fs=require('fs'); const id=process.argv[1], report=process.argv[2]; const pass=fs.existsSync('implemented.flag'); fs.mkdirSync(require('path').dirname(report),{recursive:true}); fs.writeFileSync(report,JSON.stringify({schemaVersion:1,tests:[{id,status:pass?'passed':'failed'}]})); process.exit(pass ? 0 : 1)",
    ];
    config.commands[0]!.tddArgs = ['{testId}', '{reportPath}'];
    config.commands[0]!.tddReport = { format: 'musubix-json', path: '.musubix/evidence/tdd-results/{testId}.json' };
    await writeJson(root, '.musubix/config.json', config);
    expect((await invoke(root, ['tdd', 'red', 'TEST-EXAMPLE-001', '--requirement', 'REQ-EXAMPLE-001', '--command', 'test', '--json'])).exitCode).toBe(0);
    await writeText(root, 'implemented.flag', 'green\n');
    expect((await invoke(root, ['tdd', 'green', 'TEST-EXAMPLE-001', '--requirement', 'REQ-EXAMPLE-001', '--command', 'test', '--json'])).exitCode).toBe(0);
    expect((await invoke(root, ['tdd', 'refactor', 'TEST-EXAMPLE-001', '--requirement', 'REQ-EXAMPLE-001', '--command', 'test', '--json'])).exitCode).toBe(0);
    expect((await invoke(root, ['tdd', 'validate', '--json'])).exitCode).toBe(0);
    const gate = JSON.parse((await invoke(root, ['gate', '--json'])).stdout);
    expect(gate.checks.find((check: { name: string }) => check.name === 'tdd')).toMatchObject({ required: true, status: 'pass' });
  });
});

describe('distribution contracts', () => {
  /** @id TEST-AUTOMATIC-HOH-CODING-001
   * @verifies REQ-AUTOMATIC-HOH-CODING-001
   */
  it('TEST-AUTOMATIC-HOH-CODING-001 routes configured top-level coding through bounded HoH summaries', async () => {
    const change = await readText(repository, '.github/skills/sdd-change/SKILL.md');
    expect(change).toContain('top-level');
    expect(change).toContain('.musubix/hoh.json');
    expect(change).toContain('MUSUBIX4_HOH_RUN_ID');
    expect(change).toContain('run --prompt');
    expect(change).toContain('--summary-json');
    expect(change).toContain('128');
    expect(change).toContain('direct implementation fallback');

    const root = await fixture();
    const store = new FileRunStore(root);
    const run = await store.create({
      source: { kind: 'prompt', text: 'implement the feature' },
      config: parseHohConfig({
        model: 'gpt-5.4',
        budget: { aiCredits: 10 },
        commands: { build: ['npm', 'run', 'build'] },
      }),
    });
    const summaryResult = await invoke(root, ['status', '--run', run.id, '--summary-json']);
    expect(summaryResult.exitCode, summaryResult.stderr).toBe(0);
    const summary = JSON.parse(summaryResult.stdout);
    expect(summary).toMatchObject({
      id: run.id,
      state: 'created',
      iteration: 0,
      journalLength: 1,
      evidence: { verified: 0, unresolved: 0, regressions: 0 },
      evidenceClaimStatuses: [],
      deploymentCommands: { deploy: false, verify: false, rollback: false },
      requiredOperatorAction: 'none',
    });
    expect(summary).not.toHaveProperty('journal');
    expect(summary).not.toHaveProperty('config');

    const nested = spawnSync(
      process.execPath,
      [cli, 'run', '--prompt', 'nested', '--summary-json'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, MUSUBIX4_HOH_RUN_ID: run.id },
      },
    );
    expect(nested.status).toBe(2);
    expect(JSON.parse(nested.stdout).error).toEqual({
      code: 'CLI_ERROR',
      message: 'Nested Harness-of-Harness orchestration is forbidden while MUSUBIX4_HOH_RUN_ID is set.',
    });
  });

  /** @id TEST-AUTOMATIC-HOH-CODING-002
   * @verifies REQ-AUTOMATIC-HOH-CODING-001
   */
  it('TEST-AUTOMATIC-HOH-CODING-002 enforces routing safety details and role markers', async () => {
    const change = await readText(repository, '.github/skills/sdd-change/SKILL.md');
    expect(change).toContain('journalLength');
    expect(change).toContain('no-progress blocker');
    expect(change).toContain('one or more evidence claims are all verified');
    expect(change).toContain('unresolved/regressions are zero');
    expect(change).toContain('deploy/verify/rollback are not all configured');
    const root = await fixture();
    const store = new FileRunStore(root);
    const run = await store.create({
      source: { kind: 'prompt', text: 'implement the feature' },
      config: parseHohConfig({
        model: 'gpt-5.4',
        budget: { aiCredits: 10 },
        commands: { build: ['npm', 'run', 'build'] },
      }),
    });
    const missingRun = await invoke(root, ['status', '--summary-json']);
    expect(missingRun.exitCode).toBe(2);
    expect(JSON.parse(missingRun.stdout).error.message).toBe('--summary-json requires --run.');
    for (const args of [
      ['resume', 'other-run', '--summary-json'],
      ['protected-set', 'amend', 'other-run', '--collision-inventory', 'inventory.json', '--json'],
    ]) {
      const nested = spawnSync(process.execPath, [cli, ...args], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, MUSUBIX4_HOH_RUN_ID: run.id },
      });
      expect(nested.status).toBe(2);
      expect(JSON.parse(nested.stdout).error.message)
        .toBe('Nested Harness-of-Harness orchestration is forbidden while MUSUBIX4_HOH_RUN_ID is set.');
    }
    const markerPath = resolve(root, 'role-marker.txt');
    const executable = resolve(root, 'fake-role.mjs');
    await writeText(root, 'fake-role.mjs', [
      '#!/usr/bin/env node',
      "import { writeFileSync } from 'node:fs';",
      "writeFileSync(process.env.MUSUBIX4_TEST_MARKER_PATH, process.env.MUSUBIX4_HOH_RUN_ID ?? '');",
      "console.log(JSON.stringify({type:'usage',aiCredits:0,model:'gpt-5.4'}));",
      "console.log(JSON.stringify({type:'result',result:{ok:true}}));",
    ].join('\n'));
    await chmod(executable, 0o755);
    const previousExecutable = process.env.MUSUBIX4_COPILOT_EXECUTABLE;
    const previousMarkerPath = process.env.MUSUBIX4_TEST_MARKER_PATH;
    process.env.MUSUBIX4_COPILOT_EXECUTABLE = executable;
    process.env.MUSUBIX4_TEST_MARKER_PATH = markerPath;
    try {
      const services = localHohServices(root, store);
      await services.roles.planner?.({ run, requirements: [], attempt: 1 });
      expect(await readText(root, 'role-marker.txt')).toBe(run.id);
    } finally {
      if (previousExecutable === undefined) delete process.env.MUSUBIX4_COPILOT_EXECUTABLE;
      else process.env.MUSUBIX4_COPILOT_EXECUTABLE = previousExecutable;
      if (previousMarkerPath === undefined) delete process.env.MUSUBIX4_TEST_MARKER_PATH;
      else process.env.MUSUBIX4_TEST_MARKER_PATH = previousMarkerPath;
    }
  });

  /** @id TEST-AUTOMATIC-HOH-CODING-003
   * @verifies REQ-AUTOMATIC-HOH-CODING-001
   */
  it('TEST-AUTOMATIC-HOH-CODING-003 supplies reviewer execution metadata without prompt leakage', async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const run = await store.create({
      source: { kind: 'prompt', text: 'implement the feature' },
      requirements: ['REQ-PUBLIC-001'],
      config: parseHohConfig({
        model: 'gpt-5.4',
        budget: { aiCredits: 10 },
        commands: { build: ['npm', 'run', 'build'] },
      }),
    });
    const promptPath = resolve(root, 'role-prompts.jsonl');
    const executable = resolve(root, 'fake-reviewer.mjs');
    await writeText(root, 'fake-reviewer.mjs', [
      '#!/usr/bin/env node',
      "import { appendFileSync } from 'node:fs';",
      "const prompt = process.argv[process.argv.indexOf('-p') + 1];",
      "const request = JSON.parse(prompt);",
      "appendFileSync(process.env.MUSUBIX4_TEST_PROMPT_PATH, JSON.stringify({marker:process.env.MUSUBIX4_HOH_RUN_ID,request}) + '\\n');",
      "let result;",
      "if (request.role === 'reviewer') {",
      "  const boundary = request.context;",
      "  result = {...boundary, reviewedPaths: boundary.manifestPaths, findings: []};",
      "} else {",
      "  result = {kind:'plan',priorities:[{requirementId:request.context.requirements[0],acceptanceGates:['test'],preservation:['base']}],addressedBlockers:[]};",
      "}",
      "console.log(JSON.stringify({type:'usage',aiCredits:0,model:'gpt-5.4'}));",
      "console.log(JSON.stringify({type:'result',result}));",
    ].join('\n'));
    await chmod(executable, 0o755);
    const previousExecutable = process.env.MUSUBIX4_COPILOT_EXECUTABLE;
    const previousPromptPath = process.env.MUSUBIX4_TEST_PROMPT_PATH;
    process.env.MUSUBIX4_COPILOT_EXECUTABLE = executable;
    process.env.MUSUBIX4_TEST_PROMPT_PATH = promptPath;
    try {
      const services = localHohServices(root, store);
      const result = await new HohOrchestrator(store, services).resume(run.id);
      expect(result.state).toBe('planned');
      const calls = (await readText(root, 'role-prompts.jsonl'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as {
          marker: string;
          request: { role: string; context: Record<string, unknown> };
        });
      const reviewerCalls = calls.filter(({ request }) => request.role === 'reviewer');
      expect(reviewerCalls).toHaveLength(2);
      for (const call of reviewerCalls) {
        expect(call.marker).toBe(run.id);
        expect(call.request).not.toHaveProperty('execution');
        expect(call.request.context).not.toHaveProperty('run');
        expect(call.request.context).not.toHaveProperty('execution');
        const { manifestArtifacts: _manifestArtifacts, ...envelope } = call.request.context;
        expect(JSON.stringify(envelope)).not.toContain(run.id);
        expect(Object.keys(call.request.context).sort()).toEqual([
          'attempt',
          'boundaryEpisodeOrdinal',
          'boundaryKind',
          'manifestArtifacts',
          'manifestDigest',
          'manifestPaths',
          'nonce',
          'stage',
          'validatorEvidence',
        ]);
      }
      await expect(services.roles.reviewer?.({ stage: 'requirements' }))
        .rejects.toThrow('Reviewer execution context is required.');
    } finally {
      if (previousExecutable === undefined) delete process.env.MUSUBIX4_COPILOT_EXECUTABLE;
      else process.env.MUSUBIX4_COPILOT_EXECUTABLE = previousExecutable;
      if (previousPromptPath === undefined) delete process.env.MUSUBIX4_TEST_PROMPT_PATH;
      else process.env.MUSUBIX4_TEST_PROMPT_PATH = previousPromptPath;
    }
  });

  /** @id TEST-SAFE-WORKFLOW-SPEED-001
   * @verifies REQ-SAFE-WORKFLOW-SPEED-001
   */
  it('TEST-SAFE-WORKFLOW-SPEED-001 ships concise output and safe parallelization rules', async () => {
    const names = [
      'sdd-change',
      'sdd-requirements',
      'sdd-design',
      'sdd-implementation',
      'sdd-traceability',
      'sdd-quality',
    ];
    for (const name of names) {
      const skill = await readText(repository, `.github/skills/${name}/SKILL.md`);
      expect(skill).toContain('human-readable');
      expect(skill).toContain('parallel tool-call batch');
      expect(skill).toContain('producer-before-consumer');
      expect(skill).toContain('Do not rerun');
    }
    const change = await readText(repository, '.github/skills/sdd-change/SKILL.md');
    expect(change).toContain('approval prepare');
    expect(change).toContain('workflow-verify');
    expect(change).toContain('--summary-json');
    expect(change).toContain('gate --json');
  });

  /** @id TEST-SAFE-WORKFLOW-SPEED-002
   * @verifies REQ-SAFE-WORKFLOW-SPEED-001
   */
  it('TEST-SAFE-WORKFLOW-SPEED-002 encodes exact concise and sequential command rules', async () => {
    expect(await readText(repository, '.github/skills/sdd-requirements/SKILL.md'))
      .not.toContain('requirements validate <file> --json');
    expect(await readText(repository, '.github/skills/sdd-design/SKILL.md'))
      .not.toContain('design validate <file> --json');
    expect(await readText(repository, '.github/skills/sdd-traceability/SKILL.md'))
      .not.toContain('trace check --strict --json');
    expect(await readText(repository, '.github/skills/sdd-quality/SKILL.md'))
      .toContain('when individual');
    expect(await readText(repository, '.github/skills/sdd-implementation/SKILL.md'))
      .toContain('project build/test commands remain sequential');
  });

  /** @id TEST-SESSION-SCOPED-DEVELOPMENT-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-001
   */
  it('TEST-SESSION-SCOPED-DEVELOPMENT-001 starts every new request as a fresh change', async () => {
    expect((await readdir(resolve(repository, '.github/skills'))).sort()).toEqual([...skillNames].sort());
    for (const name of skillNames) {
      const text = await readText(repository, `.github/skills/${name}/SKILL.md`);
      const yaml = /^---\r?\n([\s\S]+?)\r?\n---/.exec(text)?.[1];
      expect(yaml).toBeDefined();
      const document = parseDocument(yaml!);
      expect(document.errors).toEqual([]);
      expect(document.toJSON()).toMatchObject({ name, description: expect.stringContaining('Use') });
      expect(text).toContain('input language');
      expect(text).toMatch(/[一-龠ぁ-んァ-ン]/);
      expect(text).toContain('native');
      expect(text.split(/\r?\n/).length).toBeLessThan(80);
    }
    const change = await readText(repository, '.github/skills/sdd-change/SKILL.md');
    expect(change).toContain('MANDATORY first Skill');
    expect(change).toContain('never start implementation');
    expect(change).toContain('ask exactly one highest-priority question');
    expect(change).toContain('every new natural-language development request is a new change');
  });

  /** @id TEST-SESSION-SCOPED-DEVELOPMENT-002
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-001 REQ-RELEASE-V010-DOCS-005
   */
  it('TEST-SESSION-SCOPED-DEVELOPMENT-002 reuses evidence only for an explicit change ID', async () => {
    const change = await readText(repository, '.github/skills/sdd-change/SKILL.md');
    expect(change).toContain('unless the user explicitly names the existing change ID');
    const requirements = await readText(repository, '.github/skills/sdd-requirements/SKILL.md');
    expect(requirements).toContain('fresh');
    expect(requirements).toContain('not permission to start coding');
    expect(requirements).toContain('Never batch questions');
    const trace = await buildTrace(repository, false);
    expect(trace.nodes).toContainEqual(expect.objectContaining({ id: 'CODE-SESSION-SCOPED-DEVELOPMENT-001' }));
    expect(trace.nodes).toContainEqual(expect.objectContaining({ id: 'CODE-SESSION-SCOPED-DEVELOPMENT-002' }));
    expect(trace.nodes).toContainEqual(expect.objectContaining({ id: 'CODE-SESSION-SCOPED-DEVELOPMENT-003' }));
    expect(trace.edges).toContainEqual(expect.objectContaining({
      from: 'CODE-SESSION-SCOPED-DEVELOPMENT-002', to: 'REQ-RELEASE-V010-DOCS-005', relation: 'implements',
    }));
    const implementation = await readText(repository, '.github/skills/sdd-implementation/SKILL.md');
    expect(implementation).toContain('verify that approved requirements and');
    expect(implementation).toContain('stop and return to `sdd-change`');
  });

  it('validates native manifests and packed hidden skills/built engine/assets', async () => {
    const pkg = JSON.parse(await readText(repository, 'package.json'));
    const plugin = JSON.parse(await readText(repository, 'plugin.json'));
    const marketplace = JSON.parse(await readText(repository, '.github/plugin/marketplace.json'));
    expect(plugin).toMatchObject({ name: pkg.name, version: pkg.version, skills: '.github/skills/' });
    expect(marketplace.plugins[0]).toMatchObject({ name: pkg.name, version: pkg.version, source: '.' });
    const checked = await runProcess(process.execPath, ['scripts/check-package.mjs'], { cwd: repository, timeoutMs: 20_000 });
    expect(checked.exitCode, checked.stderr).toBe(0);
    expect(checked.stdout).toContain('9 skills');
  });
});
