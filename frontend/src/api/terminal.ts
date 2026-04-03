import api from './client';

export interface TerminalSessionRecord {
  id: string;
  cwd: string;
  sessionToken: string;
}

export interface TerminalWorkspaceEvent {
  workspaceId: string;
  workspaceName: string;
  rootPath: string;
  indexingStarted: boolean;
  alreadyRegistered: boolean;
}

export interface TerminalOutputChunk {
  cursor: number;
  output: string;
  cwd: string;
  workspaceEvent?: TerminalWorkspaceEvent | null;
}

export const terminalApi = {
  async createSession(cwd?: string | null): Promise<TerminalSessionRecord> {
    const response = await api.post<TerminalSessionRecord>('/terminal/sessions', {
      cwd: cwd || undefined,
    });
    return response.data;
  },

  async readOutput(sessionId: string, cursor: number): Promise<TerminalOutputChunk> {
    const response = await api.get<TerminalOutputChunk>(`/terminal/sessions/${sessionId}/output`, {
      params: { cursor },
    });
    return response.data;
  },

  async sendInput(sessionId: string, input: string): Promise<void> {
    await api.post(`/terminal/sessions/${sessionId}/input`, { input });
  },

  async interrupt(sessionId: string): Promise<void> {
    await api.post(`/terminal/sessions/${sessionId}/interrupt`);
  },

  async resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
    await api.post(`/terminal/sessions/${sessionId}/resize`, { cols, rows });
  },

  async closeSession(sessionId: string): Promise<void> {
    await api.delete(`/terminal/sessions/${sessionId}`);
  },
};
