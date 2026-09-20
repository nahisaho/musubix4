import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GRAPH_BENCHMARK_COMMANDS,
  indexGraph,
  loadGraph,
  readText,
  validateGraphPerformanceEvidence,
  writeJson,
  writeText,
  type GraphIndexOperations,
} from '../packages/analysis/src/index.js';
import { fixture } from './helpers.js';

/**
 * @id TEST-SAFE-WORKFLOW-SPEED-004
 * @verifies REQ-SAFE-WORKFLOW-SPEED-003
 */
describe('identity-bound graph cache performance', () => {
  it('TEST-SAFE-WORKFLOW-SPEED-004 reuses only fresh graphs and reports zero warm compiler builds', async () => {
    const root = await fixture({
      'package.json': '{"name":"fixture","version":"1.0.0"}\n',
      'package-lock.json': '{"lockfileVersion":3}\n',
      'tsconfig.json': '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"}}\n',
      'src/a.ts': 'export const value = 1;\n',
      'src/b.ts': "import { value } from './a.js'; export const result = value;\n",
    });

    const warmOperations: GraphIndexOperations = { typescriptProgramBuilds: 0 };
    const warm = await indexGraph(root, {
      cachePolicy: 'read-write',
      operations: warmOperations,
    });
    expect(warmOperations.typescriptProgramBuilds).toBe(1);
    const cachePath = resolve(root, '.musubix/cache/codegraph.json');
    const beforeBytes = await readFile(cachePath);
    const beforeStat = await stat(cachePath);

    const reuseOperations: GraphIndexOperations = { typescriptProgramBuilds: 0 };
    const reused = await indexGraph(root, {
      cachePolicy: 'read-write',
      operations: reuseOperations,
    });
    expect(reuseOperations.typescriptProgramBuilds).toBe(0);
    expect(reused).toEqual(warm);
    expect(await readFile(cachePath)).toEqual(beforeBytes);
    expect((await stat(cachePath)).mtimeMs).toBe(beforeStat.mtimeMs);

    const seeded = {
      ...reused,
      generatedAt: '2000-01-01T00:00:00.000Z',
      symbols: [{
        id: 'seeded.ts#seeded@1',
        name: 'seeded',
        path: 'seeded.ts',
        line: 1,
        kind: 'VariableDeclaration',
      }],
    };
    await writeJson(root, '.musubix/cache/codegraph.json', seeded);
    const seededBytes = await readFile(cachePath);

    const bypassOperations: GraphIndexOperations = { typescriptProgramBuilds: 0 };
    const bypassed = await indexGraph(root, {
      cachePolicy: 'bypass',
      operations: bypassOperations,
    });
    expect(bypassOperations.typescriptProgramBuilds).toBe(1);
    expect(bypassed.symbols).not.toEqual(seeded.symbols);
    expect(await readFile(cachePath)).toEqual(seededBytes);

    const refreshOperations: GraphIndexOperations = { typescriptProgramBuilds: 0 };
    const refreshed = await indexGraph(root, {
      cachePolicy: 'refresh',
      operations: refreshOperations,
    });
    expect(refreshOperations.typescriptProgramBuilds).toBe(1);
    expect(refreshed.symbols).not.toEqual(seeded.symbols);
    expect(await readFile(cachePath)).not.toEqual(seededBytes);
    expect(await loadGraph(root)).toEqual(refreshed);

    await writeText(root, 'package-lock.json', '{"lockfileVersion":3,"changed":true}\n');
    await expect(loadGraph(root)).rejects.toThrow(/stale|incompatible/i);
    const lockfileOperations: GraphIndexOperations = { typescriptProgramBuilds: 0 };
    await indexGraph(root, {
      cachePolicy: 'read-write',
      operations: lockfileOperations,
    });
    expect(lockfileOperations.typescriptProgramBuilds).toBe(1);

    const absentRoot = await fixture({
      'package.json': '{"name":"fixture","version":"1.0.0"}\n',
      'src/index.ts': 'export const value = 1;\n',
    });
    const absentOperations: GraphIndexOperations = { typescriptProgramBuilds: 0 };
    await indexGraph(absentRoot, {
      cachePolicy: 'bypass',
      operations: absentOperations,
    });
    expect(absentOperations.typescriptProgramBuilds).toBe(1);
    await expect(readText(absentRoot, '.musubix/cache/codegraph.json'))
      .rejects.toThrow();

    await validateGraphPerformanceEvidence(resolve('.'));

    const sidecarPath = process.env.MUSUBIX_GRAPH_PERFORMANCE_SIDECAR;
    const nonce = process.env.MUSUBIX_GRAPH_PERFORMANCE_NONCE;
    if (sidecarPath || nonce) {
      expect(sidecarPath).toBeTruthy();
      expect(nonce).toBeTruthy();
      await writeJson(resolve('.'), sidecarPath!, {
        schemaVersion: 1,
        nonce,
        testId: 'TEST-SAFE-WORKFLOW-SPEED-004',
        operations: {
          typescriptProgramBuilds: reuseOperations.typescriptProgramBuilds,
        },
      });
    }
  });
});

  /**
   * @id TEST-SAFE-WORKFLOW-SPEED-005
   * @verifies REQ-SAFE-WORKFLOW-SPEED-003
   */
  it('TEST-SAFE-WORKFLOW-SPEED-005 binds cache incompatibility and benchmark invocations', async () => {
    const performanceModule = await import('../packages/analysis/src/index.js') as unknown as {
      graphPerformanceFailureDiagnostic?: (value: unknown) => string | null;
      graphPerformanceOutcome?: (passed: boolean) => 'passed' | 'failed';
    };
    expect(performanceModule.graphPerformanceOutcome?.(true)).toBe('passed');
    expect(performanceModule.graphPerformanceOutcome?.(false)).toBe('failed');
    expect(performanceModule.graphPerformanceFailureDiagnostic?.({
      schemaVersion: 2,
      outcome: 'failed',
      passed: false,
      diagnostic: 'benchmark failed',
    })).toBe('benchmark failed');
    expect(performanceModule.graphPerformanceFailureDiagnostic?.({
      schemaVersion: 2,
      outcome: 'passed',
      passed: true,
    })).toBeNull();

    const root = await fixture({
      'package.json': '{"name":"fixture","version":"1.0.0"}\n',
      'src/index.ts': 'export const value = 1;\n',
    });
    const graph = await indexGraph(root);

    for (const incompatible of [
      { ...graph, schemaVersion: 1 },
      {
        ...graph,
        producer: {
          ...graph.producer,
          extractorModulesSha256: '0'.repeat(64),
        },
      },
    ]) {
      await writeJson(root, '.musubix/cache/codegraph.json', incompatible);
      await expect(loadGraph(root)).rejects.toThrow('run graph index');
      const operations: GraphIndexOperations = { typescriptProgramBuilds: 0 };
      await indexGraph(root, { cachePolicy: 'read-write', operations });
      expect(operations.typescriptProgramBuilds).toBe(1);
      await expect(loadGraph(root)).resolves.toEqual(
        expect.objectContaining({ schemaVersion: 2 }),
      );
    }

    const evidence = JSON.parse(
      await readText(resolve('.'), '.musubix/evidence/graph-performance.json'),
    ) as {
      schemaVersion?: number;
      outcome?: string;
      warmups?: Record<string, { executable?: string; args?: string[]; exitCode?: number }>;
      results?: Record<string, {
        samples?: Record<string, Array<{ executable?: string; args?: string[]; exitCode?: number }>>;
      }>;
    };
    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.outcome).toBe('passed');
    expect(Object.keys(evidence.warmups ?? {}).sort()).toEqual([
      'candidate',
      'improvementReference',
      'regressionReference',
    ]);
    for (const warmup of Object.values(evidence.warmups ?? {})) {
      expect(warmup.executable).toEqual(expect.any(String));
      expect(warmup.args).toEqual(['graph', 'index']);
      expect(warmup.exitCode).toBe(0);
    }
    for (const command of GRAPH_BENCHMARK_COMMANDS) {
      const result = evidence.results?.[command.name];
      if (!result) throw new Error(`Missing benchmark result for ${command.name}.`);
      expect(Object.keys(result.samples ?? {}).sort()).toEqual([
        'candidate',
        'improvementReference',
        'regressionReference',
      ]);
      for (const samples of Object.values(result.samples ?? {})) {
        expect(samples).toHaveLength(5);
        for (const sample of samples) {
          expect(sample.executable).toEqual(expect.any(String));
          expect(sample.args).toEqual(command.args);
          expect(sample.exitCode).toBe(0);
        }
      }
    }
  });
