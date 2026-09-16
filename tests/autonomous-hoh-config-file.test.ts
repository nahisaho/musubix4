import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadHohConfigFile } from '../packages/analysis/src/hoh.js';

/** @id TEST-AUTONOMOUS-HOH-CONFIG-FILE-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-004
 */
describe('standalone HoH configuration', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('TEST-AUTONOMOUS-HOH-CONFIG-FILE-001 loads .musubix/hoh.json independently of the MUSUBIX3 config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'musubix4-hoh-config-'));
    roots.push(root);
    await mkdir(join(root, '.musubix'), { recursive: true });
    await writeFile(join(root, '.musubix', 'config.json'), '{"schemaVersion":1}\n');
    await writeFile(join(root, '.musubix', 'hoh.json'), JSON.stringify({
      model: 'gpt-5.4',
      budget: { aiCredits: 10 },
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
    }));

    const config = await loadHohConfigFile(root);

    expect(config?.model).toBe('gpt-5.4');
    expect(config?.qaChecks['inherited-compatibility']).toEqual(['npm', 'test', '--', 'compatibility']);
  });
});
