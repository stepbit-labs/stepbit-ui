import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useQuery = vi.fn();
const useMutation = vi.fn();
const useQueryClient = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
  useMutation: (...args: unknown[]) => useMutation(...args),
  useQueryClient: (...args: unknown[]) => useQueryClient(...args),
}));

vi.mock('../api/workspaces', () => ({
  workspaceApi: {
    listWorkspaces: vi.fn(),
    listWorkspaceFiles: vi.fn(),
    listWorkspaceSymbols: vi.fn(),
    searchWorkspaceSymbols: vi.fn(),
    searchWorkspaceReferences: vi.fn(),
    getWorkspaceIndexState: vi.fn(),
    registerWorkspace: vi.fn(),
    indexWorkspace: vi.fn(),
    getWorkspaceFileContent: vi.fn(),
    saveWorkspaceFileContent: vi.fn(),
  },
}));

import Workspaces from './Workspaces';

const workspaces = [
  {
    id: 'ws-1',
    name: 'repo',
    root_path: '/tmp/repo',
    vcs_branch: 'main',
    last_scan_at: null,
    last_index_at: null,
    created_at: '2026-03-31T12:00:00Z',
    updated_at: '2026-03-31T12:00:00Z',
  },
  {
    id: 'ws-2',
    name: 'repo-2',
    root_path: '/tmp/repo-2',
    vcs_branch: 'main',
    last_scan_at: null,
    last_index_at: null,
    created_at: '2026-03-31T12:00:00Z',
    updated_at: '2026-03-31T12:00:00Z',
  },
];

const files = [
  { id: '1', workspace_id: 'ws-1', path: 'src/app.ts', size_bytes: 10 },
  { id: '2', workspace_id: 'ws-1', path: 'src/components/Button.tsx', size_bytes: 10 },
  { id: '3', workspace_id: 'ws-1', path: 'README.md', size_bytes: 10 },
];

beforeEach(() => {
  const storage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  };
  vi.stubGlobal('localStorage', storage as unknown as Storage);

  useQuery.mockImplementation((options: any) => {
    const key = Array.isArray(options.queryKey) ? options.queryKey[0] : options.queryKey;
    if (key === 'workspaces') {
      return { data: workspaces, isLoading: false };
    }
    if (key === 'workspace-files') {
      return { data: files, isLoading: false };
    }
    if (key === 'workspace-index-state') {
      return {
        data: {
          workspace_id: 'ws-1',
          status: 'ready',
          indexed_file_count: 3,
          indexed_chunk_count: 12,
          changed_file_count: 0,
          skipped_file_count: 0,
          last_index_started_at: null,
          last_index_completed_at: null,
          last_error: null,
        },
        isLoading: false,
      };
    }
    if (key === 'workspace-file-content') {
      return {
        data: {
          workspaceId: 'ws-1',
          path: 'src/app.ts',
          content: 'export const app = true;\n',
          sizeBytes: 24,
          lineCount: 1,
          language: 'typescript',
        },
        isLoading: false,
      };
    }
    if (key === 'workspace-health') {
      const workspaceId = options.queryKey[1];
      return {
        data: {
          workspaceId,
          rootPath: workspaceId === 'ws-1' ? '/tmp/repo' : '/tmp/repo-2',
          rootExists: workspaceId === 'ws-1',
          rootIsDirectory: workspaceId === 'ws-1',
          status: workspaceId === 'ws-1' ? 'ready' : 'missing',
        },
        isLoading: false,
      };
    }
    if (key === 'workspace-symbols') {
      return {
        data: [
          {
            id: 'symbol-1',
            workspaceId: 'ws-1',
            fileId: '1',
            path: 'src/app.ts',
            name: 'openWorkspace',
            kind: 'function',
            startLine: 20,
            endLine: 24,
            signature: 'export function openWorkspace() {',
            containerName: null,
            indexedAt: '2026-03-31T12:00:00Z',
          },
        ],
        isLoading: false,
      };
    }
    if (key === 'workspace-references') {
      return {
        data: [
          {
            id: 'reference-1',
            workspaceId: 'ws-1',
            fileId: '1',
            path: 'src/app.ts',
            chunkId: 'chunk-1',
            chunkIndex: 0,
            startLine: 12,
            endLine: 14,
            snippet: 'openWorkspace();',
            matchedText: 'openWorkspace',
            indexedAt: '2026-03-31T12:00:00Z',
          },
        ],
        isLoading: false,
      };
    }
    return { data: undefined, isLoading: false };
  });

  useMutation.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  });

  useQueryClient.mockReturnValue({
    invalidateQueries: vi.fn(),
  });
});

describe('Workspaces page', () => {
  it('renders the workspace tree and lets you inspect files, symbols, and references', async () => {
    const user = userEvent.setup();
    render(<Workspaces />);

    await user.click(screen.getByRole('button', { name: /expand workspace controls/i }));

    expect(await screen.findByText('repo')).toBeInTheDocument();
    expect(await screen.findByText('src')).toBeInTheDocument();
    expect(await screen.findByText('README.md')).toBeInTheDocument();

    await user.click(screen.getByText('src'));
    await user.click(screen.getByText('app.ts'));

    await waitFor(() => {
      expect(screen.getByText('src/app.ts')).toBeInTheDocument();
      expect(screen.getByTestId('workspace-file-content-text')).toHaveTextContent('export const app = true;');
    });

    expect(screen.getAllByText('openWorkspace').length).toBeGreaterThan(0);
    await user.click(screen.getAllByText('openWorkspace')[0]);

    await waitFor(() => {
      expect(screen.getByText('openWorkspace', { selector: '.text-monokai-aqua.font-semibold' })).toBeInTheDocument();
    });

    expect(screen.getByText('References')).toBeInTheDocument();
    expect(screen.getByText('openWorkspace();')).toBeInTheDocument();

    await user.click(screen.getByText('openWorkspace();'));
  });

  it('keeps the active file per workspace when switching workspaces', async () => {
    const user = userEvent.setup();
    render(<Workspaces />);

    await user.click(screen.getByRole('button', { name: /expand workspace controls/i }));
    await user.click(await screen.findByText('repo'));
    await user.click(screen.getByText('src'));
    await user.click(screen.getByText('app.ts'));

    await waitFor(() => {
      expect(screen.getByTestId('workspace-file-content-text')).toHaveTextContent('export const app = true;');
    });

    await user.click(screen.getByText('repo-2'));

    await waitFor(() => {
      expect(screen.queryByTestId('workspace-file-content-text')).not.toBeInTheDocument();
    });

    await user.click(screen.getByText('repo'));

    await waitFor(() => {
      expect(screen.getByTestId('workspace-file-content-text')).toHaveTextContent('export const app = true;');
    });
  });
});
