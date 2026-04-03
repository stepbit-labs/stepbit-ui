export type WorkspaceTreeExpandedState = Record<string, string[]>;

export const WORKSPACE_TREE_STORAGE_KEY = 'stepbit_workspace_tree_open';

export function readWorkspaceTreeExpandedState(storage?: Storage): WorkspaceTreeExpandedState {
  if (typeof storage === 'undefined') {
    return {};
  }

  try {
    return JSON.parse(storage.getItem(WORKSPACE_TREE_STORAGE_KEY) || '{}') as WorkspaceTreeExpandedState;
  } catch {
    return {};
  }
}

export function writeWorkspaceTreeExpandedState(
  storage: Storage | undefined,
  state: WorkspaceTreeExpandedState,
): void {
  if (typeof storage === 'undefined') {
    return;
  }

  storage.setItem(WORKSPACE_TREE_STORAGE_KEY, JSON.stringify(state));
}

export function expandedPathsForWorkspace(
  state: WorkspaceTreeExpandedState,
  workspaceId: string | null,
): string[] {
  if (!workspaceId) {
    return [];
  }

  return state[workspaceId] || [];
}

export function toggleTreePath(paths: string[], candidate: string): string[] {
  const normalized = candidate.trim();
  if (!normalized) {
    return paths;
  }

  return paths.includes(normalized)
    ? paths.filter((path) => path !== normalized)
    : [...paths, normalized];
}

export function setWorkspaceTreeExpandedPaths(
  state: WorkspaceTreeExpandedState,
  workspaceId: string,
  paths: string[],
): WorkspaceTreeExpandedState {
  return {
    ...state,
    [workspaceId]: Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean))),
  };
}
