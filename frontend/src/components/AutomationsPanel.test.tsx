import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationsPanel } from './AutomationsPanel';

vi.mock('../api/automations', () => ({
  automationsApi: {
    getCronStatus: vi.fn(),
    listCronJobs: vi.fn(),
    triggerCronJob: vi.fn(),
    enableCronJob: vi.fn(),
    disableCronJob: vi.fn(),
    deleteCronJob: vi.fn(),
    listTriggers: vi.fn(),
    deleteTrigger: vi.fn(),
    listRecentEvents: vi.fn(),
  },
}));

import { automationsApi } from '../api/automations';

function renderPanel(onOpenRun = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return {
    onOpenRun,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AutomationsPanel onOpenRun={onOpenRun} />
      </QueryClientProvider>,
    ),
  };
}

describe('AutomationsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(automationsApi.getCronStatus).mockResolvedValue({
      scheduler_running: true,
      total_jobs: 1,
      failing_jobs: 0,
      retrying_jobs: 0,
    });
    vi.mocked(automationsApi.listCronJobs).mockResolvedValue([
      {
        id: 'job-1',
        schedule: '0 * * * *',
        execution_type: 'Goal',
        payload: {},
        enabled: false,
        failure_count: 0,
        last_run_at: null,
        last_failure_at: null,
        next_retry_at: null,
      },
    ]);
    vi.mocked(automationsApi.listTriggers).mockResolvedValue([
      {
        id: 'trigger-1',
        event_type: 'quantlab.completed',
        condition: null,
        action: { Goal: { goal: 'summarize' } },
      },
    ]);
    vi.mocked(automationsApi.listRecentEvents).mockResolvedValue([
      {
        id: 'evt-1',
        event_type: 'trigger.dispatched',
        payload: {},
        timestamp: new Date().toISOString(),
        related_execution_id: 'goalrun-123',
      },
    ]);
    vi.mocked(automationsApi.triggerCronJob).mockResolvedValue({
      status: 'triggered',
      run_id: 'cronrun-123',
    });
    vi.mocked(automationsApi.enableCronJob).mockResolvedValue({ status: 'enabled' });
    vi.mocked(automationsApi.disableCronJob).mockResolvedValue({ status: 'disabled' });
    vi.mocked(automationsApi.deleteCronJob).mockResolvedValue(undefined);
    vi.mocked(automationsApi.deleteTrigger).mockResolvedValue(undefined);
  });

  it('renders scheduler status, cron jobs, triggers and events', async () => {
    renderPanel();

    expect(await screen.findByText('Scheduler')).toBeInTheDocument();
    expect(await screen.findByText('job-1')).toBeInTheDocument();
    expect(await screen.findByText('disabled')).toBeInTheDocument();
    expect(await screen.findByText('trigger-1')).toBeInTheDocument();
    expect(await screen.findByText('trigger.dispatched')).toBeInTheDocument();
  });

  it('opens the run when manually triggering a cron job', async () => {
    const onOpenRun = vi.fn();
    renderPanel(onOpenRun);

    const button = await screen.findByRole('button', { name: /Run Now/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(automationsApi.triggerCronJob).toHaveBeenCalledWith('job-1');
      expect(onOpenRun).toHaveBeenCalledWith('cronrun-123');
    });
  });

  it('enables disabled cron jobs explicitly', async () => {
    renderPanel();

    const button = await screen.findByRole('button', { name: /Enable/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(automationsApi.enableCronJob).toHaveBeenCalledWith('job-1');
    });
  });
});
