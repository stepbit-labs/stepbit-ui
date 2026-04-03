import type { Message } from '../types';
import type {
  WorkspaceConversationTurn,
  WorkspaceContextRequest,
} from '../api/workspaces';

export const ACTIVE_WORKSPACE_STORAGE_KEY = 'stepbit_workspace_active_id';
export const WORKSPACE_FOCUS_STORAGE_KEY = 'stepbit_workspace_focus_paths';

export interface WorkspaceSelection {
  workspaceId: string | null;
  focusPaths: string[];
}

export function readWorkspaceSelection(): WorkspaceSelection {
  if (typeof localStorage === 'undefined') {
    return { workspaceId: null, focusPaths: [] };
  }

  const workspaceId = localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  const focusPaths = readFocusPaths(workspaceId);
  return { workspaceId, focusPaths };
}

export function setActiveWorkspaceId(workspaceId: string | null): void {
  if (typeof localStorage === 'undefined') return;

  if (workspaceId) {
    localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);
  } else {
    localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  }
}

export function readFocusPaths(workspaceId: string | null): string[] {
  if (typeof localStorage === 'undefined' || !workspaceId) {
    return [];
  }

  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACE_FOCUS_STORAGE_KEY) || '{}') as Record<string, string[]>;
    return parsed[workspaceId] || [];
  } catch {
    return [];
  }
}

export function resolveWorkspaceContextPaths(params: {
  currentFilePath?: string | null;
  currentSymbolPath?: string | null;
  storedPaths?: string[];
}): string[] {
  const {
    currentFilePath = null,
    currentSymbolPath = null,
    storedPaths = [],
  } = params;

  return Array.from(
    new Set(
      [currentFilePath, currentSymbolPath, ...storedPaths]
        .map((path) => (path || '').trim())
        .filter(Boolean),
    ),
  );
}

export function buildWorkspaceContextRequest(params: {
  prompt: string;
  messages: Message[];
  workspaceId: string;
  selectedPaths: string[];
  conversationId?: string | null;
  recentTurnLimit?: number;
  totalTokens?: number;
  reservedForOutput?: number;
}): WorkspaceContextRequest | null {
  const {
    prompt,
    messages,
    workspaceId,
    selectedPaths,
    conversationId = null,
    recentTurnLimit = 8,
    totalTokens = 2048,
    reservedForOutput = 256,
  } = params;

  const trimmedPrompt = prompt.trim();
  const trimmedPaths = Array.from(new Set(selectedPaths.map((path) => path.trim()).filter(Boolean)));

  if (!trimmedPrompt || !workspaceId) {
    return null;
  }

  const recentTurns = messages
    .slice(-recentTurnLimit)
    .map(toWorkspaceConversationTurn);

  return {
    conversationId: conversationId || undefined,
    prompt: trimmedPrompt,
    recentTurns,
    selectedPaths: trimmedPaths,
    totalTokens,
    reservedForOutput,
  };
}

export function toWorkspaceConversationTurn(message: Message): WorkspaceConversationTurn {
  return {
    role: message.role,
    text: message.content,
    id: String(message.id),
    createdAt: message.created_at,
  };
}

export function describeWorkspaceContextRequest(request: WorkspaceContextRequest): string {
  const pathCount = request.selectedPaths.length;
  const turnCount = request.recentTurns.length;
  return `${pathCount} context paths, ${turnCount} recent turns, ${request.totalTokens - request.reservedForOutput} context budget`;
}
