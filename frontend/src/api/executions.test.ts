import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
  },
}));

import client from './client';
import { executionsApi } from './executions';

describe('executionsApi', () => {
  const mockedClient = client as Mocked<typeof client>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists execution runs from the envelope', async () => {
    mockedClient.get.mockResolvedValueOnce({
      data: {
        runs: [{ id: 'exec-1', title: 'Run 1', kind: 'goal', status: 'running', tags: [], steps: [], artifacts: [], created_at: 1, updated_at: 1 }],
      },
    });

    const runs = await executionsApi.list();

    expect(mockedClient.get).toHaveBeenCalledWith('/executions');
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe('exec-1');
  });

  it('loads a single execution run from the envelope', async () => {
    mockedClient.get.mockResolvedValueOnce({
      data: {
        run: { id: 'exec-2', title: 'Run 2', kind: 'pipeline', status: 'completed', tags: ['pipeline'], steps: [], artifacts: [], created_at: 2, updated_at: 3 },
      },
    });

    const run = await executionsApi.get('exec-2');

    expect(mockedClient.get).toHaveBeenCalledWith('/executions/exec-2');
    expect(run.title).toBe('Run 2');
  });

  it('lists execution events from the envelope', async () => {
    mockedClient.get.mockResolvedValueOnce({
      data: {
        events: [{ id: 'evt-1', run_id: 'exec-2', event_type: 'run_started', timestamp: 4 }],
      },
    });

    const events = await executionsApi.listEvents('exec-2');

    expect(mockedClient.get).toHaveBeenCalledWith('/executions/exec-2/events');
    expect(events[0].event_type).toBe('run_started');
  });
});
