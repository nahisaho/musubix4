import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runProcess } from '../packages/analysis/src/index.js';
import { createProgram } from '../packages/cli/src/main.js';
import { repository } from './helpers.js';

describe('release version consistency', () => {
  /** @id TEST-RELEASE-VERSION-CONSISTENCY-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-001 REQ-AUTONOMOUS-DEVELOPMENT-019
   */
  it('TEST-RELEASE-VERSION-CONSISTENCY-001 verifies repository and built CLI release versions', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(repository, 'package.json'), 'utf8'),
    ) as { version: string };
    const result = await runProcess(process.execPath, [
      'scripts/release-version.mjs',
      '--root', repository,
      '--cli', resolve(repository, 'dist/packages/cli/src/main.js'),
      '--json',
    ], { cwd: repository, timeoutMs: 20_000 });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      version: packageJson.version,
      workspaces: [
        'packages/analysis',
        'packages/cli',
        'packages/domain',
      ],
    });
    expect(createProgram().version()).toBe(packageJson.version);
  });
});
