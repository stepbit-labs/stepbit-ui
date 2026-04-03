import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { FolderTree, Loader2, RefreshCw, Save, Search, ChevronRight, ChevronDown, ChevronLeft, FolderOpen, FileCode2, BadgeInfo, Trash2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { workspaceApi } from '../api/workspaces';
import { buildWorkspaceTree, findWorkspaceFileRecord, flattenTreePaths, type WorkspaceFileRecord, type WorkspaceTreeNode } from '../lib/workspaceTree';
import { bestDefinitionCandidate, indexWorkspaceSymbols, symbolsForPath } from '../lib/workspaceSymbols';
import { indexWorkspaceReferences, referencesForPath } from '../lib/workspaceReferences';
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
  readWorkspaceSymbolSelectionState,
  selectedSymbolForWorkspace,
  setSelectedSymbolForWorkspace,
  writeWorkspaceSymbolSelectionState,
  type WorkspaceSymbolSelectionState,
} from '../lib/workspaceSymbolState';
import {
  clearWorkspaceDraftForFile,
  draftContentForWorkspaceFile,
  readWorkspaceDraftState,
  setWorkspaceDraftForFile,
  writeWorkspaceDraftState,
  type WorkspaceDraftState,
} from '../lib/workspaceDraftState';
import { buildWorkspaceDraftDiff } from '../lib/workspaceDraftDiff';
import { setActiveWorkspaceId } from '../lib/workspaceContext';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: Array<string | false | null | undefined>) {
  return twMerge(clsx(inputs));
}

const EMPTY_FILES: WorkspaceFileRecord[] = [];
const WORKSPACE_CONTROLS_STORAGE_KEY = 'stepbit_workspace_controls_open';
const WORKSPACE_TREE_PANEL_STORAGE_KEY = 'stepbit_workspace_tree_panel_open';

const getWorkspaceRootPath = (workspace: { root_path?: string; rootPath?: string }): string => {
  return workspace.root_path || workspace.rootPath || '';
};

const getWorkspaceIndexStatus = (indexState: { status?: string } | undefined): string => {
  return indexState?.status || 'unknown';
};

const getWorkspaceHealthTone = (status?: string): 'ready' | 'missing' | 'exists_not_directory' | 'unknown' => {
  if (status === 'ready') return 'ready';
  if (status === 'missing') return 'missing';
  if (status === 'exists_not_directory') return 'exists_not_directory';
  return 'unknown';
};

function renderDiffLines(
  label: string,
  lines: string[],
  startLine: number,
  tone: 'live' | 'draft',
) {
  return (
    <div className="min-w-0 rounded-xl border border-gruv-dark-4 bg-gruv-dark-2/60 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gruv-dark-4">
        <span className="text-[10px] uppercase font-mono text-gruv-light-4">{label}</span>
        <span
          className={cn(
            "text-[10px] uppercase font-mono px-2 py-0.5 rounded-full border",
            tone === 'live'
              ? "bg-monokai-red/10 text-monokai-red border-monokai-red/20"
              : "bg-monokai-aqua/10 text-monokai-aqua border-monokai-aqua/20",
          )}
        >
          {lines.length} lines
        </span>
      </div>
      <pre className="max-h-[180px] overflow-auto p-3 text-[10px] leading-5 font-mono whitespace-pre-wrap break-words">
        {lines.length > 0 ? (
          lines.map((line, index) => (
            <div key={`${label}-${startLine + index}-${index}`} className="flex gap-3">
              <span className="shrink-0 text-gruv-light-4 w-8 text-right">{startLine + index}</span>
              <span className={cn("min-w-0 flex-1", tone === 'live' ? "text-monokai-red" : "text-monokai-aqua")}>
                {line || '\u00a0'}
              </span>
            </div>
          ))
        ) : (
          <span className="text-gruv-light-4">No changes in this block.</span>
        )}
      </pre>
    </div>
  );
}

function WorkspaceCard({
  workspace,
  selected,
  onSelect,
}: {
  workspace: {
    id: string;
    name: string;
    root_path?: string;
    rootPath?: string;
  };
  selected: boolean;
  onSelect: (workspaceId: string) => void;
}) {
  const { data: health } = useQuery({
    queryKey: ['workspace-health', workspace.id],
    queryFn: () => workspaceApi.getWorkspaceHealth(workspace.id),
    staleTime: 5_000,
    refetchInterval: import.meta.env.MODE === 'test' ? false : 15_000,
  });

  const tone = getWorkspaceHealthTone(health?.status);

  return (
    <button
      type="button"
      onClick={() => onSelect(workspace.id)}
      className={cn(
        "p-4 rounded-2xl border text-left transition-all",
        selected
          ? "border-monokai-aqua bg-monokai-aqua/10"
          : "border-gruv-dark-4 bg-gruv-dark-3/40 hover:border-gruv-light-4/30"
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-semibold">{workspace.name}</p>
          <p className="text-xs text-gruv-light-4 mt-1 break-all">{getWorkspaceRootPath(workspace)}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="text-[10px] uppercase font-mono px-2 py-1 rounded-full bg-gruv-dark-2 text-gruv-light-4">
            {workspace.id}
          </div>
          {health && (
            <div
              className={cn(
                "flex items-center gap-1.5 text-[10px] uppercase font-mono px-2 py-1 rounded-full border",
                tone === 'ready'
                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                  : tone === 'missing'
                    ? "bg-monokai-red/10 text-monokai-red border-monokai-red/20"
                    : tone === 'exists_not_directory'
                      ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                      : "bg-gruv-dark-2 text-gruv-light-4 border-gruv-dark-4",
              )}
            >
              {tone === 'ready' ? <ShieldCheck className="w-3 h-3" /> : tone === 'missing' ? <ShieldAlert className="w-3 h-3" /> : <ShieldQuestion className="w-3 h-3" />}
              {health.status}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

const Workspaces: React.FC = () => {
  const queryClient = useQueryClient();
  const codeMirrorRef = useRef<ReactCodeMirrorRef | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');
  const [rootPath, setRootPath] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [branch, setBranch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [symbolSearchTerm, setSymbolSearchTerm] = useState('');
  const [referenceSearchTerm, setReferenceSearchTerm] = useState('');
  const [selectedSymbolId, setSelectedSymbolId] = useState<string | null>(null);
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(null);
  const [workspaceControlsOpen, setWorkspaceControlsOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(WORKSPACE_CONTROLS_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [workspaceDeleteDialog, setWorkspaceDeleteDialog] = useState<{ id: string; name: string } | null>(null);
  const [workspaceRebindDialog, setWorkspaceRebindDialog] = useState<{ id: string; name: string; rootPath: string } | null>(null);
  const [rebindRootPath, setRebindRootPath] = useState('');
  const [workspaceTreePanelOpen, setWorkspaceTreePanelOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(WORKSPACE_TREE_PANEL_STORAGE_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [workspaceTreeExpandedState, setWorkspaceTreeExpandedState] = useState<WorkspaceTreeExpandedState>(() => readWorkspaceTreeExpandedState());
  const [selectedFileByWorkspace, setSelectedFileByWorkspace] = useState<WorkspaceEditorSelectionState>(() => readWorkspaceEditorSelectionState());
  const [selectedSymbolByWorkspace, setSelectedSymbolByWorkspace] = useState<WorkspaceSymbolSelectionState>(() => readWorkspaceSymbolSelectionState());
  const [workspaceDraftByWorkspace, setWorkspaceDraftByWorkspace] = useState<WorkspaceDraftState>(() => readWorkspaceDraftState());

  const { data: workspaces, isLoading: workspacesLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => workspaceApi.listWorkspaces(),
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!selectedWorkspaceId && workspaces?.length) {
      setSelectedWorkspaceId(workspaces[0].id);
    }
  }, [workspaces, selectedWorkspaceId]);

  useEffect(() => {
    if ((workspaces?.length || 0) === 0) {
      setWorkspaceControlsOpen(true);
    }
  }, [workspaces]);

  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_CONTROLS_STORAGE_KEY, String(workspaceControlsOpen));
    } catch {
      // Ignore storage failures in privacy-restricted browsers.
    }
  }, [workspaceControlsOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_TREE_PANEL_STORAGE_KEY, String(workspaceTreePanelOpen));
    } catch {
      // Ignore storage failures in privacy-restricted browsers.
    }
  }, [workspaceTreePanelOpen]);

  useEffect(() => {
    const storage = localStorage;
    try {
      writeWorkspaceEditorSelectionState(storage, selectedFileByWorkspace);
    } catch {
      // Ignore storage failures in privacy-restricted browsers.
    }
  }, [selectedFileByWorkspace]);

  useEffect(() => {
    const storage = localStorage;
    try {
      writeWorkspaceSymbolSelectionState(storage, selectedSymbolByWorkspace);
    } catch {
      // Ignore storage failures in privacy-restricted browsers.
    }
  }, [selectedSymbolByWorkspace]);

  useEffect(() => {
    const storage = localStorage;
    try {
      writeWorkspaceDraftState(storage, workspaceDraftByWorkspace);
    } catch {
      // Ignore storage failures in privacy-restricted browsers.
    }
  }, [workspaceDraftByWorkspace]);

  const selectedWorkspace = workspaces?.find((workspace) => workspace.id === selectedWorkspaceId);

  const { data: workspaceFiles, isLoading: filesLoading } = useQuery({
    queryKey: ['workspace-files', selectedWorkspaceId],
    queryFn: () => workspaceApi.listWorkspaceFiles(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId),
    staleTime: 5_000,
  });
  const files = workspaceFiles ?? EMPTY_FILES;

  const { data: indexState } = useQuery({
    queryKey: ['workspace-index-state', selectedWorkspaceId],
    queryFn: () => workspaceApi.getWorkspaceIndexState(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId),
    refetchInterval: import.meta.env.MODE === 'test' ? false : 15_000,
  });

  const { data: selectedWorkspaceHealth } = useQuery({
    queryKey: ['workspace-health', selectedWorkspaceId],
    queryFn: () => workspaceApi.getWorkspaceHealth(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId),
    refetchInterval: import.meta.env.MODE === 'test' ? false : 15_000,
  });

  const selectedWorkspaceHealthTone =
    selectedWorkspaceHealth?.status === 'ready'
      ? 'ready'
      : selectedWorkspaceHealth?.status === 'missing'
        ? 'missing'
        : selectedWorkspaceHealth?.status === 'exists_not_directory'
          ? 'exists_not_directory'
          : 'unknown';

  const registerMutation = useMutation({
    mutationFn: () => workspaceApi.registerWorkspace({
      root_path: rootPath.trim(),
      name: workspaceName.trim() || undefined,
      vcs_branch: branch.trim() || undefined,
    }),
    onSuccess: (workspace) => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setSelectedWorkspaceId(workspace.id);
      setActiveWorkspaceId(workspace.id);
      setRootPath('');
      setWorkspaceName('');
      setBranch('');
      indexMutation.mutate(workspace.id);
    },
  });

  const indexMutation = useMutation({
    mutationFn: (workspaceId: string) => workspaceApi.indexWorkspace(workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-files', selectedWorkspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-index-state', selectedWorkspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedWorkspaceId || !selectedFilePath) {
        throw new Error('No file selected');
      }

      return workspaceApi.saveWorkspaceFileContent(selectedWorkspaceId, {
        path: selectedFilePath,
        content: selectedFileEditorValue,
      });
    },
    onSuccess: (response) => {
      if (!selectedWorkspaceId || !selectedFilePath) {
        return;
      }

      setWorkspaceDraftByWorkspace((current) =>
        clearWorkspaceDraftForFile(current, selectedWorkspaceId, selectedFilePath),
      );

      queryClient.setQueryData(['workspace-file-content', selectedWorkspaceId, selectedFilePath], response);
      queryClient.invalidateQueries({ queryKey: ['workspace-symbols', selectedWorkspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-index-state', selectedWorkspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      indexMutation.mutate(selectedWorkspaceId);
    },
  });

  const rebindMutation = useMutation({
    mutationFn: async (payload: { workspaceId: string; rootPath: string }) => {
      return workspaceApi.rebindWorkspace(payload.workspaceId, { root_path: payload.rootPath });
    },
    onSuccess: (workspace, variables) => {
      setWorkspaceRebindDialog(null);
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-files', variables.workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-index-state', variables.workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-symbols', variables.workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-health', variables.workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-file-content', variables.workspaceId] });
      setSelectedWorkspaceId(workspace.id);
      setActiveWorkspaceId(workspace.id);
      indexMutation.mutate(workspace.id);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (workspaceId: string) => workspaceApi.deleteWorkspace(workspaceId),
    onSuccess: (_data, workspaceId) => {
      setWorkspaceDeleteDialog(null);
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-files', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-index-state', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-symbols', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-health', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-file-content', workspaceId] });
      setSelectedFileByWorkspace((current) => {
        const nextState = { ...current };
        delete nextState[workspaceId];
        writeWorkspaceEditorSelectionState(localStorage, nextState);
        return nextState;
      });
      setSelectedSymbolByWorkspace((current) => {
        const nextState = { ...current };
        delete nextState[workspaceId];
        writeWorkspaceSymbolSelectionState(localStorage, nextState);
        return nextState;
      });
      setWorkspaceDraftByWorkspace((current) => {
        const nextState = { ...current };
        delete nextState[workspaceId];
        writeWorkspaceDraftState(localStorage, nextState);
        return nextState;
      });
      setWorkspaceTreeExpandedState((current) => {
        const nextState = { ...current };
        delete nextState[workspaceId];
        writeWorkspaceTreeExpandedState(localStorage, nextState);
        return nextState;
      });
      setSelectedReferenceId(null);
      const remainingWorkspaces = workspaces?.filter((workspace) => workspace.id !== workspaceId) || [];
      const nextWorkspaceId = remainingWorkspaces[0]?.id || '';
      setSelectedWorkspaceId(nextWorkspaceId);
      setActiveWorkspaceId(nextWorkspaceId || null);
      setSelectedSymbolId(null);
    },
  });

  const tree = useMemo(() => buildWorkspaceTree(files), [files]);
  const visibleTree = useMemo(() => filterTreeByPath(tree, searchTerm.trim().toLowerCase()), [tree, searchTerm]);
  const expandedPaths = useMemo(
    () => expandedPathsForWorkspace(workspaceTreeExpandedState, selectedWorkspaceId),
    [workspaceTreeExpandedState, selectedWorkspaceId],
  );
  const selectedFilePath = useMemo(
    () => selectedFilePathForWorkspace(selectedFileByWorkspace, selectedWorkspaceId),
    [selectedFileByWorkspace, selectedWorkspaceId],
  );
  const selectedWorkspaceSelection = useMemo(
    () => selectedSymbolForWorkspace(selectedSymbolByWorkspace, selectedWorkspaceId),
    [selectedSymbolByWorkspace, selectedWorkspaceId],
  );
  const selectedFileRecord = useMemo(
    () => (selectedFilePath ? findWorkspaceFileRecord(tree, selectedFilePath) : null),
    [tree, selectedFilePath],
  );
  const selectedFileDraft = useMemo(
    () => draftContentForWorkspaceFile(workspaceDraftByWorkspace, selectedWorkspaceId, selectedFilePath),
    [workspaceDraftByWorkspace, selectedWorkspaceId, selectedFilePath],
  );
  const { data: selectedFileContent, isLoading: selectedFileLoading } = useQuery({
    queryKey: ['workspace-file-content', selectedWorkspaceId, selectedFilePath],
    queryFn: () => workspaceApi.getWorkspaceFileContent(selectedWorkspaceId, selectedFilePath || ''),
    enabled: Boolean(selectedWorkspaceId && selectedFilePath),
    staleTime: 5_000,
  });
  const selectedFileEditorValue = selectedFileDraft ?? selectedFileContent?.content ?? '';
  const selectedFileDraftDiff = useMemo(
    () => buildWorkspaceDraftDiff(selectedFileContent?.content ?? '', selectedFileEditorValue),
    [selectedFileContent, selectedFileEditorValue],
  );
  const deferredSymbolSearchTerm = useDeferredValue(symbolSearchTerm.trim());
  const { data: workspaceSymbols, isLoading: symbolsLoading } = useQuery({
    queryKey: ['workspace-symbols', selectedWorkspaceId, deferredSymbolSearchTerm],
    queryFn: () => {
      const term = deferredSymbolSearchTerm;
      return term
        ? workspaceApi.searchWorkspaceSymbols(selectedWorkspaceId, term)
        : workspaceApi.listWorkspaceSymbols(selectedWorkspaceId);
    },
    enabled: Boolean(selectedWorkspaceId),
    staleTime: 5_000,
  });
  const indexedSymbols = useMemo(() => indexWorkspaceSymbols(workspaceSymbols ?? []), [workspaceSymbols]);
  const selectedSymbol = useMemo(
    () => workspaceSymbols?.find((symbol) => symbol.id === selectedSymbolId) || null,
    [workspaceSymbols, selectedSymbolId],
  );
  const selectedSymbolDefinition = useMemo(
    () => bestDefinitionCandidate(indexedSymbols, selectedSymbol),
    [indexedSymbols, selectedSymbol],
  );
  const deferredReferenceSearchTerm = useDeferredValue(referenceSearchTerm.trim());
  const activeReferenceQuery = deferredReferenceSearchTerm || selectedSymbol?.name || '';
  const { data: workspaceReferences, isLoading: referencesLoading } = useQuery({
    queryKey: ['workspace-references', selectedWorkspaceId, activeReferenceQuery],
    queryFn: () => workspaceApi.searchWorkspaceReferences(selectedWorkspaceId, activeReferenceQuery),
    enabled: Boolean(selectedWorkspaceId && activeReferenceQuery),
    staleTime: 5_000,
  });
  const indexedReferences = useMemo(
    () => indexWorkspaceReferences(workspaceReferences ?? []),
    [workspaceReferences],
  );
  const selectedFileSymbols = useMemo(() => {
    return symbolsForPath(indexedSymbols, selectedFilePath);
  }, [indexedSymbols, selectedFilePath]);
  const selectedFileReferences = useMemo(() => {
    return referencesForPath(indexedReferences, selectedFilePath);
  }, [indexedReferences, selectedFilePath]);
  const hasSymbolSearch = Boolean(deferredSymbolSearchTerm);
  const hasReferenceSearch = Boolean(deferredReferenceSearchTerm);
  const visibleSymbols = useMemo(
    () => (deferredSymbolSearchTerm ? (workspaceSymbols ?? []) : selectedFileSymbols),
    [deferredSymbolSearchTerm, workspaceSymbols, selectedFileSymbols],
  );
  const visibleReferences = useMemo(
    () => (hasReferenceSearch ? (workspaceReferences ?? []) : selectedFileReferences),
    [hasReferenceSearch, workspaceReferences, selectedFileReferences],
  );
  const indexedVisibleReferences = useMemo(
    () => indexWorkspaceReferences(visibleReferences),
    [visibleReferences],
  );
  const selectedReference = useMemo(
    () => workspaceReferences?.find((reference) => reference.id === selectedReferenceId) || null,
    [workspaceReferences, selectedReferenceId],
  );
  const hasUnsavedFileDraft = useMemo(
    () => Boolean(selectedFileDraft !== null && selectedFileContent && selectedFileDraft !== selectedFileContent.content),
    [selectedFileDraft, selectedFileContent],
  );

  useEffect(() => {
    if (!selectedWorkspaceId || files.length === 0) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(workspaceTreeExpandedState, selectedWorkspaceId)) {
      return;
    }

    const seedPaths = flattenTreePaths(tree).slice(0, 8);
    setWorkspaceTreeExpandedState((current) => {
      const nextState = setWorkspaceTreeExpandedPaths(current, selectedWorkspaceId, seedPaths);
      writeWorkspaceTreeExpandedState(localStorage, nextState);
      return nextState;
    });
  }, [selectedWorkspaceId, files.length, tree, workspaceTreeExpandedState]);

  useEffect(() => {
    if (selectedFilePath && !selectedFileRecord) {
      if (selectedWorkspaceId) {
        setSelectedFileByWorkspace((current) => setSelectedFilePathForWorkspace(current, selectedWorkspaceId, null));
      }
    }
  }, [selectedFilePath, selectedFileRecord, selectedWorkspaceId]);

  useEffect(() => {
    if (selectedSymbolId && !selectedSymbol) {
      setSelectedSymbolId(null);
      if (selectedWorkspaceId) {
        setSelectedSymbolByWorkspace((current) =>
          setSelectedSymbolForWorkspace(current, selectedWorkspaceId, null),
        );
      }
    }
  }, [selectedSymbolId, selectedSymbol, selectedWorkspaceId]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      return;
    }

    const nextSelectedId = selectedWorkspaceSelection?.id || null;
    if (nextSelectedId !== selectedSymbolId) {
      setSelectedSymbolId(nextSelectedId);
      setSelectedReferenceId(null);
    }
  }, [selectedWorkspaceId, selectedWorkspaceSelection?.id, selectedSymbolId]);

  useEffect(() => {
    if (selectedReferenceId && !selectedReference) {
      setSelectedReferenceId(null);
    }
  }, [selectedReferenceId, selectedReference]);

  useEffect(() => {
    if (!selectedSymbol || !selectedFileContent) {
      return;
    }

    const view = codeMirrorRef.current?.view;
    if (!view) {
      return;
    }

    const lineNumber = Math.max(1, Math.min(selectedSymbol.startLine, view.state.doc.lines));
    const line = view.state.doc.line(lineNumber);
    view.dispatch({
      selection: { anchor: line.from },
      scrollIntoView: true,
    });
    view.focus();
  }, [selectedSymbol, selectedFileContent]);

  useEffect(() => {
    if (!selectedReference || !selectedFileContent) {
      return;
    }

    const view = codeMirrorRef.current?.view;
    if (!view) {
      return;
    }

    const lineNumber = Math.max(1, Math.min(selectedReference.startLine, view.state.doc.lines));
    const line = view.state.doc.line(lineNumber);
    view.dispatch({
      selection: { anchor: line.from },
      scrollIntoView: true,
    });
    view.focus();
  }, [selectedReference, selectedFileContent]);

  const handleGoToDefinition = async () => {
    if (!selectedWorkspaceId || !selectedSymbol) {
      return;
    }

    try {
      const symbols = await workspaceApi.searchWorkspaceSymbols(selectedWorkspaceId, selectedSymbol.name);
      const indexed = indexWorkspaceSymbols(symbols);
      const candidate = bestDefinitionCandidate(indexed, selectedSymbol);
      if (!candidate) {
        return;
      }

      setSelectedFileByWorkspace((current) =>
        setSelectedFilePathForWorkspace(current, selectedWorkspaceId, candidate.path),
      );
      setSelectedSymbolId(candidate.id);
      setReferenceSearchTerm(candidate.name);
      setSelectedReferenceId(null);
      persistSelection({
        id: candidate.id,
        name: candidate.name,
        path: candidate.path,
        kind: candidate.kind,
        startLine: candidate.startLine,
      });
    } catch (error) {
      console.error('Failed to navigate to definition', error);
    }
  };

  const handleToggleFolder = (path: string) => {
    if (!selectedWorkspaceId) return;
    setWorkspaceTreeExpandedState((current) => {
      const currentPaths = expandedPathsForWorkspace(current, selectedWorkspaceId);
      const nextPaths = toggleTreePath(currentPaths, path);
      const nextState = setWorkspaceTreeExpandedPaths(current, selectedWorkspaceId, nextPaths);
      writeWorkspaceTreeExpandedState(localStorage, nextState);
      return nextState;
    });
  };

  const handleEditorChange = (value: string) => {
    if (!selectedWorkspaceId || !selectedFilePath) {
      return;
    }

    setWorkspaceDraftByWorkspace((current) =>
      setWorkspaceDraftForFile(current, selectedWorkspaceId, selectedFilePath, value),
    );
  };

  const handleResetDraft = () => {
    if (!selectedWorkspaceId || !selectedFilePath) {
      return;
    }

    setWorkspaceDraftByWorkspace((current) =>
      clearWorkspaceDraftForFile(current, selectedWorkspaceId, selectedFilePath),
    );
  };

  const persistSelection = (selection: { id: string; name: string; path: string; kind?: string; startLine?: number } | null) => {
    if (!selectedWorkspaceId) {
      return;
    }

    setSelectedSymbolByWorkspace((current) =>
      setSelectedSymbolForWorkspace(current, selectedWorkspaceId, selection),
    );
  };

  return (
    <div className="flex flex-col gap-6 pb-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-monokai-aqua/10 border border-monokai-aqua/20 flex items-center justify-center">
            <FolderTree className="w-6 h-6 text-monokai-aqua" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Workspaces</h1>
            <p className="max-w-3xl text-sm text-gruv-light-4">
              Connect a repo and inspect its files. The app builds context from the active workspace, file, and symbol automatically.
            </p>
          </div>
        </div>
      </header>

      <section className="glass p-4 rounded-2xl space-y-4">
        <div className="flex items-start justify-between gap-4">
          <button
            type="button"
            onClick={() => setWorkspaceControlsOpen((current) => !current)}
            className="flex-1 min-w-0 text-left px-1 py-1"
          >
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold">Workspace controls</h2>
              <span className="text-[10px] uppercase font-mono px-2 py-1 rounded-full bg-gruv-dark-3 text-gruv-light-4 border border-gruv-dark-4">
                {workspaces?.length || 0} workspaces
              </span>
              {selectedWorkspace && (
                <span className="text-[10px] uppercase font-mono px-2 py-1 rounded-full bg-monokai-aqua/10 text-monokai-aqua border border-monokai-aqua/20">
                  Active: {selectedWorkspace.name}
                </span>
              )}
            </div>
            <p className="text-sm text-gruv-light-4 mt-1 max-w-2xl">
              Register repos here, or open the list to switch the active workspace.
            </p>
          </button>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['workspaces'] })}
              className="p-2 rounded-lg bg-gruv-dark-3 hover:bg-gruv-dark-2 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            {selectedWorkspace && (
              <button
                type="button"
                onClick={() => setWorkspaceDeleteDialog({ id: selectedWorkspace.id, name: selectedWorkspace.name })}
                disabled={deleteMutation.isPending}
                className="p-2 rounded-lg bg-gruv-dark-3 hover:bg-monokai-red/15 text-gruv-light-4 hover:text-monokai-red transition-colors disabled:opacity-50"
                aria-label="Delete selected workspace"
              >
                {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </button>
            )}
            {selectedWorkspace && selectedWorkspaceHealthTone !== 'ready' && (
              <button
                type="button"
                onClick={() => {
                  setWorkspaceRebindDialog({
                    id: selectedWorkspace.id,
                    name: selectedWorkspace.name,
                    rootPath: selectedWorkspaceHealth?.rootPath || getWorkspaceRootPath(selectedWorkspace),
                  });
                  setRebindRootPath(selectedWorkspaceHealth?.rootPath || getWorkspaceRootPath(selectedWorkspace));
                }}
                disabled={rebindMutation.isPending}
                className="p-2 rounded-lg bg-gruv-dark-3 hover:bg-monokai-aqua/15 text-gruv-light-4 hover:text-monokai-aqua transition-colors disabled:opacity-50"
                aria-label="Rebind selected workspace"
              >
                {rebindMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderTree className="w-4 h-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => setWorkspaceControlsOpen((current) => !current)}
              className="p-2 rounded-lg bg-gruv-dark-3 border border-gruv-dark-4 text-gruv-light-4"
              aria-label={workspaceControlsOpen ? 'Collapse workspace controls' : 'Expand workspace controls'}
            >
              <ChevronDown className={cn("w-4 h-4 transition-transform", workspaceControlsOpen && "rotate-180")} />
            </button>
          </div>
        </div>

        {workspaceControlsOpen && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <section className="rounded-2xl border border-gruv-dark-4 bg-gruv-dark-2/40 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold">Register workspace</h3>
                <Save className="w-4 h-4 text-monokai-aqua" />
              </div>

              <div className="space-y-3">
                <input value={rootPath} onChange={(e) => setRootPath(e.target.value)} placeholder="/Users/you/project" className="flex-1 w-full bg-gruv-dark-3 border border-gruv-dark-4 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-monokai-aqua transition-colors" />
                <input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="Workspace name (optional)" className="w-full bg-gruv-dark-3 border border-gruv-dark-4 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-monokai-aqua transition-colors" />
                <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Branch (optional)" className="w-full bg-gruv-dark-3 border border-gruv-dark-4 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-monokai-aqua transition-colors" />
                <p className="text-xs text-gruv-light-4 border border-gruv-dark-4 bg-gruv-dark-3/40 rounded-xl px-3 py-2">
                  Web mode requires the full absolute local path. Paste the workspace root manually.
                </p>
                <button
                  onClick={() => registerMutation.mutate()}
                  disabled={!rootPath.trim() || registerMutation.isPending}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-monokai-aqua text-gruv-dark-1 font-semibold px-4 py-2.5 disabled:opacity-50"
                >
                  {registerMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Register
                </button>
              </div>

              {registerMutation.error && (
                <p className="text-sm text-monokai-red">
                  Failed to register workspace.
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-gruv-dark-4 bg-gruv-dark-2/40 p-5 space-y-4 xl:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold">Indexed workspaces</h3>
                  <p className="text-sm text-gruv-light-4">Select a workspace to browse files and inspect code.</p>
                </div>
              </div>

              {workspacesLoading ? (
                <div className="py-8 flex items-center justify-center text-gruv-light-4 gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Loading workspaces...
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(workspaces || []).map((workspace) => (
                    <WorkspaceCard
                      key={workspace.id}
                      workspace={workspace}
                      selected={selectedWorkspaceId === workspace.id}
                      onSelect={(workspaceId) => {
                        setSelectedWorkspaceId(workspaceId);
                        setActiveWorkspaceId(workspaceId);
                      }}
                    />
                  ))}
                  {!workspaces?.length && (
                    <div className="md:col-span-2 p-6 border border-dashed border-gruv-dark-4 rounded-2xl text-sm text-gruv-light-4">
                      No workspaces registered yet.
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </section>

  <div className={cn(
        "grid grid-cols-1 gap-6 min-h-[560px] min-w-0",
        workspaceTreePanelOpen ? "xl:grid-cols-[minmax(18rem,0.78fr)_1.22fr]" : "xl:grid-cols-[4rem_minmax(0,1fr)]"
      )}>
        <section className={cn(
          "glass rounded-2xl min-w-0 overflow-hidden transition-all duration-300 self-start",
          workspaceTreePanelOpen ? "p-6 space-y-4" : "p-2.5 space-y-2"
        )}>
          <div className={cn("flex items-center justify-between gap-3", !workspaceTreePanelOpen && "flex-col items-center justify-center")}>
            {workspaceTreePanelOpen ? (
              <>
                <div>
                  <h2 className="text-lg font-bold">Workspace tree</h2>
                  <p className="text-sm text-gruv-light-4">
                    {selectedWorkspace ? `Browsing ${selectedWorkspace.name}` : 'Select a workspace to inspect files.'}
                  </p>
                  {selectedWorkspaceHealth && (
                    <p className="mt-1 flex items-center gap-2 text-[11px] text-gruv-light-4">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border uppercase font-mono",
                          selectedWorkspaceHealthTone === 'ready'
                            ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                            : selectedWorkspaceHealthTone === 'missing'
                              ? "bg-monokai-red/10 text-monokai-red border-monokai-red/20"
                              : selectedWorkspaceHealthTone === 'exists_not_directory'
                                ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                                : "bg-gruv-dark-2 text-gruv-light-4 border-gruv-dark-4",
                        )}
                      >
                        {selectedWorkspaceHealthTone === 'ready' ? <ShieldCheck className="w-3 h-3" /> : selectedWorkspaceHealthTone === 'missing' ? <ShieldAlert className="w-3 h-3" /> : <ShieldQuestion className="w-3 h-3" />}
                        {selectedWorkspaceHealth?.status}
                      </span>
                      <span className="truncate max-w-[18rem]">{selectedWorkspaceHealth.rootPath}</span>
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedWorkspace && (
                    <button
                      onClick={() => indexMutation.mutate(selectedWorkspace.id)}
                      disabled={indexMutation.isPending}
                      className="flex items-center gap-2 rounded-xl bg-monokai-pink text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    >
                      {indexMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      Reindex
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setWorkspaceTreePanelOpen(false)}
                    className="p-2 rounded-lg bg-gruv-dark-3 border border-gruv-dark-4 text-gruv-light-4"
                    aria-label="Collapse workspace tree"
                    title="Collapse workspace tree"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                </div>
              </>
            ) : (
              <div className="flex w-full flex-col items-center justify-center gap-2 py-1">
                <button
                  type="button"
                  onClick={() => setWorkspaceTreePanelOpen(true)}
                  className="flex items-center justify-center w-10 h-10 rounded-xl bg-gruv-dark-3 border border-gruv-dark-4 text-gruv-light-4"
                  aria-label="Expand workspace tree"
                  title="Expand workspace tree"
                >
                  <FolderTree className="w-4 h-4" />
                </button>
                <span className="text-[9px] uppercase tracking-widest text-gruv-light-4 text-center leading-tight">
                  Tree
                </span>
                <span className="text-[10px] text-gruv-light-4 text-center leading-tight">
                  {files.length} files
                </span>
              </div>
            )}
          </div>

          {workspaceTreePanelOpen && (
            <>
              <div className="relative">
                <Search className="w-4 h-4 text-gruv-light-4 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Filter paths..."
                  className="w-full pl-10 pr-4 py-3 bg-gruv-dark-3 border border-gruv-dark-4 rounded-xl outline-none focus:border-monokai-aqua transition-colors"
                />
              </div>

              <div className="flex items-center gap-3 text-xs text-gruv-light-4">
                <span className="px-2 py-1 rounded-full bg-gruv-dark-3 border border-gruv-dark-4">{files.length} files</span>
                {indexState && (
                  <span className="px-2 py-1 rounded-full bg-gruv-dark-3 border border-gruv-dark-4">
                    index: {getWorkspaceIndexStatus(indexState)}
                  </span>
                )}
              </div>

              <div className="border border-gruv-dark-4 rounded-2xl bg-gruv-dark-2/40 min-h-[360px] max-h-[560px] overflow-auto p-3 space-y-1">
                {filesLoading ? (
                  <div className="h-[360px] flex items-center justify-center gap-2 text-gruv-light-4">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Loading files...
                  </div>
                ) : visibleTree.children.length > 0 ? (
                  visibleTree.children.map((node) => (
                    <TreeNodeView
                      key={node.path || node.name}
                      node={node}
                      depth={0}
                      expandedPaths={expandedPaths}
                      onToggleFolder={handleToggleFolder}
                      onOpenFile={(path) => {
                        if (!selectedWorkspaceId) return;
                        setSelectedFileByWorkspace((current) => setSelectedFilePathForWorkspace(current, selectedWorkspaceId, path));
                      }}
                    />
                  ))
                ) : (
                  <div className="h-[360px] flex flex-col items-center justify-center text-gruv-light-4 gap-2">
                    <BadgeInfo className="w-10 h-10" />
                    <p className="text-sm">{selectedWorkspace ? 'No files indexed yet.' : 'Choose a workspace to see its tree.'}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <aside className="glass p-6 rounded-2xl space-y-5 min-w-0">
          <div className="space-y-3 min-w-0">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">File preview</h2>
              <FileCode2 className="w-5 h-5 text-monokai-aqua" />
            </div>

            {selectedFilePath ? (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-gruv-dark-3/60 border border-gruv-dark-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold break-all">{selectedFilePath}</p>
                      <p className="text-[11px] text-gruv-light-4 mt-1">
                        {selectedFileRecord?.language || selectedFileContent?.language || 'text'}
                        {typeof selectedFileContent?.lineCount === 'number' ? ` • ${selectedFileContent.lineCount} lines` : ''}
                        {typeof selectedFileContent?.sizeBytes === 'number' ? ` • ${selectedFileContent.sizeBytes} bytes` : ''}
                        {selectedFileSymbols.length > 0 ? ` • ${selectedFileSymbols.length} symbols` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn(
                        "text-[10px] uppercase font-mono px-2 py-1 rounded-full border",
                        hasUnsavedFileDraft
                          ? "bg-monokai-aqua/10 text-monokai-aqua border-monokai-aqua/20"
                          : "bg-gruv-dark-2 text-gruv-light-4 border-gruv-dark-4"
                      )}>
                        {hasUnsavedFileDraft ? 'Draft' : 'Live'}
                      </span>
                      {hasUnsavedFileDraft && (
                        <button
                          type="button"
                          onClick={handleResetDraft}
                          className="text-[10px] uppercase font-mono px-2 py-1 rounded-full bg-gruv-dark-2 text-gruv-light-4 border border-gruv-dark-4 hover:border-monokai-aqua transition-colors"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl overflow-hidden border border-gruv-dark-4 bg-gruv-dark-2/60 min-h-[360px] min-w-0">
                  {selectedFileLoading ? (
                    <div className="h-[360px] flex items-center justify-center gap-2 text-gruv-light-4">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Loading file...
                    </div>
                  ) : selectedFileContent ? (
                    <div className="h-[360px] relative min-w-0 overflow-x-auto overflow-y-hidden">
                      <CodeMirror
                        ref={codeMirrorRef}
                        value={selectedFileEditorValue}
                        height="360px"
                        width="100%"
                        theme={oneDark}
                        editable={true}
                        onChange={handleEditorChange}
                        className="text-[11px] max-w-full"
                      />
                      <pre className="sr-only" data-testid="workspace-file-content-text">
                        {selectedFileEditorValue}
                      </pre>
                    </div>
                  ) : (
                    <div className="h-[360px] flex items-center justify-center text-gruv-light-4 text-sm px-6 text-center">
                      Select a file from the tree to preview its contents.
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] text-gruv-light-4">
                    Local edits stay in the browser until you save them to disk.
                  </p>
                  <div className="flex items-center gap-2">
                    {saveMutation.error && (
                      <span className="text-[11px] text-monokai-red">Save failed</span>
                    )}
                    <button
                      type="button"
                      onClick={() => saveMutation.mutate()}
                      disabled={!hasUnsavedFileDraft || saveMutation.isPending || indexMutation.isPending}
                      className="flex items-center gap-2 rounded-xl bg-monokai-aqua text-gruv-dark-1 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    >
                      {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save
                    </button>
                  </div>
                </div>

                {hasUnsavedFileDraft && (
                  <div className="space-y-2 rounded-xl border border-gruv-dark-4 bg-gruv-dark-3/40 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">Diff preview</p>
                        <p className="text-[11px] text-gruv-light-4">
                          {selectedFileDraftDiff.removedCount} removed, {selectedFileDraftDiff.addedCount} added
                        </p>
                      </div>
                      <span className="text-[10px] uppercase font-mono px-2 py-1 rounded-full bg-gruv-dark-2 text-gruv-light-4 border border-gruv-dark-4">
                        {selectedFileDraftDiff.commonPrefixLines} prefix / {selectedFileDraftDiff.commonSuffixLines} suffix
                      </span>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {renderDiffLines('Live', selectedFileDraftDiff.removedLines, selectedFileDraftDiff.removedLineStart, 'live')}
                      {renderDiffLines('Draft', selectedFileDraftDiff.addedLines, selectedFileDraftDiff.addedLineStart, 'draft')}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-5 rounded-xl border border-dashed border-gruv-dark-4 text-sm text-gruv-light-4">
                Click a file in the tree to inspect it here.
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">Symbols</h2>
              <BadgeInfo className="w-5 h-5 text-monokai-aqua" />
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-gruv-light-4 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={symbolSearchTerm}
                onChange={(e) => setSymbolSearchTerm(e.target.value)}
                placeholder={selectedFilePath ? 'Search symbols in workspace...' : 'Open a file or search workspace symbols...'}
                className="w-full pl-10 pr-4 py-2.5 bg-gruv-dark-3 border border-gruv-dark-4 rounded-xl outline-none focus:border-monokai-aqua transition-colors text-sm"
              />
            </div>

            {selectedFilePath || hasSymbolSearch ? (
              <div className="space-y-2 max-h-[220px] overflow-auto pr-1">
                {symbolsLoading ? (
                  <div className="py-4 flex items-center justify-center gap-2 text-gruv-light-4">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading symbols...
                  </div>
                ) : visibleSymbols.length > 0 ? (
                  visibleSymbols.map((symbol) => (
                    <button
                      key={symbol.id}
                      type="button"
                    onClick={() => {
                        setSelectedSymbolId(symbol.id);
                        setReferenceSearchTerm(symbol.name);
                        setSelectedReferenceId(null);
                        if (!selectedWorkspaceId) return;
                        setSelectedFileByWorkspace((current) => setSelectedFilePathForWorkspace(current, selectedWorkspaceId, symbol.path));
                        persistSelection({
                          id: symbol.id,
                          name: symbol.name,
                          path: symbol.path,
                          kind: symbol.kind,
                          startLine: symbol.startLine,
                        });
                      }}
                      className={cn(
                        "w-full text-left p-2.5 rounded-xl border transition-colors",
                        selectedSymbolId === symbol.id
                          ? "border-monokai-aqua bg-monokai-aqua/10"
                          : "border-gruv-dark-4 bg-gruv-dark-3/40 hover:border-gruv-light-4/30"
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold truncate">{symbol.name}</p>
                          <p className="text-[11px] text-gruv-light-4 mt-0.5">
                            {symbol.kind}
                            {symbol.signature ? ` • ${symbol.signature}` : ''}
                          </p>
                          {hasSymbolSearch && (
                            <p className="text-[11px] text-gruv-light-4 mt-0.5 truncate">
                              {symbol.path}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-[10px] font-mono px-2 py-1 rounded-full bg-gruv-dark-2 text-gruv-light-4">
                          L{symbol.startLine}
                        </div>
                      </div>
                    </button>
                  ))
                ) : deferredSymbolSearchTerm ? (
                  <div className="p-5 rounded-xl border border-dashed border-gruv-dark-4 text-sm text-gruv-light-4">
                    No symbols matched this search.
                  </div>
                ) : (
                  <div className="p-5 rounded-xl border border-dashed border-gruv-dark-4 text-sm text-gruv-light-4">
                    No symbols found for this file yet.
                  </div>
                )}
              </div>
            ) : (
              <div className="p-5 rounded-xl border border-dashed border-gruv-dark-4 text-sm text-gruv-light-4">
                Open a file to see its symbols.
              </div>
            )}

            {selectedSymbol && (
              <div className="p-3 rounded-xl bg-monokai-aqua/5 border border-monokai-aqua/10 text-xs text-gruv-light-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span>
                    Selected symbol <span className="text-monokai-aqua font-semibold">{selectedSymbol.name}</span> on line {selectedSymbol.startLine}
                  </span>
                  <button
                    type="button"
                    onClick={handleGoToDefinition}
                    disabled={!selectedSymbolDefinition}
                    className="px-3 py-1.5 rounded-lg bg-gruv-dark-3 border border-gruv-dark-4 text-gruv-light-4 hover:border-monokai-aqua transition-colors disabled:opacity-50"
                  >
                    Go to definition
                  </button>
                </div>
                {selectedSymbolDefinition && (
                  <div className="text-[11px] text-gruv-light-4">
                    Best match: <span className="text-gruv-light-1 font-semibold">{selectedSymbolDefinition.path}</span> at line {selectedSymbolDefinition.startLine}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3 rounded-2xl border border-gruv-dark-4 bg-gruv-dark-2/30 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">References</h3>
                  <p className="text-[11px] text-gruv-light-4">
                    {selectedSymbol
                      ? `Searching for ${selectedSymbol.name}`
                      : 'Search a symbol name to find chunk-level matches.'}
                  </p>
                </div>
                <BadgeInfo className="w-4 h-4 text-monokai-aqua" />
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-gruv-light-4 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={referenceSearchTerm}
                  onChange={(e) => setReferenceSearchTerm(e.target.value)}
                  placeholder={selectedSymbol ? 'Search references for this symbol...' : 'Search references in workspace...'}
                  className="w-full pl-10 pr-4 py-2.5 bg-gruv-dark-3 border border-gruv-dark-4 rounded-xl outline-none focus:border-monokai-aqua transition-colors text-sm"
                />
              </div>

              <div className="space-y-2 max-h-[220px] overflow-auto pr-1">
                {referencesLoading ? (
                  <div className="py-4 flex items-center justify-center gap-2 text-gruv-light-4">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading references...
                  </div>
                ) : Object.keys(indexedVisibleReferences).length > 0 ? (
                  Object.entries(indexedVisibleReferences).map(([path, references]) => (
                    <div key={path} className="space-y-2">
                      <div className="text-[10px] uppercase tracking-widest text-gruv-light-4 px-1">
                        {path} • {references.length} hit{references.length === 1 ? '' : 's'}
                      </div>
                      {references.map((reference) => (
                        <button
                          key={reference.id}
                          type="button"
                      onClick={() => {
                        setSelectedReferenceId(reference.id);
                        setSelectedSymbolId(null);
                        if (!selectedWorkspaceId) return;
                        setSelectedFileByWorkspace((current) =>
                          setSelectedFilePathForWorkspace(current, selectedWorkspaceId, reference.path),
                        );
                        persistSelection({
                          id: reference.id,
                          name: reference.matchedText,
                          path: reference.path,
                          kind: 'reference',
                          startLine: reference.startLine,
                        });
                      }}
                          className={cn(
                            "w-full text-left p-2.5 rounded-xl border transition-colors",
                            selectedReferenceId === reference.id
                              ? "border-monokai-aqua bg-monokai-aqua/10"
                              : "border-gruv-dark-4 bg-gruv-dark-3/40 hover:border-gruv-light-4/30"
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold truncate">{reference.matchedText}</p>
                              <p className="text-[11px] text-gruv-light-4 mt-0.5 truncate">{reference.snippet}</p>
                            </div>
                            <div className="shrink-0 text-[10px] font-mono px-2 py-1 rounded-full bg-gruv-dark-2 text-gruv-light-4">
                              L{reference.startLine}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ))
                ) : activeReferenceQuery ? (
                  <div className="p-5 rounded-xl border border-dashed border-gruv-dark-4 text-sm text-gruv-light-4">
                    No references matched this search.
                  </div>
                ) : (
                  <div className="p-5 rounded-xl border border-dashed border-gruv-dark-4 text-sm text-gruv-light-4">
                    Open a symbol or search a term to inspect references.
                  </div>
                )}
              </div>

              {selectedReference && (
                <div className="p-3 rounded-xl bg-monokai-aqua/5 border border-monokai-aqua/10 text-xs text-gruv-light-4">
                  Selected reference in <span className="text-monokai-aqua font-semibold">{selectedReference.path}</span> at line {selectedReference.startLine}
                </div>
              )}
            </div>
          </div>

        </aside>
      </div>

      {workspaceDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !deleteMutation.isPending && setWorkspaceDeleteDialog(null)}
          />
          <div className="relative w-full max-w-lg glass rounded-3xl overflow-hidden shadow-2xl border border-gruv-dark-4/30">
            <div className="p-6 border-b border-gruv-dark-4/20 flex items-center gap-3 bg-gruv-dark-2/30">
              <div className="w-10 h-10 rounded-2xl bg-monokai-red/10 border border-monokai-red/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-monokai-red" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Delete workspace</h3>
                <p className="text-sm text-gruv-light-4">Remove this workspace from stepbit-memory.</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-gruv-light-3">
                This only removes the indexed workspace record and its memory data. It does not delete files from disk.
              </p>

              <div className="rounded-2xl border border-gruv-dark-4 bg-gruv-dark-2/50 p-4 space-y-2">
                <div className="text-xs uppercase tracking-widest text-gruv-light-4">Workspace</div>
                <div className="font-semibold">{workspaceDeleteDialog.name}</div>
                <div className="text-xs text-gruv-light-4 break-all">{workspaceDeleteDialog.id}</div>
              </div>

              <p className="text-sm text-monokai-red">
                If the root path moved, this is the clean way to reset the workspace before re-registering it.
              </p>
            </div>

            <div className="p-6 border-t border-gruv-dark-4/20 flex justify-end gap-3 bg-gruv-dark-2/30">
              <button
                type="button"
                onClick={() => setWorkspaceDeleteDialog(null)}
                disabled={deleteMutation.isPending}
                className="px-5 py-2 rounded-xl border border-gruv-dark-4 text-gruv-light-4 hover:bg-gruv-dark-4 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(workspaceDeleteDialog.id)}
                disabled={deleteMutation.isPending}
                className="px-5 py-2 rounded-xl bg-monokai-red text-white font-semibold hover:brightness-110 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete workspace
              </button>
            </div>
          </div>
        </div>
      )}

      {workspaceRebindDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !rebindMutation.isPending && setWorkspaceRebindDialog(null)}
          />
          <div className="relative w-full max-w-2xl glass rounded-3xl overflow-hidden shadow-2xl border border-gruv-dark-4/30">
            <div className="p-6 border-b border-gruv-dark-4/20 flex items-center justify-between gap-3 bg-gruv-dark-2/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-monokai-aqua/10 border border-monokai-aqua/20 flex items-center justify-center">
                  <FolderTree className="w-5 h-5 text-monokai-aqua" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">Rebind workspace</h3>
                  <p className="text-sm text-gruv-light-4">Point this workspace to the new filesystem location.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWorkspaceRebindDialog(null)}
                className="p-2 rounded-lg hover:bg-gruv-dark-4 text-gruv-light-4 transition-colors"
                aria-label="Close rebind dialog"
              >
                <ChevronDown className="w-4 h-4 rotate-180" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-gruv-light-3">
                Choose the new absolute path for <span className="text-gruv-light-1 font-semibold">{workspaceRebindDialog.name}</span>. This keeps the same workspace ID, clears the stale index, and reindexes from the new root.
              </p>

              <div className="rounded-2xl border border-gruv-dark-4 bg-gruv-dark-2/50 p-4 space-y-2">
                <div className="text-xs uppercase tracking-widest text-gruv-light-4">Current root</div>
                <div className="text-sm break-all text-gruv-light-3">{workspaceRebindDialog.rootPath}</div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black text-gruv-light-4 uppercase tracking-widest">New root path</label>
                <input
                  value={rebindRootPath}
                  onChange={(e) => setRebindRootPath(e.target.value)}
                  placeholder="/Users/you/new-project-location"
                  className="w-full bg-gruv-dark-3 border border-gruv-dark-4 rounded-xl px-4 py-3 text-sm outline-none focus:border-monokai-aqua transition-colors"
                />
              </div>

              <p className="text-xs text-amber-300 border border-amber-500/20 bg-amber-500/10 rounded-xl px-3 py-2">
                The browser cannot reliably discover the absolute path for a directory handle. Paste the full path here.
              </p>

              <p className="text-xs text-gruv-light-4">
                After rebind, the workspace will be reindexed automatically.
              </p>
            </div>

            <div className="p-6 border-t border-gruv-dark-4/20 flex justify-end gap-3 bg-gruv-dark-2/30">
              <button
                type="button"
                onClick={() => setWorkspaceRebindDialog(null)}
                disabled={rebindMutation.isPending}
                className="px-5 py-2 rounded-xl border border-gruv-dark-4 text-gruv-light-4 hover:bg-gruv-dark-4 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => rebindMutation.mutate({ workspaceId: workspaceRebindDialog.id, rootPath: rebindRootPath.trim() })}
                disabled={!rebindRootPath.trim() || rebindMutation.isPending}
                className="px-5 py-2 rounded-xl bg-monokai-aqua text-gruv-dark-1 font-semibold hover:brightness-110 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {rebindMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderTree className="w-4 h-4" />}
                Rebind and reindex
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function TreeNodeView({
  node,
  depth,
  expandedPaths,
  onToggleFolder,
  onOpenFile,
}: {
  node: WorkspaceTreeNode;
  depth: number;
  expandedPaths: string[];
  onToggleFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const isExpanded = expandedPaths.includes(node.path);
  const hasChildren = node.children.length > 0;
  const indent = depth * 18;

  return (
    <div className="select-none">
      {node.kind === 'directory' ? (
        <button
          type="button"
          onClick={() => onToggleFolder(node.path)}
          className={cn(
            "w-full flex items-center gap-2 text-left px-2 py-2 rounded-lg transition-colors hover:bg-gruv-dark-3",
          )}
          style={{ paddingLeft: 12 + indent }}
        >
          <span className="text-gruv-light-4">
            {hasChildren && isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>
          <FolderOpen className={cn("w-4 h-4", isExpanded ? "text-monokai-aqua" : "text-gruv-light-4")} />
          <span className="text-sm font-medium truncate">{node.name}</span>
        </button>
      ) : (
        <div
          className={cn(
            "w-full flex items-center gap-2 text-left px-2 py-2 rounded-lg transition-colors hover:bg-monokai-aqua/10"
          )}
          style={{ paddingLeft: 12 + indent }}
        >
          <button
            type="button"
            onClick={() => onOpenFile(node.path)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <FileCode2 className="w-4 h-4 text-gruv-light-4" />
            <span className="text-sm font-medium truncate">{node.name}</span>
            {node.file?.language && (
              <span className="ml-auto text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-gruv-dark-2 text-gruv-light-4">
                {node.file.language}
              </span>
            )}
          </button>
        </div>
      )}

      {node.kind === 'directory' && isExpanded && (
        <div className="space-y-1">
          {node.children.map((child) => (
            <TreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              onToggleFolder={onToggleFolder}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function filterTreeByPath(node: WorkspaceTreeNode, term: string): WorkspaceTreeNode {
  if (!term) {
    return node;
  }

  if (node.kind === 'file') {
    return node.path.toLowerCase().includes(term) || node.name.toLowerCase().includes(term)
      ? node
      : { ...node, children: [] };
  }

  const children = node.children
    .map((child) => filterTreeByPath(child, term))
    .filter((child) => child.kind === 'file' || child.children.length > 0 || child.name.toLowerCase().includes(term));

  return { ...node, children };
}

export default Workspaces;
