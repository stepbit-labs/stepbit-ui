import { describe, expect, it, vi } from 'vitest';
import {
  readWorkspaceSymbolSelectionState,
  selectedSymbolForWorkspace,
  setSelectedSymbolForWorkspace,
} from './workspaceSymbolState';

describe('workspaceSymbolState', () => {
  it('round-trips symbol selections per workspace', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        'ws-1': { id: 'sym-1', name: 'openWorkspace', path: 'src/app.ts', kind: 'function', startLine: 12 },
      })),
      setItem: vi.fn(),
    } as unknown as Storage;

    const state = readWorkspaceSymbolSelectionState(storage);
    expect(selectedSymbolForWorkspace(state, 'ws-1')).toEqual({
      id: 'sym-1',
      name: 'openWorkspace',
      path: 'src/app.ts',
      kind: 'function',
      startLine: 12,
    });

    const nextState = setSelectedSymbolForWorkspace(state, 'ws-1', null);
    expect(selectedSymbolForWorkspace(nextState, 'ws-1')).toBeNull();
  });

  it('returns null for missing workspaces', () => {
    expect(selectedSymbolForWorkspace({}, 'ws-1')).toBeNull();
  });
});
