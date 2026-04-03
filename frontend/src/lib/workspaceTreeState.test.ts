import { describe, expect, it, vi } from 'vitest';
import {
  expandedPathsForWorkspace,
  WORKSPACE_TREE_STORAGE_KEY,
  readWorkspaceTreeExpandedState,
  setWorkspaceTreeExpandedPaths,
  toggleTreePath,
  writeWorkspaceTreeExpandedState,
} from './workspaceTreeState';

describe('workspaceTreeState', () => {
  it('toggles paths and normalizes them', () => {
    expect(toggleTreePath([], 'src/app.ts')).toEqual(['src/app.ts']);
    expect(toggleTreePath(['src/app.ts'], 'src/app.ts')).toEqual([]);
    expect(toggleTreePath(['src/app.ts'], '  src/components/Button.tsx  ')).toEqual(['src/app.ts', 'src/components/Button.tsx']);
  });

  it('reads and writes expanded state', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ 'ws-1': ['src/app.ts'] })),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    } as unknown as Storage;

    const state = readWorkspaceTreeExpandedState(storage);
    expect(expandedPathsForWorkspace(state, 'ws-1')).toEqual(['src/app.ts']);

    writeWorkspaceTreeExpandedState(storage, setWorkspaceTreeExpandedPaths(state, 'ws-1', ['src/components']));
    expect(storage.setItem).toHaveBeenCalledWith(
      WORKSPACE_TREE_STORAGE_KEY,
      JSON.stringify({ 'ws-1': ['src/components'] }),
    );
  });

  it('falls back to an empty state on malformed storage', () => {
    const storage = {
      getItem: vi.fn(() => '{'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    } as unknown as Storage;

    expect(readWorkspaceTreeExpandedState(storage)).toEqual({});
  });
});
