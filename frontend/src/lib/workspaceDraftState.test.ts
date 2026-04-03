import { describe, expect, it, vi } from 'vitest';
import {
  WORKSPACE_DRAFT_STORAGE_KEY,
  clearWorkspaceDraftForFile,
  draftContentForWorkspaceFile,
  hasWorkspaceDraftForFile,
  readWorkspaceDraftState,
  setWorkspaceDraftForFile,
  writeWorkspaceDraftState,
} from './workspaceDraftState';

describe('workspaceDraftState', () => {
  it('reads, writes, and clears drafts per workspace file', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ 'ws-1': { 'src/app.ts': 'export const app = true;' } })),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    } as unknown as Storage;

    const state = readWorkspaceDraftState(storage);
    expect(draftContentForWorkspaceFile(state, 'ws-1', 'src/app.ts')).toBe('export const app = true;');
    expect(hasWorkspaceDraftForFile(state, 'ws-1', 'src/app.ts')).toBe(true);

    const updated = setWorkspaceDraftForFile(state, 'ws-1', 'src/app.ts', 'export const app = false;');
    writeWorkspaceDraftState(storage, updated);

    expect(storage.setItem).toHaveBeenCalledWith(
      WORKSPACE_DRAFT_STORAGE_KEY,
      JSON.stringify({ 'ws-1': { 'src/app.ts': 'export const app = false;' } }),
    );

    expect(clearWorkspaceDraftForFile(updated, 'ws-1', 'src/app.ts')).toEqual({});
  });

  it('preserves empty-string drafts as real edits', () => {
    const state = setWorkspaceDraftForFile({}, 'ws-1', 'src/app.ts', '');
    expect(draftContentForWorkspaceFile(state, 'ws-1', 'src/app.ts')).toBe('');
    expect(hasWorkspaceDraftForFile(state, 'ws-1', 'src/app.ts')).toBe(true);
  });
});
