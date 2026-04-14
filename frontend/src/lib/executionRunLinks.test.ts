import { describe, expect, it } from 'vitest';
import { extractExecutionRunIdFromMessage } from './executionRunLinks';
import type { Message } from '../types';

function message(overrides: Partial<Message>): Message {
  return {
    id: 1,
    session_id: 'session-1',
    role: 'assistant',
    content: '',
    model: null,
    token_count: null,
    created_at: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

describe('extractExecutionRunIdFromMessage', () => {
  it('prefers explicit metadata execution ids', () => {
    const result = extractExecutionRunIdFromMessage(
      message({
        metadata: {
          execution_run_id: 'piperun-abc123',
        },
      }),
    );

    expect(result).toBe('piperun-abc123');
  });

  it('falls back to structured metadata ids', () => {
    const result = extractExecutionRunIdFromMessage(
      message({
        metadata: {
          structured_response: {
            metadata: {
              goal_run_id: 'goalrun-xyz789',
            },
          },
        },
      }),
    );

    expect(result).toBe('goalrun-xyz789');
  });

  it('accepts generic run_id metadata from analysis messages', () => {
    const result = extractExecutionRunIdFromMessage(
      message({
        metadata: {
          run_id: 'reasonrun-test123',
        },
      }),
    );

    expect(result).toBe('reasonrun-test123');
  });

  it('extracts run ids from assistant content when metadata is absent', () => {
    const result = extractExecutionRunIdFromMessage(
      message({
        content: 'Goal execution `goalrun-1a2b3c` completed successfully.',
      }),
    );

    expect(result).toBe('goalrun-1a2b3c');
  });
});
