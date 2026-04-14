import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';

vi.mock('./client', () => ({
  default: {
    post: vi.fn(),
  },
}));

import client from './client';
import { executionCommandsApi } from './executionCommands';

describe('executionCommandsApi', () => {
  const mockedClient = client as Mocked<typeof client>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts goal runs to the dedicated session endpoint', async () => {
    mockedClient.post.mockResolvedValueOnce({
      data: { run_id: 'goalrun-123', message_id: 1, summary: 'done', structured_response: { output: [] } },
    });

    const response = await executionCommandsApi.runGoal('session-1', {
      prompt: '/goal-run audit repo',
      goal: 'audit repo',
    });

    expect(mockedClient.post).toHaveBeenCalledWith('/sessions/session-1/goals/run', {
      prompt: '/goal-run audit repo',
      goal: 'audit repo',
    });
    expect(response.run_id).toBe('goalrun-123');
  });

  it('posts reasoning runs to the dedicated session endpoint', async () => {
    mockedClient.post.mockResolvedValueOnce({
      data: { run_id: 'reasonrun-123', message_id: 2, summary: 'done', structured_response: { output: [] } },
    });

    const response = await executionCommandsApi.runReasoning('session-1', {
      prompt: '/reasoning-run prompt="inspect"',
      question: 'inspect',
      max_tokens: 320,
    });

    expect(mockedClient.post).toHaveBeenCalledWith('/sessions/session-1/reasoning/run', {
      prompt: '/reasoning-run prompt="inspect"',
      question: 'inspect',
      max_tokens: 320,
    });
    expect(response.run_id).toBe('reasonrun-123');
  });

  it('posts pipeline runs to the dedicated session endpoint', async () => {
    mockedClient.post.mockResolvedValueOnce({
      data: { run_id: 'piperun-123', message_id: 3, summary: 'done', structured_response: { output: [] } },
    });

    const response = await executionCommandsApi.runPipeline('session-1', {
      prompt: '/pipeline-run id=2 question="compare"',
      pipeline_id: 2,
      question: 'compare',
    });

    expect(mockedClient.post).toHaveBeenCalledWith('/sessions/session-1/pipelines/run', {
      prompt: '/pipeline-run id=2 question="compare"',
      pipeline_id: 2,
      question: 'compare',
    });
    expect(response.run_id).toBe('piperun-123');
  });
});
