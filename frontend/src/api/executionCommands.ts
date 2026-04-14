import api from './client';
import type {
  ExecutionCommandResponse,
  GoalRunRequest,
  PipelineRunRequest,
  ReasoningRunRequest,
} from '../types';

export const executionCommandsApi = {
  runGoal: (sessionId: string, data: GoalRunRequest): Promise<ExecutionCommandResponse> =>
    api.post(`/sessions/${sessionId}/goals/run`, data).then((response) => response.data),

  runReasoning: (sessionId: string, data: ReasoningRunRequest): Promise<ExecutionCommandResponse> =>
    api.post(`/sessions/${sessionId}/reasoning/run`, data).then((response) => response.data),

  runPipeline: (sessionId: string, data: PipelineRunRequest): Promise<ExecutionCommandResponse> =>
    api.post(`/sessions/${sessionId}/pipelines/run`, data).then((response) => response.data),
};
