import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildWorkspaceContextRequest, describeWorkspaceContextRequest, resolveWorkspaceContextPaths, setActiveWorkspaceId } from './workspaceContext';
import type { Message } from '../types';

const messages: Message[] = [
  {
    id: 1,
    session_id: 'session-1',
    role: 'user',
    content: 'inspect the repo',
    model: null,
    token_count: null,
    created_at: '2026-03-31T12:00:00Z',
    metadata: {},
  },
  {
    id: 2,
    session_id: 'session-1',
    role: 'assistant',
    content: 'sure',
    model: 'model-1',
    token_count: null,
    created_at: '2026-03-31T12:00:01Z',
    metadata: {},
  },
];

beforeEach(() => {
  const storage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
  vi.stubGlobal('localStorage', storage as unknown as Storage);
});

describe('workspaceContext', () => {
  it('builds a context request with recent turns and focus paths', () => {
    const request = buildWorkspaceContextRequest({
      prompt: 'fix the bug',
      messages,
      workspaceId: 'ws-1',
      selectedPaths: ['src/app.ts', 'src/app.ts', 'README.md'],
      conversationId: 'session-1',
      recentTurnLimit: 8,
    });

    expect(request).not.toBeNull();
    expect(request?.selectedPaths).toEqual(['src/app.ts', 'README.md']);
    expect(request?.recentTurns).toHaveLength(2);
    expect(request?.recentTurns[0].role).toBe('user');
  });

  it('returns a human readable summary for the request', () => {
    const request = buildWorkspaceContextRequest({
      prompt: 'fix the bug',
      messages,
      workspaceId: 'ws-1',
      selectedPaths: ['src/app.ts'],
      conversationId: 'session-1',
    });

    expect(request).not.toBeNull();
    expect(describeWorkspaceContextRequest(request!)).toContain('1 context paths');
  });

  it('resolves implicit context paths from the active file and symbol', () => {
    expect(resolveWorkspaceContextPaths({
      currentFilePath: 'src/app.ts',
      currentSymbolPath: 'src/app.ts',
      storedPaths: ['README.md', 'src/app.ts'],
    })).toEqual(['src/app.ts', 'README.md']);
  });

  it('stores the active workspace id in localStorage', () => {
    setActiveWorkspaceId('ws-1');
    expect(localStorage.setItem).toHaveBeenCalledWith('stepbit_workspace_active_id', 'ws-1');
  });
});
