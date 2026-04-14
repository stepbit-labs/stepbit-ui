import type { Message } from '../types';

const EXECUTION_RUN_PATTERN = /\b(?:goalrun|piperun|reasonrun|cronrun)-[A-Za-z0-9_-]+\b/;

export function extractExecutionRunIdFromMessage(message: Message | null | undefined): string | null {
  if (!message) {
    return null;
  }

  const metadata = message.metadata || {};
  const candidates = [
    metadata.execution_run_id,
    metadata.run_id,
    metadata.goal_run_id,
    metadata.structured_response?.metadata?.execution_run_id,
    metadata.structured_response?.metadata?.goal_run_id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }

  const contentMatch = message.content.match(EXECUTION_RUN_PATTERN);
  return contentMatch ? contentMatch[0] : null;
}
