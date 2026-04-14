import client from './client';
import type { ExecutionEvent, ExecutionRun } from '../types';

interface ExecutionRunsEnvelope {
  runs: ExecutionRun[];
}

interface ExecutionRunEnvelope {
  run: ExecutionRun;
}

interface ExecutionEventsEnvelope {
  events: ExecutionEvent[];
}

export const executionsApi = {
  list: async (): Promise<ExecutionRun[]> => {
    const response = await client.get<ExecutionRunsEnvelope>('/executions');
    return response.data.runs;
  },

  get: async (id: string): Promise<ExecutionRun> => {
    const response = await client.get<ExecutionRunEnvelope>(`/executions/${id}`);
    return response.data.run;
  },

  listEvents: async (id: string): Promise<ExecutionEvent[]> => {
    const response = await client.get<ExecutionEventsEnvelope>(`/executions/${id}/events`);
    return response.data.events;
  },
};
