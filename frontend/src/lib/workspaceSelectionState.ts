export interface WorkspaceEditorSelectionSnapshot {
  path: string;
  text: string;
  from: number;
  to: number;
}

export type WorkspaceEditorSelectionSnapshotState = Record<string, WorkspaceEditorSelectionSnapshot | null>;

export const WORKSPACE_EDITOR_SELECTION_SNAPSHOT_STORAGE_KEY = 'stepbit_workspace_editor_selection_snapshot';
export const WORKSPACE_EDITOR_SELECTION_EVENT = 'stepbit:workspace-editor-selection';

export function readWorkspaceSelectionSnapshotState(storage?: Storage): WorkspaceEditorSelectionSnapshotState {
  if (typeof storage === 'undefined') {
    return {};
  }

  try {
    return JSON.parse(storage.getItem(WORKSPACE_EDITOR_SELECTION_SNAPSHOT_STORAGE_KEY) || '{}') as WorkspaceEditorSelectionSnapshotState;
  } catch {
    return {};
  }
}

export function writeWorkspaceSelectionSnapshotState(
  storage: Storage | undefined,
  state: WorkspaceEditorSelectionSnapshotState,
): void {
  if (typeof storage === 'undefined') {
    return;
  }

  storage.setItem(WORKSPACE_EDITOR_SELECTION_SNAPSHOT_STORAGE_KEY, JSON.stringify(state));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(WORKSPACE_EDITOR_SELECTION_EVENT));
  }
}

export function selectionSnapshotForWorkspace(
  state: WorkspaceEditorSelectionSnapshotState,
  workspaceId: string | null,
): WorkspaceEditorSelectionSnapshot | null {
  if (!workspaceId) {
    return null;
  }

  return state[workspaceId] || null;
}

export function setSelectionSnapshotForWorkspace(
  state: WorkspaceEditorSelectionSnapshotState,
  workspaceId: string,
  snapshot: WorkspaceEditorSelectionSnapshot | null,
): WorkspaceEditorSelectionSnapshotState {
  return {
    ...state,
    [workspaceId]: snapshot,
  };
}
