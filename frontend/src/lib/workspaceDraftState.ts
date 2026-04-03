export type WorkspaceDraftState = Record<string, Record<string, string>>;

export const WORKSPACE_DRAFT_STORAGE_KEY = 'stepbit_workspace_editor_drafts';

export function readWorkspaceDraftState(storage?: Storage): WorkspaceDraftState {
  if (typeof storage === 'undefined') {
    return {};
  }

  try {
    return JSON.parse(storage.getItem(WORKSPACE_DRAFT_STORAGE_KEY) || '{}') as WorkspaceDraftState;
  } catch {
    return {};
  }
}

export function writeWorkspaceDraftState(storage: Storage | undefined, state: WorkspaceDraftState): void {
  if (typeof storage === 'undefined') {
    return;
  }

  storage.setItem(WORKSPACE_DRAFT_STORAGE_KEY, JSON.stringify(state));
}

export function draftContentForWorkspaceFile(
  state: WorkspaceDraftState,
  workspaceId: string | null,
  path: string | null,
): string | null {
  if (!workspaceId || !path) {
    return null;
  }

  const workspaceDrafts = state[workspaceId];
  if (!workspaceDrafts || !Object.prototype.hasOwnProperty.call(workspaceDrafts, path)) {
    return null;
  }

  return workspaceDrafts[path];
}

export function hasWorkspaceDraftForFile(
  state: WorkspaceDraftState,
  workspaceId: string | null,
  path: string | null,
): boolean {
  if (!workspaceId || !path) {
    return false;
  }

  return Boolean(state[workspaceId] && Object.prototype.hasOwnProperty.call(state[workspaceId], path));
}

export function setWorkspaceDraftForFile(
  state: WorkspaceDraftState,
  workspaceId: string,
  path: string,
  content: string,
): WorkspaceDraftState {
  return {
    ...state,
    [workspaceId]: {
      ...(state[workspaceId] || {}),
      [path]: content,
    },
  };
}

export function clearWorkspaceDraftForFile(
  state: WorkspaceDraftState,
  workspaceId: string,
  path: string,
): WorkspaceDraftState {
  const workspaceDrafts = state[workspaceId];
  if (!workspaceDrafts || !Object.prototype.hasOwnProperty.call(workspaceDrafts, path)) {
    return state;
  }

  const nextDrafts = { ...workspaceDrafts };
  delete nextDrafts[path];

  if (Object.keys(nextDrafts).length === 0) {
    const nextState = { ...state };
    delete nextState[workspaceId];
    return nextState;
  }

  return {
    ...state,
    [workspaceId]: nextDrafts,
  };
}
