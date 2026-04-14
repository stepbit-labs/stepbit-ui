import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunsPanel } from './RunsPanel';

vi.mock('../api/executions', () => ({
  executionsApi: {
    list: vi.fn(),
    get: vi.fn(),
    listEvents: vi.fn(),
  },
}));

import { executionsApi } from '../api/executions';

function renderRunsPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RunsPanel />
    </QueryClientProvider>,
  );
}

describe('RunsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads runs, shows detail, and renders steps/artifacts', async () => {
    vi.mocked(executionsApi.list).mockResolvedValueOnce([
      {
        id: 'exec-1',
        title: 'Pipeline run',
        kind: 'pipeline',
        status: 'completed',
        created_at: 10,
        updated_at: 20,
        summary: 'Pipeline execution completed',
        tags: ['pipeline'],
        steps: [],
        artifacts: [],
      },
    ] as any);
    vi.mocked(executionsApi.get).mockResolvedValueOnce({
      id: 'exec-1',
      title: 'Pipeline run',
      kind: 'pipeline',
      status: 'completed',
      created_at: 10,
      updated_at: 20,
      summary: 'Pipeline execution completed',
      tags: ['pipeline'],
      links: { goal_run_id: 'goalrun-1' },
      steps: [
        {
          id: 'step-1',
          kind: 'pipeline_stage',
          title: 'LlmStage: generated response',
          status: 'completed',
          created_at: 10,
          updated_at: 10,
          summary: 'Generated response',
        },
      ],
      artifacts: [
        {
          id: 'artifact-1',
          family: 'file',
          title: 'report.json',
          source: 'pipeline_tool',
          data: { path: '/tmp/report.json' },
        },
      ],
    } as any);
    vi.mocked(executionsApi.listEvents).mockResolvedValueOnce([
      { id: 'evt-1', run_id: 'exec-1', event_type: 'run_completed', timestamp: 21 },
    ] as any);

    renderRunsPanel();

    expect(await screen.findByText('Pipeline run')).toBeInTheDocument();
    expect(await screen.findByText('LlmStage: generated response')).toBeInTheDocument();
    expect(screen.getByText('report.json')).toBeInTheDocument();
    expect(screen.getByText('run_completed')).toBeInTheDocument();
    expect(screen.getByText('goal: goalrun-1')).toBeInTheDocument();
  });

  it('filters runs by status and updates the visible list', async () => {
    const user = userEvent.setup();
    vi.mocked(executionsApi.list).mockResolvedValueOnce([
      {
        id: 'exec-1',
        title: 'Completed goal',
        kind: 'goal',
        status: 'completed',
        created_at: 10,
        updated_at: 20,
        tags: [],
        steps: [],
        artifacts: [],
      },
      {
        id: 'exec-2',
        title: 'Failed reasoning',
        kind: 'reasoning',
        status: 'failed',
        created_at: 10,
        updated_at: 20,
        tags: [],
        steps: [],
        artifacts: [],
      },
    ] as any);
    vi.mocked(executionsApi.get).mockResolvedValue({
      id: 'exec-1',
      title: 'Completed goal',
      kind: 'goal',
      status: 'completed',
      created_at: 10,
      updated_at: 20,
      tags: [],
      steps: [],
      artifacts: [],
    } as any);
    vi.mocked(executionsApi.get).mockResolvedValue({
      id: 'exec-2',
      title: 'Failed reasoning',
      kind: 'reasoning',
      status: 'failed',
      created_at: 10,
      updated_at: 20,
      error: 'reasoning failed',
      tags: [],
      steps: [],
      artifacts: [],
    } as any);
    vi.mocked(executionsApi.listEvents).mockResolvedValue([] as any);

    renderRunsPanel();

    expect(await screen.findByText('Completed goal')).toBeInTheDocument();
    expect(screen.getByText('Failed reasoning')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/status/i), 'failed');

    await waitFor(() => {
      expect(screen.getByText('1 / 2')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Failed reasoning' })).toBeInTheDocument();
    });
    expect(screen.getByText('reasoning failed')).toBeInTheDocument();
  });

  it('renders a failure message when runs loading fails', async () => {
    vi.mocked(executionsApi.list).mockRejectedValueOnce(new Error('boom'));

    renderRunsPanel();

    expect(await screen.findByText('Failed to load executions.')).toBeInTheDocument();
  });
});
