import { describe, expect, it, vi } from 'vitest';
import {
  readWorkspaceSelectionSnapshotState,
  selectionSnapshotForWorkspace,
  setSelectionSnapshotForWorkspace,
  writeWorkspaceSelectionSnapshotState,
} from './workspaceSelectionState';

describe('workspaceSelectionState', () => {
  it('stores and reads workspace editor selections', () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    } as unknown as Storage;

    const next = setSelectionSnapshotForWorkspace({}, 'ws-1', {
      path: 'src/app.ts',
      text: 'assemble_context()',
      from: 10,
      to: 28,
    });

    writeWorkspaceSelectionSnapshotState(storage, next);
    expect(storage.setItem).toHaveBeenCalled();
    expect(selectionSnapshotForWorkspace(next, 'ws-1')?.text).toBe('assemble_context()');
  });

  it('returns empty state on invalid storage payload', () => {
    const storage = {
      getItem: vi.fn(() => '{'),
    } as unknown as Storage;

    expect(readWorkspaceSelectionSnapshotState(storage)).toEqual({});
  });
});
