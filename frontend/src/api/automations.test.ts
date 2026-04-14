import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import client from './client';
import { automationsApi } from './automations';

describe('automationsApi', () => {
  const mockedClient = client as Mocked<typeof client>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads cron status', async () => {
    mockedClient.get.mockResolvedValueOnce({
      data: {
        scheduler_running: true,
        total_jobs: 3,
        failing_jobs: 1,
        retrying_jobs: 1,
      },
    });

    const result = await automationsApi.getCronStatus();

    expect(mockedClient.get).toHaveBeenCalledWith('/automations/cron/status');
    expect(result.total_jobs).toBe(3);
  });

  it('lists cron jobs and triggers manual execution', async () => {
    mockedClient.get.mockResolvedValueOnce({
      data: {
        jobs: [{ id: 'job-1' }],
      },
    });
    mockedClient.post.mockResolvedValueOnce({
      data: {
        status: 'triggered',
        run_id: 'cronrun-123',
      },
    });

    const jobs = await automationsApi.listCronJobs();
    const trigger = await automationsApi.triggerCronJob('job-1');

    expect(jobs).toHaveLength(1);
    expect(mockedClient.post).toHaveBeenCalledWith('/automations/cron/jobs/job-1/trigger');
    expect(trigger.run_id).toBe('cronrun-123');
  });

  it('toggles cron jobs explicitly', async () => {
    mockedClient.post
      .mockResolvedValueOnce({ data: { status: 'enabled' } })
      .mockResolvedValueOnce({ data: { status: 'disabled' } });

    const enabled = await automationsApi.enableCronJob('job-1');
    const disabled = await automationsApi.disableCronJob('job-1');

    expect(mockedClient.post).toHaveBeenNthCalledWith(1, '/automations/cron/jobs/job-1/enable');
    expect(mockedClient.post).toHaveBeenNthCalledWith(2, '/automations/cron/jobs/job-1/disable');
    expect(enabled.status).toBe('enabled');
    expect(disabled.status).toBe('disabled');
  });

  it('creates cron jobs through the session automation endpoint', async () => {
    mockedClient.post.mockResolvedValueOnce({
      data: {
        message_id: 11,
        automation_id: 'daily_quant',
        automation_kind: 'cron_job',
        summary: 'created',
        metadata: { execution_type: 'Goal' },
      },
    });

    const response = await automationsApi.createCronJob('session-1', {
      prompt: '/cron-create ...',
      job_id: 'daily_quant',
      schedule: '0 9 * * *',
      execution_type: 'Goal',
      enabled: false,
      goal: 'Monitor quantlab',
    });

    expect(mockedClient.post).toHaveBeenCalledWith('/sessions/session-1/cron/create', {
      prompt: '/cron-create ...',
      job_id: 'daily_quant',
      schedule: '0 9 * * *',
      execution_type: 'Goal',
      enabled: false,
      goal: 'Monitor quantlab',
    });
    expect(response.automation_id).toBe('daily_quant');
  });

  it('lists triggers and recent events', async () => {
    mockedClient.get
      .mockResolvedValueOnce({
        data: {
          triggers: [{ id: 'trigger-1' }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          events: [{ id: 'evt-1' }],
        },
      });

    const triggers = await automationsApi.listTriggers();
    const events = await automationsApi.listRecentEvents(10);

    expect(mockedClient.get).toHaveBeenNthCalledWith(1, '/automations/triggers');
    expect(mockedClient.get).toHaveBeenNthCalledWith(2, '/automations/events/recent?limit=10');
    expect(triggers[0].id).toBe('trigger-1');
    expect(events[0].id).toBe('evt-1');
  });

  it('creates triggers through the session automation endpoint', async () => {
    mockedClient.post.mockResolvedValueOnce({
      data: {
        message_id: 12,
        automation_id: 'trigger-1',
        automation_kind: 'trigger',
        summary: 'created',
        metadata: { event_type: 'quantlab.completed' },
      },
    });

    const response = await automationsApi.createTrigger('session-1', {
      prompt: '/trigger-create ...',
      trigger_id: 'trigger-1',
      event_type: 'quantlab.completed',
      action_kind: 'goal',
      goal: 'Summarize run',
    });

    expect(mockedClient.post).toHaveBeenCalledWith('/sessions/session-1/triggers/create', {
      prompt: '/trigger-create ...',
      trigger_id: 'trigger-1',
      event_type: 'quantlab.completed',
      action_kind: 'goal',
      goal: 'Summarize run',
    });
    expect(response.automation_kind).toBe('trigger');
  });
});
