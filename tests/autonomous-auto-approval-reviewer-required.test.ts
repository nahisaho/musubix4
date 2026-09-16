import { describe, expect, it, vi } from 'vitest';
import {
  FileRunStore,
  HohOrchestrator,
  parseHohConfig,
  type HohServices,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-AUTO-APPROVAL-REVIEWER-REQUIRED-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('verified automatic Reviewer requirement', () => {
  it('TEST-AUTONOMOUS-AUTO-APPROVAL-REVIEWER-REQUIRED-001 fails closed before planning when Reviewer is unavailable', async () => {
    const root = await fixture({
      '.musubix/hoh.json': JSON.stringify({
        model: 'gpt-5.4',
        budget: { aiCredits: 10 },
        commands: { test: ['npm', 'test'] },
        approval: { mode: 'verified-auto' },
      }),
    });
    const store = new FileRunStore(root);
    const services: HohServices = {
      roles: {
        planner: vi.fn(),
        developer: vi.fn(),
        qa: vi.fn(),
      },
      project: {
        preflight: vi.fn(),
        candidateChecks: vi.fn(),
      },
      git: {
        snapshot: vi.fn(),
        treeDigest: vi.fn(),
        rollback: vi.fn(),
      },
    };
    const run = await new HohOrchestrator(store, services).start({
      source: { kind: 'prompt', text: 'Requirement A' },
      config: parseHohConfig({
        model: 'gpt-5.4',
        budget: { aiCredits: 10 },
        commands: { test: ['npm', 'test'] },
      }),
    });

    await expect(new HohOrchestrator(store, services).resume(run.id))
      .rejects.toThrow(/Reviewer.*required/i);

    expect(services.roles.planner).not.toHaveBeenCalled();
    expect((await store.status(run.id)).state).toBe('created');
  });
});
