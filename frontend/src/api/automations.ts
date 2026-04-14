import client from './client';
import type {
  AutomationCommandResponse,
  CronCreateRequest,
  CronJob,
  CronStatus,
  RecentAutomationEvent,
  TriggerCreateRequest,
  TriggerDefinition,
} from '../types';

export const automationsApi = {
  getCronStatus: async (): Promise<CronStatus> => {
    const response = await client.get('/automations/cron/status');
    return response.data;
  },

  listCronJobs: async (): Promise<CronJob[]> => {
    const response = await client.get('/automations/cron/jobs');
    return response.data.jobs || [];
  },

  createCronJob: async (sessionId: string, payload: CronCreateRequest): Promise<AutomationCommandResponse> => {
    const response = await client.post(`/sessions/${sessionId}/cron/create`, payload);
    return response.data;
  },

  triggerCronJob: async (id: string): Promise<{ status: string; run_id: string }> => {
    const response = await client.post(`/automations/cron/jobs/${id}/trigger`);
    return response.data;
  },

  enableCronJob: async (id: string): Promise<{ status: string }> => {
    const response = await client.post(`/automations/cron/jobs/${id}/enable`);
    return response.data;
  },

  disableCronJob: async (id: string): Promise<{ status: string }> => {
    const response = await client.post(`/automations/cron/jobs/${id}/disable`);
    return response.data;
  },

  deleteCronJob: async (id: string): Promise<void> => {
    await client.delete(`/automations/cron/jobs/${id}`);
  },

  listTriggers: async (): Promise<TriggerDefinition[]> => {
    const response = await client.get('/automations/triggers');
    return response.data.triggers || [];
  },

  createTrigger: async (sessionId: string, payload: TriggerCreateRequest): Promise<AutomationCommandResponse> => {
    const response = await client.post(`/sessions/${sessionId}/triggers/create`, payload);
    return response.data;
  },

  deleteTrigger: async (id: string): Promise<void> => {
    await client.delete(`/automations/triggers/${id}`);
  },

  listRecentEvents: async (limit = 20): Promise<RecentAutomationEvent[]> => {
    const response = await client.get(`/automations/events/recent?limit=${limit}`);
    return response.data.events || [];
  },
};
