import { WORKSPACE_EDITOR_SELECTION_EVENT } from './workspaceSelectionState';

export type WorkspaceEditorSelectionState = Record<string, string | null>;

export const WORKSPACE_EDITOR_SELECTION_STORAGE_KEY = 'stepbit_workspace_editor_selected_file';

export function readWorkspaceEditorSelectionState(storage?: Storage): WorkspaceEditorSelectionState {
  if (typeof storage === 'undefined') {
    return {};
  }

  try {
    return JSON.parse(storage.getItem(WORKSPACE_EDITOR_SELECTION_STORAGE_KEY) || '{}') as WorkspaceEditorSelectionState;
  } catch {
    return {};
  }
}

export function writeWorkspaceEditorSelectionState(
  storage: Storage | undefined,
  state: WorkspaceEditorSelectionState,
): void {
  if (typeof storage === 'undefined') {
    return;
  }

  storage.setItem(WORKSPACE_EDITOR_SELECTION_STORAGE_KEY, JSON.stringify(state));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(WORKSPACE_EDITOR_SELECTION_EVENT));
  }
}

export function selectedFilePathForWorkspace(
  state: WorkspaceEditorSelectionState,
  workspaceId: string | null,
): string | null {
  if (!workspaceId) {
    return null;
  }

  return state[workspaceId] || null;
}

export function setSelectedFilePathForWorkspace(
  state: WorkspaceEditorSelectionState,
  workspaceId: string,
  path: string | null,
): WorkspaceEditorSelectionState {
  return {
    ...state,
    [workspaceId]: path ? path.trim() : null,
  };
}
