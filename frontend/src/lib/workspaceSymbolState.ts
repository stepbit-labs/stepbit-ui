export interface WorkspaceSymbolSelection {
  id: string;
  name: string;
  path: string;
  kind?: string;
  startLine?: number;
}

export type WorkspaceSymbolSelectionState = Record<string, WorkspaceSymbolSelection | null>;

export const WORKSPACE_SYMBOL_SELECTION_STORAGE_KEY = 'stepbit_workspace_selected_symbol';

export function readWorkspaceSymbolSelectionState(storage?: Storage): WorkspaceSymbolSelectionState {
  if (typeof storage === 'undefined') {
    return {};
  }

  try {
    return JSON.parse(storage.getItem(WORKSPACE_SYMBOL_SELECTION_STORAGE_KEY) || '{}') as WorkspaceSymbolSelectionState;
  } catch {
    return {};
  }
}

export function writeWorkspaceSymbolSelectionState(
  storage: Storage | undefined,
  state: WorkspaceSymbolSelectionState,
): void {
  if (typeof storage === 'undefined') {
    return;
  }

  storage.setItem(WORKSPACE_SYMBOL_SELECTION_STORAGE_KEY, JSON.stringify(state));
}

export function selectedSymbolForWorkspace(
  state: WorkspaceSymbolSelectionState,
  workspaceId: string | null,
): WorkspaceSymbolSelection | null {
  if (!workspaceId) {
    return null;
  }

  return state[workspaceId] || null;
}

export function setSelectedSymbolForWorkspace(
  state: WorkspaceSymbolSelectionState,
  workspaceId: string,
  symbol: WorkspaceSymbolSelection | null,
): WorkspaceSymbolSelectionState {
  return {
    ...state,
    [workspaceId]: symbol,
  };
}
