import api from './client';
import type { WorkspaceFileRecord } from '../lib/workspaceTree';

export interface WorkspaceRecord {
  id: string;
  name: string;
  root_path: string;
  vcs_branch?: string | null;
  last_scan_at?: string | null;
  last_index_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceFileContentResponse {
  workspaceId: string;
  path: string;
  content: string;
  sizeBytes: number;
  lineCount: number;
  language?: string | null;
}

export interface WorkspaceFileWriteRequest {
  path: string;
  content: string;
}

export interface WorkspaceSymbolRecord {
  id: string;
  workspaceId: string;
  fileId: string;
  path: string;
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  signature?: string | null;
  containerName?: string | null;
  indexedAt: string;
}

export interface WorkspaceReferenceRecord {
  id: string;
  workspaceId: string;
  fileId: string;
  path: string;
  chunkId: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  snippet: string;
  matchedText: string;
  indexedAt: string;
}

export interface WorkspaceIndexState {
  workspace_id: string;
  status: string;
  last_index_started_at?: string | null;
  last_index_completed_at?: string | null;
  last_error?: string | null;
  indexed_file_count: number;
  indexed_chunk_count: number;
  changed_file_count: number;
  skipped_file_count: number;
}

export interface WorkspaceHealthResponse {
  workspaceId: string;
  rootPath: string;
  rootExists: boolean;
  rootIsDirectory: boolean;
  status: string;
}

export interface RegisterWorkspaceRequest {
  id?: string;
  name?: string;
  root_path: string;
  vcs_branch?: string;
  created_at?: string;
}

export interface RebindWorkspaceRequest {
  root_path: string;
}

export interface WorkspaceContextRequest {
  conversationId?: string;
  prompt: string;
  recentTurns: WorkspaceConversationTurn[];
  selectedPaths: string[];
  totalTokens: number;
  reservedForOutput: number;
}

export interface WorkspaceConversationTurn {
  role: string;
  text: string;
  id?: string;
  createdAt?: string;
}

export interface WorkspaceContextPack {
  version: 'v1';
  workspaceId?: string | null;
  conversationId?: string | null;
  summary?: string | null;
  sections: Array<{
    id: string;
    kind: string;
    title?: string | null;
    text: string;
    priority: number;
    token_estimate: number;
    provenance: Array<{
      source_kind: string;
      source_id: string;
      label?: string | null;
      path?: string | null;
      line_start?: number | null;
      line_end?: number | null;
      inclusion_reason: string;
      score?: number | null;
    }>;
  }>;
  tokenBudget: {
    totalTokens: number;
    reservedForOutput: number;
    availableForContext: number;
    usedForContext: number;
  };
  diagnostics: {
    retrievalStrategy: string;
    assemblyNotes: string[];
  };
}

export const workspaceApi = {
  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    const response = await api.get<WorkspaceRecord[]>('/workspaces');
    return response.data;
  },

  async registerWorkspace(request: RegisterWorkspaceRequest): Promise<WorkspaceRecord> {
    const response = await api.post<WorkspaceRecord>('/workspaces', request);
    return response.data;
  },

  async getWorkspaceHealth(workspaceId: string): Promise<WorkspaceHealthResponse> {
    const response = await api.get<WorkspaceHealthResponse>(`/workspaces/${workspaceId}/health`);
    return response.data;
  },

  async indexWorkspace(workspaceId: string): Promise<{ workspace_id: string; files_discovered: number; files_indexed: number; files_skipped_unchanged: number; files_skipped_filtered: number; chunks_written: number; }> {
    const response = await api.post(`/workspaces/${workspaceId}/index`);
    return response.data;
  },

  async getWorkspaceIndexState(workspaceId: string): Promise<WorkspaceIndexState> {
    const response = await api.get<WorkspaceIndexState>(`/workspaces/${workspaceId}/index-state`);
    return response.data;
  },

  async listWorkspaceFiles(workspaceId: string): Promise<WorkspaceFileRecord[]> {
    const response = await api.get<WorkspaceFileRecord[]>(`/workspaces/${workspaceId}/files`);
    return response.data;
  },

  async listWorkspaceSymbols(workspaceId: string): Promise<WorkspaceSymbolRecord[]> {
    const response = await api.get<WorkspaceSymbolRecord[]>(`/workspaces/${workspaceId}/symbols`);
    return response.data;
  },

  async searchWorkspaceSymbols(workspaceId: string, query: string): Promise<WorkspaceSymbolRecord[]> {
    const response = await api.get<WorkspaceSymbolRecord[]>(`/workspaces/${workspaceId}/symbols`, {
      params: { query },
    });
    return response.data;
  },

  async searchWorkspaceDefinitions(workspaceId: string, query: string): Promise<WorkspaceSymbolRecord[]> {
    const response = await api.get<WorkspaceSymbolRecord[]>(`/workspaces/${workspaceId}/definitions`, {
      params: { query },
    });
    return response.data;
  },

  async searchWorkspaceReferences(workspaceId: string, query: string): Promise<WorkspaceReferenceRecord[]> {
    const response = await api.get<WorkspaceReferenceRecord[]>(`/workspaces/${workspaceId}/references`, {
      params: { query },
    });
    return response.data;
  },

  async getWorkspaceFileContent(workspaceId: string, path: string): Promise<WorkspaceFileContentResponse> {
    const response = await api.get<WorkspaceFileContentResponse>(`/workspaces/${workspaceId}/file`, {
      params: { path },
    });
    return response.data;
  },

  async saveWorkspaceFileContent(workspaceId: string, request: WorkspaceFileWriteRequest): Promise<WorkspaceFileContentResponse> {
    const response = await api.post<WorkspaceFileContentResponse>(`/workspaces/${workspaceId}/file`, request);
    return response.data;
  },

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await api.delete(`/workspaces/${workspaceId}`);
  },

  async rebindWorkspace(workspaceId: string, request: RebindWorkspaceRequest): Promise<WorkspaceRecord> {
    const response = await api.post<WorkspaceRecord>(`/workspaces/${workspaceId}/rebind`, request);
    return response.data;
  },

  async assembleContext(workspaceId: string, request: WorkspaceContextRequest): Promise<WorkspaceContextPack> {
    const response = await api.post<WorkspaceContextPack>(`/workspaces/${workspaceId}/context`, request);
    return response.data;
  },
};
