import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import type { ViewUpdate } from '@codemirror/view';
import { ChevronDown, ChevronRight, FileCode2, FolderOpen, Loader2, RefreshCw, RotateCcw, Save, Search } from 'lucide-react';
import { workspaceApi, type WorkspaceRecord } from '../api/workspaces';
import { buildWorkspaceTree, flattenTreePaths, type WorkspaceFileRecord, type WorkspaceTreeNode } from '../lib/workspaceTree';
import { bestDefinitionCandidateFromMatches } from '../lib/workspaceSymbols';
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
import {
  clearWorkspaceDraftForFile,
  draftContentForWorkspaceFile,
  readWorkspaceDraftState,
  setWorkspaceDraftForFile,
  writeWorkspaceDraftState,
  type WorkspaceDraftState,
} from '../lib/workspaceDraftState';
import {
  readWorkspaceSymbolSelectionState,
  selectedSymbolForWorkspace,
  setSelectedSymbolForWorkspace,
  writeWorkspaceSymbolSelectionState,
  type WorkspaceSymbolSelectionState,
} from '../lib/workspaceSymbolState';
import {
  readWorkspaceSelectionSnapshotState,
  setSelectionSnapshotForWorkspace,
  writeWorkspaceSelectionSnapshotState,
  type WorkspaceEditorSelectionSnapshotState,
} from '../lib/workspaceSelectionState';
import { clsx } from 'clsx';
import {
  editorLanguageExtension,
  workspaceAutocompleteExtension,
  workspaceEditorTheme,
  workspaceHoverExtension,
} from '../lib/workspaceEditorExtensions';
import { buildEditorActionPrompt } from '../lib/chatComposerWorkspace';

const EMPTY_FILES: WorkspaceFileRecord[] = [];
const WORKSPACE_STUDIO_SIDEBAR_WIDTH_KEY = 'stepbit_workspace_studio_sidebar_width';

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
      if (children.length > 0 || node.path.toLowerCase().includes(lower) || node.name.toLowerCase().includes(lower)) {
        return { ...node, children };
      }

      return null;
    })
    .filter(Boolean) as WorkspaceTreeNode[];
}

function WorkspaceTreeBranch({
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
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] text-gruv-light-3 hover:bg-gruv-dark-3/60 rounded-sm"
              >
                {isExpanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                <FolderOpen className="w-3.5 h-3.5 shrink-0 text-gruv-light-4" />
                <span className="truncate">{node.name}</span>
              </button>
              {isExpanded && (
                <div className="ml-3 border-l border-gruv-dark-4/40 pl-1">
                  <WorkspaceTreeBranch
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
              'flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] rounded-sm transition-colors',
              selectedFilePath === node.path
                ? 'bg-monokai-aqua/10 text-monokai-aqua'
                : 'text-gruv-light-3 hover:bg-gruv-dark-3/60'
            )}
          >
            <FileCode2 className="w-3.5 h-3.5 shrink-0 text-gruv-light-4" />
            <span className="truncate">{node.name}</span>
          </button>
        );
      })}
    </>
  );
}

export function WorkspaceStudio({
  workspace,
  onInjectPrompt,
  hideTree = false,
}: {
  workspace: WorkspaceRecord | null;
  onInjectPrompt?: (prompt: string) => void;
  hideTree?: boolean;
}) {
  const queryClient = useQueryClient();
  const codeMirrorRef = useRef<ReactCodeMirrorRef | null>(null);
  const studioRef = useRef<HTMLDivElement | null>(null);
  const editorPaneRef = useRef<HTMLDivElement | null>(null);
  const [treeSearch, setTreeSearch] = useState('');
  const [symbolsMenuOpen, setSymbolsMenuOpen] = useState(false);
  const [referencesMenuOpen, setReferencesMenuOpen] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [selectionBubble, setSelectionBubble] = useState<{ top: number; left: number } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(WORKSPACE_STUDIO_SIDEBAR_WIDTH_KEY));
      return Number.isFinite(saved) && saved >= 180 ? saved : 224;
    } catch {
      return 224;
    }
  });
  const [expandedState, setExpandedState] = useState<WorkspaceTreeExpandedState>(() => readWorkspaceTreeExpandedState(localStorage));
  const [selectedFileByWorkspace, setSelectedFileByWorkspace] = useState<WorkspaceEditorSelectionState>(() => readWorkspaceEditorSelectionState(localStorage));
  const [draftState, setDraftState] = useState<WorkspaceDraftState>(() => readWorkspaceDraftState(localStorage));
  const [selectedSymbolState, setSelectedSymbolState] = useState<WorkspaceSymbolSelectionState>(() => readWorkspaceSymbolSelectionState(localStorage));
  const [selectionSnapshotState, setSelectionSnapshotState] = useState<WorkspaceEditorSelectionSnapshotState>(() => readWorkspaceSelectionSnapshotState(localStorage));
  const workspaceId = workspace?.id || null;

  useEffect(() => {
    writeWorkspaceTreeExpandedState(localStorage, expandedState);
  }, [expandedState]);

  useEffect(() => {
    writeWorkspaceEditorSelectionState(localStorage, selectedFileByWorkspace);
  }, [selectedFileByWorkspace]);

  useEffect(() => {
    writeWorkspaceDraftState(localStorage, draftState);
  }, [draftState]);

  useEffect(() => {
    writeWorkspaceSymbolSelectionState(localStorage, selectedSymbolState);
  }, [selectedSymbolState]);

  useEffect(() => {
    writeWorkspaceSelectionSnapshotState(localStorage, selectionSnapshotState);
  }, [selectionSnapshotState]);

  useEffect(() => {
    localStorage.setItem(WORKSPACE_STUDIO_SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  const { data: files = EMPTY_FILES, isLoading: filesLoading } = useQuery({
    queryKey: ['workspace-files', workspaceId],
    queryFn: () => workspaceApi.listWorkspaceFiles(workspaceId!),
    enabled: Boolean(workspaceId),
    staleTime: 5_000,
  });

  const { data: indexState } = useQuery({
    queryKey: ['workspace-index-state', workspaceId],
    queryFn: () => workspaceApi.getWorkspaceIndexState(workspaceId!),
    enabled: Boolean(workspaceId),
    refetchInterval: import.meta.env.MODE === 'test' ? false : 15_000,
  });

  const tree = useMemo(() => buildWorkspaceTree(files), [files]);
  const selectedFilePath = useMemo(
    () => selectedFilePathForWorkspace(selectedFileByWorkspace, workspaceId),
    [selectedFileByWorkspace, workspaceId],
  );
  const expandedPaths = useMemo(
    () => expandedPathsForWorkspace(expandedState, workspaceId),
    [expandedState, workspaceId],
  );
  const visibleTree = useMemo(
    () => filterTree(tree.children, treeSearch.trim()),
    [tree.children, treeSearch],
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
      const seed = flattenTreePaths(tree).slice(0, 6).map((path) => path.split('/').slice(0, -1).join('/')).filter(Boolean);
      setExpandedState((current) => setWorkspaceTreeExpandedPaths(current, workspaceId, seed));
    }
  }, [workspaceId, files, selectedFilePath, expandedState, tree]);

  const { data: selectedFileContent, isLoading: fileLoading } = useQuery({
    queryKey: ['workspace-file-content', workspaceId, selectedFilePath],
    queryFn: () => workspaceApi.getWorkspaceFileContent(workspaceId!, selectedFilePath || ''),
    enabled: Boolean(workspaceId && selectedFilePath),
    staleTime: 5_000,
  });

  const selectedDraft = useMemo(
    () => draftContentForWorkspaceFile(draftState, workspaceId, selectedFilePath),
    [draftState, workspaceId, selectedFilePath],
  );
  const editorValue = selectedDraft ?? selectedFileContent?.content ?? '';
  const hasDraft = selectedDraft !== null && selectedDraft !== (selectedFileContent?.content ?? '');
  const selectedSymbol = useMemo(
    () => selectedSymbolForWorkspace(selectedSymbolState, workspaceId),
    [selectedSymbolState, workspaceId],
  );
  const { data: fileSymbolMatches = [] } = useQuery({
    queryKey: ['workspace-symbols-file', workspaceId, selectedFilePath],
    queryFn: () => workspaceApi.searchWorkspaceSymbols(workspaceId!, selectedFilePath || ''),
    enabled: Boolean(workspaceId && selectedFilePath),
    staleTime: 5_000,
  });
  const fileSymbols = useMemo(
    () => fileSymbolMatches.filter((symbol) => symbol.path === selectedFilePath),
    [fileSymbolMatches, selectedFilePath],
  );
  const { data: definitionMatches = [] } = useQuery({
    queryKey: ['workspace-definitions', workspaceId, selectedSymbol?.name],
    queryFn: () => workspaceApi.searchWorkspaceDefinitions(workspaceId!, selectedSymbol?.name || ''),
    enabled: Boolean(workspaceId && selectedSymbol?.name),
    staleTime: 5_000,
  });
  const selectedDefinition = useMemo(
    () => bestDefinitionCandidateFromMatches(selectedSymbol as any, definitionMatches),
    [definitionMatches, selectedSymbol],
  );
  const editorExtensions = useMemo(
    () => [
      ...editorLanguageExtension(selectedFilePath),
      workspaceAutocompleteExtension(files.map((file) => file.path), fileSymbols, selectedFilePath),
      workspaceHoverExtension(fileSymbols, selectedFilePath),
      workspaceEditorTheme,
    ],
    [files, selectedFilePath, fileSymbols],
  );
  const activeReferenceQuery = selectedSymbol?.name || '';
  const { data: workspaceReferences = [] } = useQuery({
    queryKey: ['workspace-references', workspaceId, activeReferenceQuery],
    queryFn: () => workspaceApi.searchWorkspaceReferences(workspaceId!, activeReferenceQuery),
    enabled: Boolean(workspaceId && activeReferenceQuery),
    staleTime: 5_000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !selectedFilePath) {
        throw new Error('No file selected');
      }

      return workspaceApi.saveWorkspaceFileContent(workspaceId, {
        path: selectedFilePath,
        content: editorValue,
      });
    },
    onSuccess: (response) => {
      if (!workspaceId || !selectedFilePath) {
        return;
      }

      setDraftState((current) => clearWorkspaceDraftForFile(current, workspaceId, selectedFilePath));
      queryClient.setQueryData(['workspace-file-content', workspaceId, selectedFilePath], response);
      queryClient.invalidateQueries({ queryKey: ['workspace-files', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-symbols', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-index-state', workspaceId] });
    },
  });

  const reindexMutation = useMutation({
    mutationFn: async () => workspaceApi.indexWorkspace(workspaceId!),
    onSuccess: () => {
      if (!workspaceId) return;
      queryClient.invalidateQueries({ queryKey: ['workspace-files', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-symbols', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-index-state', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-file-content', workspaceId] });
    },
  });

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    const selected = selectedSymbolState[workspaceId];
    if (!selected?.startLine || !selectedFileContent || selected.path !== selectedFilePath) {
      return;
    }

    const view = codeMirrorRef.current?.view;
    if (!view) {
      return;
    }

    const lineNumber = Math.max(1, Math.min(selected.startLine, view.state.doc.lines));
    const line = view.state.doc.line(lineNumber);
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
  }, [selectedSymbolState, workspaceId, selectedFileContent, selectedFilePath]);

  const openPathInEditor = (path: string) => {
    if (!workspaceId) return;
    setSelectedFileByWorkspace((current) =>
      setSelectedFilePathForWorkspace(current, workspaceId, path),
    );
  };

  const primaryEditorTarget = selectedText.trim() || selectedSymbol?.name || selectedFilePath || '';

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 text-sm text-gruv-light-4">
        Select a workspace from the header to open code here.
      </div>
    );
  }

  return (
    <div ref={studioRef} className="flex h-full min-h-0 gap-2">
      {!hideTree && (
        <>
          <aside
            className="flex shrink-0 flex-col overflow-hidden rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20"
            style={{ width: `${sidebarWidth}px` }}
          >
        <div className="flex items-center justify-between gap-2 border-b border-gruv-dark-4/20 px-2 py-1.5">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-medium text-gruv-light-2">{workspace.name}</div>
            <div className="text-[10px] text-gruv-light-4">{indexState?.indexed_file_count || files.length} files</div>
          </div>
          <button
            type="button"
            onClick={() => reindexMutation.mutate()}
            disabled={reindexMutation.isPending}
            className="inline-flex items-center justify-center rounded-sm border border-gruv-dark-4/40 p-1 text-gruv-light-4 hover:bg-gruv-dark-3/60 disabled:opacity-50"
          >
            {reindexMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        </div>
        <div className="border-b border-gruv-dark-4/20 px-2 py-1.5">
          <div className="flex items-center gap-1.5 rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-3/30 px-2 py-1">
            <Search className="w-3 h-3 text-gruv-light-4" />
            <input
              value={treeSearch}
              onChange={(event) => setTreeSearch(event.target.value)}
              placeholder="Filter files"
              className="w-full bg-transparent text-[11px] text-gruv-light-2 outline-none placeholder:text-gruv-light-4"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          {filesLoading ? (
            <div className="flex items-center justify-center py-8 text-gruv-light-4">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : (
            <WorkspaceTreeBranch
              nodes={visibleTree}
              expandedPaths={expandedPaths}
              selectedFilePath={selectedFilePath}
              onToggleFolder={(path) => {
                if (!workspaceId) return;
                setExpandedState((current) => {
                  const currentPaths = expandedPathsForWorkspace(current, workspaceId);
                  return setWorkspaceTreeExpandedPaths(current, workspaceId, toggleTreePath(currentPaths, path));
                });
              }}
              onOpenFile={(path) => {
                if (!workspaceId) return;
                setSelectedFileByWorkspace((current) =>
                  setSelectedFilePathForWorkspace(current, workspaceId, path),
                );
              }}
            />
          )}
        </div>
          </aside>

          <button
            type="button"
            aria-label="Resize workspace tree"
            className="group flex w-2 shrink-0 cursor-col-resize items-stretch justify-center"
            onMouseDown={(event) => {
              event.preventDefault();
              const startX = event.clientX;
              const startWidth = sidebarWidth;

              const onMove = (moveEvent: MouseEvent) => {
                const rootWidth = studioRef.current?.clientWidth || 0;
                const nextWidth = Math.max(180, Math.min(360, startWidth + (moveEvent.clientX - startX)));
                const maxAllowed = Math.max(220, rootWidth - 360);
                setSidebarWidth(Math.min(nextWidth, maxAllowed));
              };

              const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };

              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
          >
            <span className="w-px bg-gruv-dark-4/30 transition-colors group-hover:bg-monokai-aqua/40" />
          </button>
        </>
      )}

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20">
        <div className="flex items-center justify-between gap-3 border-b border-gruv-dark-4/20 px-3 py-1.5">
          <div className="min-w-0">
            <div className="truncate text-[12px] font-medium text-gruv-light-1">
              {selectedFilePath || 'No file selected'}
            </div>
            <div className="text-[10px] text-gruv-light-4">
              {selectedFileContent
                ? `${selectedFileContent.language || 'text'} • ${selectedFileContent.lineCount} lines`
                : 'Open a file from the workspace tree'}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {primaryEditorTarget && onInjectPrompt && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    onInjectPrompt(
                      buildEditorActionPrompt({
                        action: 'explain',
                        filePath: selectedFilePath,
                        symbolName: selectedSymbol?.name,
                        selectedText,
                      }),
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-sm border border-gruv-dark-4/40 px-2 py-1 text-[10px] text-gruv-light-4 hover:bg-gruv-dark-3/60"
                >
                  Ask chat
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onInjectPrompt(
                      buildEditorActionPrompt({
                        action: 'refs',
                        filePath: selectedFilePath,
                        symbolName: selectedSymbol?.name,
                        selectedText,
                      }),
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-sm border border-gruv-dark-4/40 px-2 py-1 text-[10px] text-gruv-light-4 hover:bg-gruv-dark-3/60"
                >
                  Refs
                </button>
              </>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setSymbolsMenuOpen((current) => !current)}
                className="inline-flex items-center gap-1 rounded-sm border border-gruv-dark-4/40 px-2 py-1 text-[10px] text-gruv-light-4 hover:bg-gruv-dark-3/60"
              >
                Symbols
                {fileSymbols.length > 0 && (
                  <span className="text-gruv-light-4">{fileSymbols.length}</span>
                )}
                <ChevronDown className={clsx('w-3 h-3 transition-transform', symbolsMenuOpen && 'rotate-180')} />
              </button>
              {symbolsMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSymbolsMenuOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-72 max-h-80 overflow-y-auto rounded-sm border border-gruv-dark-4 bg-gruv-dark-2 shadow-xl p-1.5">
                    {fileSymbols.length === 0 ? (
                      <div className="rounded-sm border border-dashed border-gruv-dark-4/30 px-2 py-3 text-[11px] text-gruv-light-4">
                        No indexed symbols for this file.
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {fileSymbols.map((symbol) => {
                          const activeSymbol = workspaceId ? selectedSymbolState[workspaceId] : null;
                          const isActive = activeSymbol?.id === symbol.id;
                          return (
                            <button
                              key={symbol.id}
                              type="button"
                              onClick={() => {
                                if (!workspaceId) return;
                                setSelectedSymbolState((current) =>
                                  setSelectedSymbolForWorkspace(current, workspaceId, {
                                    id: symbol.id,
                                    name: symbol.name,
                                    path: symbol.path,
                                    kind: symbol.kind,
                                    startLine: symbol.startLine,
                                  }),
                                );
                                setSymbolsMenuOpen(false);
                              }}
                              className={clsx(
                                'w-full rounded-sm border px-2 py-1.5 text-left transition-colors',
                                isActive
                                  ? 'border-monokai-aqua/30 bg-monokai-aqua/10 text-monokai-aqua'
                                  : 'border-gruv-dark-4/20 bg-gruv-dark-3/20 text-gruv-light-3 hover:bg-gruv-dark-3/50'
                              )}
                            >
                              <div className="truncate text-[11px] font-medium">{symbol.name}</div>
                              <div className="text-[10px] text-gruv-light-4">
                                {symbol.kind} • L{symbol.startLine}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setReferencesMenuOpen((current) => !current)}
                className="inline-flex items-center gap-1 rounded-sm border border-gruv-dark-4/40 px-2 py-1 text-[10px] text-gruv-light-4 hover:bg-gruv-dark-3/60"
              >
                Refs
                {selectedSymbol?.name ? <span className="text-gruv-light-4">{workspaceReferences.length}</span> : null}
                <ChevronDown className={clsx('w-3 h-3 transition-transform', referencesMenuOpen && 'rotate-180')} />
              </button>
              {referencesMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setReferencesMenuOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-80 max-h-80 overflow-y-auto rounded-sm border border-gruv-dark-4 bg-gruv-dark-2 shadow-xl p-1.5">
                    {!selectedSymbol?.name ? (
                      <div className="rounded-sm border border-dashed border-gruv-dark-4/30 px-2 py-3 text-[11px] text-gruv-light-4">
                        Select a symbol to inspect references.
                      </div>
                    ) : workspaceReferences.length === 0 ? (
                      <div className="rounded-sm border border-dashed border-gruv-dark-4/30 px-2 py-3 text-[11px] text-gruv-light-4">
                        No references found.
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {workspaceReferences.slice(0, 24).map((reference) => (
                          <button
                            key={reference.id}
                            type="button"
                            onClick={() => {
                              openPathInEditor(reference.path);
                              setReferencesMenuOpen(false);
                            }}
                            className="w-full rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-2 py-1.5 text-left text-gruv-light-3 hover:bg-gruv-dark-3/50"
                          >
                            <div className="truncate text-[11px] font-medium">{reference.path}</div>
                            <div className="text-[10px] text-gruv-light-4">L{reference.startLine} • {reference.matchedText}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            {selectedDefinition && selectedDefinition.path !== selectedFilePath && (
              <button
                type="button"
                onClick={() => openPathInEditor(selectedDefinition.path)}
                className="inline-flex items-center gap-1 rounded-sm border border-gruv-dark-4/40 px-2 py-1 text-[10px] text-gruv-light-4 hover:bg-gruv-dark-3/60"
              >
                Definition
              </button>
            )}
            {hasDraft && (
              <button
                type="button"
                onClick={() => {
                  if (!workspaceId || !selectedFilePath) return;
                  setDraftState((current) => clearWorkspaceDraftForFile(current, workspaceId, selectedFilePath));
                }}
                className="inline-flex items-center gap-1 rounded-sm border border-gruv-dark-4/40 px-2 py-1 text-[10px] text-gruv-light-4 hover:bg-gruv-dark-3/60"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={!hasDraft || saveMutation.isPending}
              className="inline-flex items-center gap-1 rounded-sm border border-monokai-aqua/20 bg-monokai-aqua/10 px-2 py-1 text-[10px] text-monokai-aqua disabled:opacity-40"
            >
              {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div ref={editorPaneRef} className="relative min-w-0 flex-1 overflow-hidden">
            {selectionBubble && selectedText.trim() && onInjectPrompt && (
              <div
                className="absolute z-30 flex items-center gap-1 rounded-sm border border-gruv-dark-4/40 bg-gruv-dark-2/95 px-1.5 py-1 shadow-lg backdrop-blur"
                style={{ top: selectionBubble.top, left: selectionBubble.left }}
              >
                <button
                  type="button"
                  onClick={() =>
                    onInjectPrompt(
                      buildEditorActionPrompt({
                        action: 'explain',
                        filePath: selectedFilePath,
                        symbolName: selectedSymbol?.name,
                        selectedText,
                      }),
                    )
                  }
                  className="rounded-sm px-1.5 py-0.5 text-[10px] text-gruv-light-3 hover:bg-gruv-dark-3/60"
                >
                  Ask
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onInjectPrompt(
                      buildEditorActionPrompt({
                        action: 'refs',
                        filePath: selectedFilePath,
                        symbolName: selectedSymbol?.name,
                        selectedText,
                      }),
                    )
                  }
                  className="rounded-sm px-1.5 py-0.5 text-[10px] text-gruv-light-3 hover:bg-gruv-dark-3/60"
                >
                  Refs
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onInjectPrompt(
                      buildEditorActionPrompt({
                        action: 'definition',
                        filePath: selectedFilePath,
                        symbolName: selectedSymbol?.name,
                        selectedText,
                      }),
                    )
                  }
                  className="rounded-sm px-1.5 py-0.5 text-[10px] text-gruv-light-3 hover:bg-gruv-dark-3/60"
                >
                  Def
                </button>
              </div>
            )}
            {fileLoading ? (
              <div className="flex h-full items-center justify-center text-gruv-light-4">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : (
              <CodeMirror
                ref={codeMirrorRef}
                value={editorValue}
                theme={oneDark}
                extensions={editorExtensions}
                basicSetup={{
                  lineNumbers: true,
                  autocompletion: true,
                  foldGutter: false,
                  highlightActiveLine: true,
                }}
                onChange={(value) => {
                  if (!workspaceId || !selectedFilePath) return;
                  setDraftState((current) =>
                    setWorkspaceDraftForFile(current, workspaceId, selectedFilePath, value),
                  );
                }}
                onUpdate={(update: ViewUpdate) => {
                  if (!update.selectionSet) {
                    return;
                  }
                  const selection = update.state.selection.main;
                  const text = selection.empty ? '' : update.state.sliceDoc(selection.from, selection.to);
                  setSelectedText(text.slice(0, 1200));
                  if (workspaceId && selectedFilePath) {
                    setSelectionSnapshotState((current) =>
                      setSelectionSnapshotForWorkspace(
                        current,
                        workspaceId,
                        text.trim()
                          ? {
                              path: selectedFilePath,
                              text: text.slice(0, 1200),
                              from: selection.from,
                              to: selection.to,
                            }
                          : null,
                      ),
                    );
                  }

                  const editorElement = editorPaneRef.current;
                  const view = codeMirrorRef.current?.view;
                  if (!editorElement || !view || selection.empty) {
                    setSelectionBubble(null);
                    return;
                  }

                  const start = view.coordsAtPos(selection.from);
                  const end = view.coordsAtPos(selection.to);
                  const containerRect = editorElement.getBoundingClientRect();
                  if (!start || !end) {
                    setSelectionBubble(null);
                    return;
                  }

                  const left = Math.max(8, Math.min(((start.left + end.right) / 2) - containerRect.left - 80, containerRect.width - 180));
                  const top = Math.max(8, start.top - containerRect.top - 38);
                  setSelectionBubble({ top, left });
                }}
                className="h-full text-[11px]"
                height="100%"
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
