import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runProcess } from '../packages/analysis/src/index.js';
import { repository } from './helpers.js';

describe('release version consistency', () => {
  /** @id TEST-RELEASE-VERSION-CONSISTENCY-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-019
   */
  it('TEST-RELEASE-VERSION-CONSISTENCY-001 verifies repository and built CLI release versions', async () => {
    const result = await runProcess(process.execPath, [
      'scripts/release-version.mjs',
      '--root', repository,
      '--cli', resolve(repository, 'dist/packages/cli/src/main.js'),
      '--json',
    ], { cwd: repository, timeoutMs: 20_000 });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      version: '0.1.0',
      workspaces: [
        'packages/analysis',
        'packages/cli',
        'packages/domain',
      ],
    });
  });
});
