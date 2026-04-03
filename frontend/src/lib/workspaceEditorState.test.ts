import { describe, expect, it, vi } from 'vitest';
import {
  WORKSPACE_EDITOR_SELECTION_STORAGE_KEY,
  readWorkspaceEditorSelectionState,
  selectedFilePathForWorkspace,
  setSelectedFilePathForWorkspace,
  writeWorkspaceEditorSelectionState,
} from './workspaceEditorState';

describe('workspaceEditorState', () => {
  it('reads and writes active file state per workspace', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ 'ws-1': 'src/app.ts' })),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    } as unknown as Storage;

    const state = readWorkspaceEditorSelectionState(storage);
    expect(selectedFilePathForWorkspace(state, 'ws-1')).toBe('src/app.ts');

    writeWorkspaceEditorSelectionState(storage, setSelectedFilePathForWorkspace(state, 'ws-1', 'src/components/Button.tsx'));
    expect(storage.setItem).toHaveBeenCalledWith(
      WORKSPACE_EDITOR_SELECTION_STORAGE_KEY,
      JSON.stringify({ 'ws-1': 'src/components/Button.tsx' }),
    );
  });

  it('normalizes blank selections to null', () => {
    const state = setSelectedFilePathForWorkspace({}, 'ws-1', '   ');
    expect(selectedFilePathForWorkspace(state, 'ws-1')).toBeNull();
  });
});
