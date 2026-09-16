import { describe, expect, it } from 'vitest';
import {
  loadConfig,
  runGate,
  writeJson,
  writeText,
} from '../packages/analysis/src/index.js';
import { project } from './helpers.js';

/** @id TEST-OPTIONAL-FORMAL-GATE-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('optional formal gate', () => {
  it('TEST-OPTIONAL-FORMAL-GATE-001 does not block readiness for unsupported prose when formal is optional', async () => {
    const root = await project();
    await writeText(
      root,
      '.musubix/features/example/requirements.md',
      [
        '## REQ-EXAMPLE-001: Event response',
        'Priority: must',
        'Statement: When an event occurs, the system shall perform the complete documented workflow.',
        '',
      ].join('\n'),
    );
    const config = await loadConfig(root);
    config.requiredChecks = config.requiredChecks.filter((name) => name !== 'formal');
    config.formal = { solver: 'none', minModeledFraction: 0, timeoutMs: 12_000 };
    await writeJson(root, '.musubix/config.json', config);

    const report = await runGate(root);
    const formal = report.checks.find((check) => check.name === 'formal');

    expect(formal).toMatchObject({ required: false, status: 'pass' });
    expect(formal?.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FORMAL_UNSUPPORTED', severity: 'warning' }),
    );
  });
});
