import { describe, expect, it, vi } from 'vitest';
import {
  autoApproveRunBoundary,
  FileRunStore,
  parseHohConfig,
  pauseForApproval,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-AUTO-APPROVAL-EMPTY-MANIFEST-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('automatic approval empty manifest rejection', () => {
  it('TEST-AUTONOMOUS-AUTO-APPROVAL-EMPTY-MANIFEST-001 rejects unsupported boundaries before Reviewer invocation', async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: 'prompt', text: 'Build safely' },
      config: parseHohConfig({
        model: 'gpt-5.4',
        budget: { aiCredits: 10 },
        commands: { test: ['npm', 'test'] },
      }),
    });
    const paused = await pauseForApproval(store, created.id, 'release', 'a'.repeat(64));
    const reviewer = vi.fn();

    await expect(autoApproveRunBoundary(store, paused.id, reviewer))
      .rejects.toThrow(/manifest.*unavailable|amendment.*required/i);

    expect(reviewer).not.toHaveBeenCalled();
    expect((await store.status(paused.id)).approvalAttempts).toBeUndefined();
  });
});
