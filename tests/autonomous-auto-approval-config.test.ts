import { describe, expect, it } from 'vitest';
import { parseHohConfig } from '../packages/analysis/src/hoh.js';

/** @id TEST-AUTONOMOUS-AUTO-APPROVAL-CONFIG-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('verified automatic approval configuration', () => {
  it('TEST-AUTONOMOUS-AUTO-APPROVAL-CONFIG-001 enables verified-only approval with bounded Reviewer inputs', () => {
    const config = parseHohConfig({
      model: 'gpt-5.4',
      budget: { aiCredits: 100 },
      commands: { build: ['npm', 'run', 'build'] },
      qaChecks: {
        build: ['npm', 'run', 'build'],
        'focused-test': ['npm', 'test'],
        'static-validation': ['npm', 'run', 'typecheck'],
        trace: ['npx', 'musubix3', 'trace', 'check', '--strict'],
        'dependency-cycle': ['npx', 'musubix3', 'graph', 'gate'],
        'structured-contract': ['npm', 'test', '--', 'contract'],
        'inherited-compatibility': ['npm', 'test', '--', 'compatibility'],
      },
      permissions: {
        reviewer: {
          allowReadPaths: ['.musubix/features'],
          allowWritePaths: [],
          allowCommands: [],
        },
      },
    });

    expect(config.approval).toEqual({
      mode: 'verified-auto',
      boundaryAttemptLimit: 3,
      maxManifestBytes: 16_777_216,
      maxManifestPaths: 2_000,
    });
    expect(config.permissions.reviewer).toMatchObject({
      allowReadPaths: ['.musubix/features'],
      allowWritePaths: [],
      allowCommands: [],
    });
  });
});
