import { bench, describe } from 'vitest';
import { buildWorkspaceContextRequest } from './workspaceContext';
import type { Message } from '../types';

const messages: Message[] = Array.from({ length: 1_000 }, (_, index) => ({
  id: index,
  session_id: 'session-1',
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: `message ${index}`,
  model: index % 2 === 0 ? null : 'model-1',
  token_count: null,
  created_at: '2026-03-31T12:00:00Z',
  metadata: {},
}));

describe('workspaceContext benchmark', () => {
  bench('buildWorkspaceContextRequest 1k messages', () => {
    buildWorkspaceContextRequest({
      prompt: 'fix the bug',
      messages,
      workspaceId: 'ws-1',
      selectedPaths: ['src/app.ts', 'src/components/Button.tsx', 'README.md'],
      conversationId: 'session-1',
    });
  });
});
