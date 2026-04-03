import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileCode2, FolderOpen, Search } from 'lucide-react';
import { workspaceApi, type WorkspaceRecord } from '../api/workspaces';
import { buildWorkspaceTree, flattenTreePaths, type WorkspaceTreeNode } from '../lib/workspaceTree';
import {
  expandedPathsForWorkspace,
  readWorkspaceTreeExpandedState,
  setWorkspaceTreeExpandedPaths,
  toggleTreePath,
  writeWorkspaceTreeExpandedState,
  type WorkspaceTreeExpandedState,
} from '../lib/workspaceTreeState';
import {
  readWorkspaceEditorSelectionState,
  selectedFilePathForWorkspace,
  setSelectedFilePathForWorkspace,
  writeWorkspaceEditorSelectionState,
  type WorkspaceEditorSelectionState,
} from '../lib/workspaceEditorState';
import { clsx } from 'clsx';

const EMPTY_FILES: any[] = [];

function filterTree(nodes: WorkspaceTreeNode[], query: string): WorkspaceTreeNode[] {
  if (!query) {
    return nodes;
  }

  const lower = query.toLowerCase();
  return nodes
    .map((node) => {
      if (node.kind === 'file') {
        return node.path.toLowerCase().includes(lower) ? node : null;
      }

      const children = filterTree(node.children, query);
      if (children.length > 0 || node.name.toLowerCase().includes(lower) || node.path.toLowerCase().includes(lower)) {
        return { ...node, children };
      }

      return null;
    })
    .filter(Boolean) as WorkspaceTreeNode[];
}

function TreeBranch({
  nodes,
  expandedPaths,
  selectedFilePath,
  onToggleFolder,
  onOpenFile,
}: {
  nodes: WorkspaceTreeNode[];
  expandedPaths: string[];
  selectedFilePath: string | null;
  onToggleFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === 'directory') {
          const isExpanded = expandedPaths.includes(node.path);
          return (
            <div key={node.path}>
              <button
                type="button"
                onClick={() => onToggleFolder(node.path)}
                className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-[11px] text-gruv-light-3 hover:bg-gruv-dark-3/60"
              >
                {isExpanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-gruv-light-4" />
                <span className="truncate">{node.name}</span>
              </button>
              {isExpanded && (
                <div className="ml-3 border-l border-gruv-dark-4/30 pl-1">
                  <TreeBranch
                    nodes={node.children}
                    expandedPaths={expandedPaths}
                    selectedFilePath={selectedFilePath}
                    onToggleFolder={onToggleFolder}
                    onOpenFile={onOpenFile}
                  />
                </div>
              )}
            </div>
          );
        }

        return (
          <button
            key={node.path}
            type="button"
            onClick={() => onOpenFile(node.path)}
            className={clsx(
              'flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-[11px] transition-colors',
              selectedFilePath === node.path
                ? 'bg-monokai-aqua/10 text-monokai-aqua'
                : 'text-gruv-light-3 hover:bg-gruv-dark-3/60',
            )}
          >
            <FileCode2 className="h-3.5 w-3.5 shrink-0 text-gruv-light-4" />
            <span className="truncate">{node.name}</span>
          </button>
        );
      })}
    </>
  );
}

export function ChatWorkspaceRail({
  workspace,
  onOpenFile,
}: {
  workspace: WorkspaceRecord | null;
  onOpenFile?: (path: string) => void;
}) {
  const workspaceId = workspace?.id || null;
  const [search, setSearch] = useState('');
  const [expandedState, setExpandedState] = useState<WorkspaceTreeExpandedState>(() => readWorkspaceTreeExpandedState(localStorage));
  const [selectedFileByWorkspace, setSelectedFileByWorkspace] = useState<WorkspaceEditorSelectionState>(() => readWorkspaceEditorSelectionState(localStorage));

  useEffect(() => {
    writeWorkspaceTreeExpandedState(localStorage, expandedState);
  }, [expandedState]);

  useEffect(() => {
    writeWorkspaceEditorSelectionState(localStorage, selectedFileByWorkspace);
  }, [selectedFileByWorkspace]);

  const { data: files = EMPTY_FILES, isLoading } = useQuery({
    queryKey: ['workspace-files', workspaceId],
    queryFn: () => workspaceApi.listWorkspaceFiles(workspaceId!),
    enabled: Boolean(workspaceId),
    staleTime: 5_000,
  });

  const tree = useMemo(() => buildWorkspaceTree(files), [files]);
  const expandedPaths = useMemo(
    () => expandedPathsForWorkspace(expandedState, workspaceId),
    [expandedState, workspaceId],
  );
  const selectedFilePath = useMemo(
    () => selectedFilePathForWorkspace(selectedFileByWorkspace, workspaceId),
    [selectedFileByWorkspace, workspaceId],
  );
  const visibleTree = useMemo(
    () => filterTree(tree.children, search.trim()),
    [tree.children, search],
  );

  useEffect(() => {
    if (!workspaceId || files.length === 0) {
      return;
    }

    if (!selectedFilePath) {
      setSelectedFileByWorkspace((current) =>
        setSelectedFilePathForWorkspace(current, workspaceId, files[0]?.path || null),
      );
    }

    if (!expandedState[workspaceId]) {
      const seed = flattenTreePaths(tree)
        .slice(0, 6)
        .map((path) => path.split('/').slice(0, -1).join('/'))
        .filter(Boolean);
      setExpandedState((current) => setWorkspaceTreeExpandedPaths(current, workspaceId, seed));
    }
  }, [workspaceId, files, selectedFilePath, expandedState, tree]);

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 px-3 text-[11px] text-gruv-light-4">
        Select a workspace to browse files.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/10">
      <div className="border-b border-gruv-dark-4/20 px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-[10px] font-medium uppercase tracking-[0.18em] text-gruv-light-3">
            {workspace.name}
          </div>
          <span className="shrink-0 text-[9px] font-mono text-gruv-light-4">
            {files.length}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-3/20 px-2 py-1">
          <Search className="h-3 w-3 text-gruv-light-4" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter..."
            className="w-full bg-transparent text-[11px] text-gruv-light-2 outline-none placeholder:text-gruv-light-4"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {isLoading ? (
          <div className="px-2 py-3 text-[11px] text-gruv-light-4">Loading files…</div>
        ) : (
          <TreeBranch
            nodes={visibleTree}
            expandedPaths={expandedPaths}
            selectedFilePath={selectedFilePath}
            onToggleFolder={(path) => {
              if (!workspaceId) return;
              setExpandedState((current) =>
                setWorkspaceTreeExpandedPaths(
                  current,
                  workspaceId,
                  toggleTreePath(expandedPaths, path),
                ),
              );
            }}
            onOpenFile={(path) => {
              if (!workspaceId) return;
              setSelectedFileByWorkspace((current) => {
                const nextState = setSelectedFilePathForWorkspace(current, workspaceId, path);
                writeWorkspaceEditorSelectionState(localStorage, nextState);
                return nextState;
              });
              onOpenFile?.(path);
            }}
          />
        )}
      </div>
    </div>
  );
}
