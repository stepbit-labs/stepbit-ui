import { lazy, Suspense, useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Plus, Trash2, Bot, User, Loader2, Edit3, Settings, X, Check, Code, Eye, Globe, Brain, ChevronDown, BookOpen, Search } from 'lucide-react';
import { sessionsApi } from '../api/sessions';
import { configApi } from '../api/config';
import { workspaceApi } from '../api/workspaces';
import { skillsApi, type Skill } from '../api/skills';
import { useChatStream } from '../hooks/useChatStream';
import { clsx } from 'clsx';
import { MarkdownContent } from '../components/MarkdownContent';
import { ChatWorkspaceRail } from '../components/ChatWorkspaceRail';
import {
    expandComposerCommand,
    getComposerCommandSuggestions,
    parseComposerCommand,
    type ComposerCommandSuggestion,
} from '../lib/chatComposerCommands';
import {
    formatWorkspaceEvidenceBlock,
    formatEditorSelectionEvidenceBlock,
    inferWorkspaceCommandQuery,
} from '../lib/chatComposerWorkspace';
import { ACTIVE_WORKSPACE_STORAGE_KEY, buildWorkspaceContextRequest, resolveWorkspaceContextPaths, setActiveWorkspaceId } from '../lib/workspaceContext';
import {
    readWorkspaceEditorSelectionState,
    selectedFilePathForWorkspace,
} from '../lib/workspaceEditorState';
import {
    readWorkspaceSymbolSelectionState,
    selectedSymbolForWorkspace,
} from '../lib/workspaceSymbolState';
import {
    readWorkspaceSelectionSnapshotState,
    selectionSnapshotForWorkspace,
    WORKSPACE_EDITOR_SELECTION_EVENT,
} from '../lib/workspaceSelectionState';

const WorkspaceStudio = lazy(() => import('../components/WorkspaceStudio').then((module) => ({ default: module.WorkspaceStudio })));
const TerminalStudio = lazy(() => import('../components/TerminalStudio').then((module) => ({ default: module.TerminalStudio })));

// ─── Skills Multi-Selector ───────────────────────────────────────────────────

interface SkillsSelectorProps {
    selected: Skill[];
    onChange: (skills: Skill[]) => void;
}

const SkillsSelector = ({ selected, onChange }: SkillsSelectorProps) => {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const ref = useRef<HTMLDivElement>(null);

    const { data: allSkills = [] } = useQuery({
        queryKey: ['skills'],
        queryFn: () => skillsApi.list(),
    });

    const filtered = allSkills.filter(s => {
        const q = search.toLowerCase();
        return !q || s.name.toLowerCase().includes(q) || s.tags.toLowerCase().includes(q);
    });

    const isSelected = (id: number) => selected.some(s => s.id === id);

    const toggle = (skill: Skill) => {
        if (isSelected(skill.id)) {
            onChange(selected.filter(s => s.id !== skill.id));
        } else {
            onChange([...selected, skill]);
        }
    };

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className={clsx(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[10px] font-mono transition-all border",
                    selected.length > 0
                        ? "bg-monokai-purple/10 border-monokai-purple text-monokai-purple shadow-[0_0_10px_rgba(174,129,255,0.2)]"
                        : "bg-gruv-dark-3 border-gruv-dark-4 text-gruv-light-4 hover:border-gruv-light-4"
                )}
            >
                <BookOpen className="w-3 h-3" />
                SKILLS
                {selected.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-sm bg-monokai-purple text-white text-[9px] leading-none font-bold">
                        {selected.length}
                    </span>
                )}
                <ChevronDown className={clsx("w-2 h-2 transition-transform", open && "rotate-180")} />
            </button>

            {open && (
                <div className="absolute bottom-full left-0 mb-2 w-64 bg-gruv-dark-1 border border-gruv-dark-4/60 rounded-sm shadow-xl z-50 overflow-hidden">
                    {/* Search */}
                    <div className="p-2 border-b border-gruv-dark-4/30 flex items-center gap-2">
                        <Search className="w-3 h-3 text-gruv-dark-4 shrink-0" />
                        <input
                            autoFocus
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Filter skills…"
                            className="flex-grow bg-transparent text-xs text-gruv-light-1 placeholder:text-gruv-dark-4 outline-none"
                        />
                    </div>

                    {/* List */}
                    <div className="max-h-56 overflow-y-auto py-1">
                        {allSkills.length === 0 ? (
                            <p className="text-center text-gruv-light-4 text-xs py-6">No skills yet — create them in the Skills page.</p>
                        ) : filtered.length === 0 ? (
                            <p className="text-center text-gruv-light-4 text-xs py-6">No skills match.</p>
                        ) : (
                            filtered.map(skill => (
                                <button
                                    key={skill.id}
                                    type="button"
                                    onClick={() => toggle(skill)}
                                className={clsx(
                                    "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
                                        isSelected(skill.id)
                                            ? "bg-monokai-purple/10 text-monokai-purple"
                                            : "text-gruv-light-3 hover:bg-gruv-dark-3 hover:text-gruv-light-1"
                                    )}
                                >
                                    <div className={clsx(
                                        "w-4 h-4 rounded-sm flex items-center justify-center border shrink-0 transition-colors",
                                        isSelected(skill.id)
                                            ? "bg-monokai-purple border-monokai-purple"
                                            : "border-gruv-dark-4"
                                    )}>
                                        {isSelected(skill.id) && <Check className="w-2.5 h-2.5 text-white" />}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-semibold truncate">{skill.name}</p>
                                        {skill.tags && (
                                            <p className="text-[10px] text-gruv-dark-4 truncate">{skill.tags}</p>
                                        )}
                                    </div>
                                </button>
                            ))
                        )}
                    </div>

                    {/* Footer */}
                    {selected.length > 0 && (
                        <div className="px-4 py-2 border-t border-gruv-dark-4/30 flex justify-between items-center">
                            <span className="text-[10px] text-gruv-light-4">{selected.length} selected</span>
                            <button
                                type="button"
                                onClick={() => onChange([])}
                                className="text-[10px] text-monokai-red hover:underline"
                            >
                                Clear all
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const CHAT_SIDEBAR_WIDTH_STORAGE_KEY = 'stepbit_chat_sidebar_width';
const CHAT_SIDEBAR_MIN_WIDTH = 180;
const CHAT_SIDEBAR_MAX_WIDTH = 360;
const CHAT_WORKSPACE_RAIL_WIDTH_STORAGE_KEY = 'stepbit_chat_workspace_rail_width';
const CHAT_WORKSPACE_RAIL_MIN_WIDTH = 180;
const CHAT_WORKSPACE_RAIL_MAX_WIDTH = 320;

export const Chat = () => {
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [input, setInput] = useState('');
    const [isEditingName, setIsEditingName] = useState(false);
    const [editingNameValue, setEditingNameValue] = useState('');
    const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false);
    const [metadataValue, setMetadataValue] = useState('');
    const [rawMessageIndices, setRawMessageIndices] = useState<Set<number>>(new Set());
    const [searchEnabled, setSearchEnabled] = useState(false);
    const [reasoningEnabled, setReasoningEnabled] = useState(false);
    const [selectedSkills, setSelectedSkills] = useState<Skill[]>([]);
    const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(() => localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY));
    const [workspaceSelectionTick, setWorkspaceSelectionTick] = useState(0);
    const [isWorkspaceDropdownOpen, setIsWorkspaceDropdownOpen] = useState(false);
    const [activeSurfaceTab, setActiveSurfaceTab] = useState<'chat' | 'code' | 'terminal'>('chat');
    const [chatSidebarWidth, setChatSidebarWidth] = useState<number>(() => {
        const stored = Number(localStorage.getItem(CHAT_SIDEBAR_WIDTH_STORAGE_KEY) || 224);
        return Number.isFinite(stored)
            ? Math.min(CHAT_SIDEBAR_MAX_WIDTH, Math.max(CHAT_SIDEBAR_MIN_WIDTH, stored))
            : 224;
    });
    const [workspaceRailWidth, setWorkspaceRailWidth] = useState<number>(() => {
        const stored = Number(localStorage.getItem(CHAT_WORKSPACE_RAIL_WIDTH_STORAGE_KEY) || 232);
        return Number.isFinite(stored)
            ? Math.min(CHAT_WORKSPACE_RAIL_MAX_WIDTH, Math.max(CHAT_WORKSPACE_RAIL_MIN_WIDTH, stored))
            : 232;
    });

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const chatSidebarResizeRef = useRef<{
        startX: number;
        startWidth: number;
    } | null>(null);
    const workspaceRailResizeRef = useRef<{
        startX: number;
        startWidth: number;
    } | null>(null);
    const queryClient = useQueryClient();

    const { data: sessions, isLoading: sessionsLoading } = useQuery({
        queryKey: ['sessions'],
        queryFn: () => sessionsApi.list()
    });

    const { data: activeDetail } = useQuery({
        queryKey: ['active-provider-detail'],
        queryFn: () => configApi.getActiveProviderInfo(),
        refetchInterval: 5000 // Poll faster for real-time feel
    });

    const { data: workspaces = [] } = useQuery({
        queryKey: ['workspaces'],
        queryFn: () => workspaceApi.listWorkspaces(),
    });

    const selectModelMutation = useMutation({
        mutationFn: (id: string) => configApi.setActiveModel(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['active-provider-detail'] });
        }
    });

    const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);

    const activeSession = sessions?.find(s => s.id === activeSessionId);
    const activeWorkspace = useMemo(
        () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) || null,
        [activeWorkspaceId, workspaces],
    );
    const activeWorkspaceSelection = useMemo(() => {
        const selectionState = readWorkspaceEditorSelectionState(localStorage);
        return selectedFilePathForWorkspace(selectionState, activeWorkspaceId);
    }, [activeWorkspaceId, workspaceSelectionTick]);
    const activeWorkspaceSymbolSelection = useMemo(() => {
        const selectionState = readWorkspaceSymbolSelectionState(localStorage);
        return selectedSymbolForWorkspace(selectionState, activeWorkspaceId);
    }, [activeWorkspaceId, workspaceSelectionTick]);
    const activeWorkspaceTextSelection = useMemo(() => {
        const selectionState = readWorkspaceSelectionSnapshotState(localStorage);
        return selectionSnapshotForWorkspace(selectionState, activeWorkspaceId);
    }, [activeWorkspaceId, workspaceSelectionTick]);
    const composerSuggestions = useMemo(() => getComposerCommandSuggestions(input), [input]);
    const activeComposerCommand = useMemo(() => parseComposerCommand(input), [input]);

    const { data: messageHistory } = useQuery({
        queryKey: ['messages', activeSessionId],
        queryFn: () => sessionsApi.getMessages(activeSessionId!),
        enabled: !!activeSessionId
    });

    // Stream Hook
    const {
        messages,
        setMessages,
        isStreaming,
        isWaiting,
        status,
        error: chatError,
        connect,
        sendMessage,
        cancel
    } = useChatStream(activeSessionId);

    // Auto-connect when session ID changes
    useEffect(() => {
        if (activeSessionId) {
            const apiKey = localStorage.getItem('jacox_api_key') || 'sk-dev-key-123';
            connect(apiKey);
        }
    }, [activeSessionId, connect]);

    // Sync history to stream hook
    useEffect(() => {
        if (messageHistory) {
            setMessages(messageHistory);
        }
    }, [messageHistory, setMessages]);

    useEffect(() => {
        const sync = () => setActiveWorkspaceIdState(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY));
        sync();
        window.addEventListener('storage', sync);
        return () => window.removeEventListener('storage', sync);
    }, []);

    useEffect(() => {
        setIsWorkspaceDropdownOpen(false);
    }, [activeWorkspaceId]);

    useEffect(() => {
        const sync = () => setWorkspaceSelectionTick((current) => current + 1);
        window.addEventListener('storage', sync);
        window.addEventListener(WORKSPACE_EDITOR_SELECTION_EVENT, sync);
        window.addEventListener('focus', sync);
        return () => {
            window.removeEventListener('storage', sync);
            window.removeEventListener(WORKSPACE_EDITOR_SELECTION_EVENT, sync);
            window.removeEventListener('focus', sync);
        };
    }, []);

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            const chatDrag = chatSidebarResizeRef.current;
            if (chatDrag) {
                const nextWidth = Math.min(
                    CHAT_SIDEBAR_MAX_WIDTH,
                    Math.max(CHAT_SIDEBAR_MIN_WIDTH, chatDrag.startWidth + (event.clientX - chatDrag.startX)),
                );
                setChatSidebarWidth(nextWidth);
            }

            const railDrag = workspaceRailResizeRef.current;
            if (railDrag) {
                const nextWidth = Math.min(
                    CHAT_WORKSPACE_RAIL_MAX_WIDTH,
                    Math.max(CHAT_WORKSPACE_RAIL_MIN_WIDTH, railDrag.startWidth + (event.clientX - railDrag.startX)),
                );
                setWorkspaceRailWidth(nextWidth);
            }
        };

        const handlePointerUp = () => {
            let handled = false;
            if (chatSidebarResizeRef.current) {
                chatSidebarResizeRef.current = null;
                localStorage.setItem(CHAT_SIDEBAR_WIDTH_STORAGE_KEY, String(chatSidebarWidth));
                handled = true;
            }
            if (workspaceRailResizeRef.current) {
                workspaceRailResizeRef.current = null;
                localStorage.setItem(CHAT_WORKSPACE_RAIL_WIDTH_STORAGE_KEY, String(workspaceRailWidth));
                handled = true;
            }
            if (handled) {
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [chatSidebarWidth, workspaceRailWidth]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isWaiting]);

    // Mutations
    const updateSession = useMutation({
        mutationFn: ({ id, name, metadata }: { id: string, name?: string, metadata?: any }) =>
            sessionsApi.update(id, { name, metadata }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
            setIsEditingName(false);
            setIsMetadataModalOpen(false);
        }
    });

    const createSession = useMutation({
        mutationFn: (name: string) => sessionsApi.create({ name }),
        onSuccess: (newSession) => {
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
            setActiveSessionId(newSession.id);
        }
    });

    const deleteSession = useMutation({
        mutationFn: (id: string) => sessionsApi.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
            if (activeSessionId) setActiveSessionId(null);
        }
    });

    const handleSend = () => {
        if (!input.trim() || (activeSurfaceTab === 'chat' && isStreaming)) return;
        void handleSendAsync();
    };

    const applyComposerSuggestion = (suggestion: ComposerCommandSuggestion) => {
        const expanded = expandComposerCommand(suggestion, {
            workspaceName: activeWorkspace?.name || null,
            currentFilePath: activeWorkspaceSelection,
            currentSymbolName: activeWorkspaceSymbolSelection?.name || null,
            currentSymbolPath: activeWorkspaceSymbolSelection?.path || null,
        });
        setInput(expanded);
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    const injectPromptFromWorkspace = (prompt: string) => {
        setActiveSurfaceTab('chat');
        setInput(prompt);
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    const handleSendAsync = async () => {
        if (activeSurfaceTab === 'terminal') {
            return;
        }

        let finalMessage = input.trim();
        const parsedCommand = parseComposerCommand(finalMessage);
        const workspaceId = activeWorkspaceId || localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
        const selectedPaths = resolveWorkspaceContextPaths({
            currentFilePath: activeWorkspaceSelection,
            currentSymbolPath: activeWorkspaceSymbolSelection?.path || null,
        });
        let workspaceEvidenceBlock: string | null = null;

        if (parsedCommand) {
            const workspaceQuery = inferWorkspaceCommandQuery(
                parsedCommand,
                activeWorkspaceSelection,
                activeWorkspaceSymbolSelection?.name || null,
                activeWorkspaceSymbolSelection?.path || null,
            );
            finalMessage = expandComposerCommand(parsedCommand, {
                workspaceName: activeWorkspace?.name || null,
                currentFilePath: activeWorkspaceSelection,
                currentSymbolName: activeWorkspaceSymbolSelection?.name || null,
                currentSymbolPath: activeWorkspaceSymbolSelection?.path || null,
            });

            if (workspaceId && (parsedCommand.id === 'refs' || parsedCommand.id === 'definition' || parsedCommand.id === 'file')) {
                try {
                    if (parsedCommand.id === 'refs') {
                        const query = workspaceQuery || activeWorkspaceSymbolSelection?.name || activeWorkspaceSelection || '';
                        if (query) {
                            const references = await workspaceApi.searchWorkspaceReferences(workspaceId, query);
                            workspaceEvidenceBlock = formatWorkspaceEvidenceBlock({
                                workspaceName: activeWorkspace?.name || null,
                                currentFilePath: activeWorkspaceSelection,
                                currentSymbolName: activeWorkspaceSymbolSelection?.name || null,
                                currentSymbolPath: activeWorkspaceSymbolSelection?.path || null,
                                command: parsedCommand,
                                references,
                            });
                        }
                    } else if (parsedCommand.id === 'definition') {
                        const query = workspaceQuery || activeWorkspaceSymbolSelection?.name || activeWorkspaceSelection || '';
                        if (query) {
                            const symbols = await workspaceApi.searchWorkspaceDefinitions(workspaceId, query);
                            workspaceEvidenceBlock = formatWorkspaceEvidenceBlock({
                                workspaceName: activeWorkspace?.name || null,
                                currentFilePath: activeWorkspaceSelection,
                                currentSymbolName: activeWorkspaceSymbolSelection?.name || null,
                                currentSymbolPath: activeWorkspaceSymbolSelection?.path || null,
                                command: parsedCommand,
                                symbols,
                            });
                        }
                    } else if (parsedCommand.id === 'file') {
                        const targetPath = workspaceQuery || activeWorkspaceSelection || '';
                        if (targetPath) {
                            const fileContent = await workspaceApi.getWorkspaceFileContent(workspaceId, targetPath);
                            workspaceEvidenceBlock = formatWorkspaceEvidenceBlock({
                                workspaceName: activeWorkspace?.name || null,
                                currentFilePath: activeWorkspaceSelection,
                                currentSymbolName: activeWorkspaceSymbolSelection?.name || null,
                                currentSymbolPath: activeWorkspaceSymbolSelection?.path || null,
                                command: parsedCommand,
                                fileContent,
                            });
                        }
                    }
                } catch (error) {
                    console.error('Failed to resolve workspace command context', error);
                }
            }

            if (workspaceEvidenceBlock) {
                finalMessage = `${workspaceEvidenceBlock}\n\n---\n\n${finalMessage}`;
            }
        } else if (
            activeWorkspaceTextSelection?.text?.trim() &&
            activeWorkspaceTextSelection.path === activeWorkspaceSelection
        ) {
            finalMessage = `${formatEditorSelectionEvidenceBlock({
                filePath: activeWorkspaceTextSelection.path,
                selectedText: activeWorkspaceTextSelection.text,
                symbolName: activeWorkspaceSymbolSelection?.name || null,
            })}\n\n---\n\n${finalMessage}`;
        }

        if (selectedSkills.length > 0) {
            const skillBlocks = selectedSkills
                .map(s => `[Skill: ${s.name}]\n${s.content}`)
                .join('\n\n---\n\n');
            finalMessage = `${skillBlocks}\n\n---\n\n${finalMessage}`;
        }

        const contextRequest = workspaceId
            ? buildWorkspaceContextRequest({
                prompt: finalMessage,
                messages,
                workspaceId,
                selectedPaths,
                conversationId: activeSessionId,
            })
            : null;

        let workspaceContext = null;
        if (workspaceId && contextRequest) {
            try {
                workspaceContext = await workspaceApi.assembleContext(workspaceId, contextRequest);
            } catch (error) {
                console.error('Failed to assemble workspace context', error);
            }
        }

        sendMessage(finalMessage, searchEnabled, reasoningEnabled, workspaceContext);
        setInput('');
        setSelectedSkills([]);
    };

    const handleSessionChange = (id: string) => {
        setActiveSessionId(id);
    };

    //   console.log(isWaiting, "Is Waiting")
    //   console.log(isStreaming, "Is Streaming")

    return (
        <div className="flex h-[calc(100vh-56px)] gap-3">
            {/* Session List Sidebar */}
            <div className="relative shrink-0 glass rounded-sm flex flex-col overflow-hidden" style={{ width: chatSidebarWidth }}>
                <div className="px-2 py-1.5 border-b border-gruv-dark-4/20 flex items-center justify-between gap-2">
                    <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-gruv-light-4">
                        Threads
                    </span>
                    <button
                        onClick={() => createSession.mutate(`New Session ${sessions?.length || 0 + 1}`)}
                        className="inline-flex items-center justify-center gap-1 px-2 py-0.5 text-[10px] font-medium text-gruv-light-3 border border-gruv-dark-4 bg-transparent hover:bg-gruv-dark-3 rounded-sm transition-colors"
                    >
                        <Plus className="w-3 h-3" />
                        New
                    </button>
                </div>
                <div className="flex-grow overflow-y-auto p-1 flex flex-col gap-0.5">
                    {sessionsLoading ? (
                        <div className="flex justify-center p-6"><Loader2 className="animate-spin text-monokai-aqua w-4 h-4" /></div>
                    ) : (
                        sessions?.map(s => (
                            <button
                                key={s.id}
                                type="button"
                                onClick={() => handleSessionChange(s.id)}
                                className={clsx(
                                    "w-full px-2 py-1.5 rounded-sm cursor-pointer transition-all duration-150 group text-left",
                                    activeSessionId === s.id
                                        ? "bg-gruv-dark-3/90 text-gruv-light-1 border border-gruv-dark-4/60"
                                        : "text-gruv-light-4 hover:bg-gruv-dark-3/40 border border-transparent"
                                )}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className={clsx(
                                            "truncate text-[12px] leading-5",
                                            activeSessionId === s.id ? "font-medium text-gruv-light-1" : "font-normal text-gruv-light-3"
                                        )}>
                                            {s.name}
                                        </div>
                                        <div className="mt-0.5 text-[10px] text-gruv-gray truncate">
                                            {new Date(s.updated_at || s.created_at).toLocaleDateString(undefined, {
                                                month: 'short',
                                                day: 'numeric',
                                            })}
                                        </div>
                                    </div>
                                    <Trash2
                                        className="mt-0.5 w-3 h-3 opacity-0 group-hover:opacity-100 text-gruv-gray hover:text-monokai-pink transition-all shrink-0"
                                        onClick={(e) => { e.stopPropagation(); deleteSession.mutate(s.id); }}
                                    />
                                </div>
                            </button>
                        ))
                    )}
                </div>
                <div
                    role="separator"
                    aria-orientation="vertical"
                    className="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-transparent"
                    onPointerDown={(event) => {
                        chatSidebarResizeRef.current = {
                            startX: event.clientX,
                            startWidth: chatSidebarWidth,
                        };
                        document.body.style.cursor = 'col-resize';
                        document.body.style.userSelect = 'none';
                    }}
                >
                    <div className="absolute right-0 top-0 h-full w-px bg-gruv-dark-4/30" />
                </div>
            </div>

            {activeWorkspace && (
                <div
                    className="relative shrink-0 min-w-0"
                    style={{ width: workspaceRailWidth }}
                >
                    <ChatWorkspaceRail
                        workspace={activeWorkspace}
                        onOpenFile={() => setActiveSurfaceTab('code')}
                    />
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        className="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-transparent"
                        onPointerDown={(event) => {
                            workspaceRailResizeRef.current = {
                                startX: event.clientX,
                                startWidth: workspaceRailWidth,
                            };
                            document.body.style.cursor = 'col-resize';
                            document.body.style.userSelect = 'none';
                        }}
                    >
                        <div className="absolute right-0 top-0 h-full w-px bg-gruv-dark-4/30" />
                    </div>
                </div>
            )}

            {/* Main Chat Area */}
            <div className="flex-grow min-w-0 glass rounded-sm flex flex-col overflow-hidden">
                {!activeSessionId ? (
                    <div className="flex-grow flex flex-col items-center justify-center text-gruv-light-4 p-6 text-center">
                        <Bot className="w-12 h-12 mb-3 opacity-20" />
                        <h2 className="text-lg font-semibold text-gruv-light-2">Select a session to start</h2>
                        <p className="max-w-xs mt-1 text-[13px]">Choose an existing conversation from the left or create a new one.</p>
                    </div>
                ) : (
                    <>
                        <div className="px-3 py-1.5 border-b border-gruv-dark-4/20 flex justify-between items-center bg-gruv-dark-2/20">
                            <div className="flex items-center gap-2 min-w-0">
                                {isEditingName ? (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={editingNameValue}
                                            onChange={(e) => setEditingNameValue(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') updateSession.mutate({ id: activeSessionId!, name: editingNameValue });
                                                if (e.key === 'Escape') setIsEditingName(false);
                                            }}
                                            className="bg-gruv-dark-3 border border-monokai-aqua/50 rounded-sm px-2 py-1 text-[13px] text-monokai-aqua outline-none w-56"
                                            autoFocus
                                        />
                                        <button onClick={() => updateSession.mutate({ id: activeSessionId!, name: editingNameValue })} className="text-monokai-green hover:scale-110 transition-transform"><Check className="w-4 h-4" /></button>
                                        <button onClick={() => setIsEditingName(false)} className="text-monokai-red hover:scale-110 transition-transform"><X className="w-4 h-4" /></button>
                                    </div>
                                ) : (
                                    <h2
                                        className="text-[15px] font-semibold flex items-center gap-1.5 group cursor-pointer truncate"
                                        onClick={() => {
                                            setIsEditingName(true);
                                            setEditingNameValue(activeSession?.name || '');
                                        }}
                                    >
                                        {activeSession?.name}
                                        <Edit3 className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity shrink-0" />
                                    </h2>
                                )}
                                <div className="flex items-center gap-2 min-w-0">
                                    {chatError ? (
                                        <span className="text-[10px] text-monokai-red font-mono">Error: {chatError}</span>
                                    ) : (
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[9px] text-monokai-green font-mono uppercase tracking-wider opacity-60">Connected</span>
                                            <div className="w-1 h-1 rounded-full bg-gruv-dark-4" />
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="inline-flex rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-3/30 p-0.5">
                                    {(['chat', 'code', 'terminal'] as const).map((tab) => (
                                        <button
                                            key={tab}
                                            type="button"
                                            onClick={() => setActiveSurfaceTab(tab)}
                                            className={clsx(
                                                'px-2 py-1 text-[10px] font-mono uppercase tracking-[0.18em] rounded-sm transition-colors',
                                                activeSurfaceTab === tab
                                                    ? 'bg-gruv-dark-2 text-gruv-light-1'
                                                    : 'text-gruv-light-4 hover:text-gruv-light-2'
                                            )}
                                        >
                                            {tab}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    onClick={() => {
                                        setIsMetadataModalOpen(true);
                                        setMetadataValue(JSON.stringify(activeSession?.metadata || {}, null, 2));
                                    }}
                                    className="px-2 py-1 hover:bg-gruv-dark-3 rounded-sm transition-colors text-gruv-light-4 hover:text-monokai-aqua flex items-center gap-1.5 text-[11px]"
                                >
                                    <Settings className="w-3.5 h-3.5" />
                                    Metadata
                                </button>
                            </div>
                        </div>

                        <div className="px-3 py-2 flex flex-wrap items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest border-b border-gruv-dark-4/10">
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setIsWorkspaceDropdownOpen((current) => !current)}
                                    className={clsx(
                                        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border transition-colors",
                                        activeWorkspaceId
                                            ? "bg-monokai-aqua/10 text-monokai-aqua border-monokai-aqua/20"
                                            : "bg-gruv-dark-3 text-gruv-light-4 border-gruv-dark-4/40"
                                    )}
                                >
                                    <span className="max-w-[16rem] truncate">
                                        {activeWorkspaceId
                                            ? (workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.name || activeWorkspaceId)
                                            : 'No workspace'}
                                    </span>
                                    <ChevronDown className={clsx("w-2 h-2 transition-transform", isWorkspaceDropdownOpen && "rotate-180")} />
                                </button>

                                {isWorkspaceDropdownOpen && (
                                    <>
                                        <div
                                            className="fixed inset-0 z-40"
                                            onClick={() => setIsWorkspaceDropdownOpen(false)}
                                        />
                                        <div className="absolute left-0 top-full mt-1 z-50 min-w-[14rem] max-w-[18rem] overflow-hidden rounded-sm border border-gruv-dark-4 bg-gruv-dark-2 shadow-xl">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setActiveWorkspaceIdState(null);
                                                    setActiveWorkspaceId(null);
                                                    setIsWorkspaceDropdownOpen(false);
                                                }}
                                                className="w-full px-2 py-1.5 text-left text-[10px] text-gruv-light-4 hover:bg-gruv-dark-3 transition-colors"
                                            >
                                                No workspace
                                            </button>
                                            {workspaces.map((workspace) => (
                                                <button
                                                    key={workspace.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setActiveWorkspaceIdState(workspace.id);
                                                        setActiveWorkspaceId(workspace.id);
                                                        setIsWorkspaceDropdownOpen(false);
                                                    }}
                                                    className={clsx(
                                                        "w-full px-2 py-1.5 text-left text-[10px] transition-colors",
                                                        workspace.id === activeWorkspaceId
                                                            ? "bg-monokai-aqua/10 text-monokai-aqua"
                                                            : "text-gruv-light-3 hover:bg-gruv-dark-3 hover:text-gruv-light-1"
                                                    )}
                                                >
                                                    <div className="truncate">{workspace.name}</div>
                                                    <div className="truncate text-[9px] text-gruv-gray normal-case tracking-normal">{workspace.root_path}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="flex-grow min-h-0 px-3 py-3 flex flex-col gap-4 overflow-hidden">
                            {activeSurfaceTab === 'chat' ? (
                                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
                                    {messages.map((m, i) => (
                                        <div
                                            key={i}
                                            className={clsx(
                                                "flex gap-2.5 max-w-[86%]",
                                                m.role === 'user' ? "self-end flex-row-reverse" : "self-start"
                                            )}
                                        >
                                            <div className={clsx(
                                                "w-7 h-7 rounded-sm flex items-center justify-center shrink-0",
                                                m.role === 'user' ? "bg-gruv-dark-3" : "bg-monokai-pink/10 border border-monokai-pink/20"
                                            )}>
                                                {m.role === 'user' ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5 text-monokai-pink" />}
                                            </div>
                                            <div className={clsx(
                                                "px-3 py-2.5 rounded-sm text-[13px] leading-6 relative group/message",
                                                m.role === 'user' ? "bg-gruv-dark-3 text-gruv-light-1" : "bg-gruv-dark-2/50 border border-gruv-dark-4/30"
                                            )}>
                                                <button
                                                    onClick={() => {
                                                        const next = new Set(rawMessageIndices);
                                                        if (next.has(i)) next.delete(i);
                                                        else next.add(i);
                                                        setRawMessageIndices(next);
                                                    }}
                                                    className="absolute -top-2 right-0 opacity-0 group-hover/message:opacity-100 transition-opacity p-1 bg-gruv-dark-4 border border-gruv-dark-4/50 rounded-sm shadow-sm text-gruv-light-4 hover:text-monokai-aqua z-10"
                                                    title={rawMessageIndices.has(i) ? "Show Rendered" : "Show Raw"}
                                                >
                                                    {rawMessageIndices.has(i) ? <Eye className="w-3 h-3" /> : <Code className="w-3 h-3" />}
                                                </button>

                                                {rawMessageIndices.has(i) ? (
                                                    <pre className="whitespace-pre-wrap font-mono text-[12px] leading-5 text-gruv-light-3">
                                                        {m.content}
                                                    </pre>
                                                ) : (
                                                    <MarkdownContent content={m.content} />
                                                )}
                                            </div>
                                        </div>
                                    ))}

                                    {(isWaiting || isStreaming) && (
                                        <div className="flex gap-2.5 max-w-[85%] self-start animate-in fade-in slide-in-from-bottom-2 duration-300">
                                            <div className="w-7 h-7 rounded-sm flex items-center justify-center shrink-0 bg-monokai-aqua/10 border border-monokai-aqua/20 border-dashed animate-pulse">
                                                <Loader2 className="w-3.5 h-3.5 text-monokai-aqua animate-spin" />
                                            </div>
                                            <div className="px-3 py-2 rounded-sm text-[13px] leading-relaxed bg-gruv-dark-2/30 border border-gruv-dark-4/20 flex flex-col gap-2 min-w-[120px]">
                                                <div className="flex items-center justify-between gap-4">
                                                    <span className="text-monokai-aqua font-mono text-[10px] uppercase tracking-widest font-bold">
                                                        {status || (isStreaming ? 'Streaming...' : 'Thinking...')}
                                                    </span>
                                                </div>
                                                <div className="flex gap-1.5">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-monokai-aqua opacity-40 animate-bounce [animation-delay:-0.3s]" />
                                                    <span className="w-1.5 h-1.5 rounded-full bg-monokai-aqua opacity-60 animate-bounce [animation-delay:-0.15s]" />
                                                    <span className="w-1.5 h-1.5 rounded-full bg-monokai-aqua animate-bounce" />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    <div ref={messagesEndRef} />
                                </div>
                            ) : activeSurfaceTab === 'code' ? (
                                <div className="min-h-0 flex-1 overflow-hidden">
                                    <Suspense
                                        fallback={
                                            <div className="flex h-full items-center justify-center rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 text-[11px] text-gruv-light-4">
                                                Loading editor…
                                            </div>
                                        }
                                    >
                                        <WorkspaceStudio
                                            workspace={activeWorkspace}
                                            onInjectPrompt={injectPromptFromWorkspace}
                                            hideTree
                                        />
                                    </Suspense>
                                </div>
                            ) : (
                                <div className="min-h-0 flex flex-1 flex-col gap-2 overflow-hidden">
                                    <Suspense
                                        fallback={
                                            <div className="flex h-full items-center justify-center rounded-sm border border-gruv-dark-4/20 bg-[#161417] text-[11px] text-gruv-light-4">
                                                Loading terminal…
                                            </div>
                                        }
                                    >
                                        <TerminalStudio
                                            workspaceName={activeWorkspace?.name || null}
                                            desiredCwd={activeWorkspace?.root_path || null}
                                            onWorkspaceEvent={(event) => {
                                                queryClient.invalidateQueries({ queryKey: ['workspaces'] });
                                                setActiveWorkspaceIdState(event.workspaceId);
                                                setActiveWorkspaceId(event.workspaceId);
                                            }}
                                        />
                                    </Suspense>
                                </div>
                            )}
                        </div>

                        <div className="px-3 py-2 bg-gruv-dark-0/35 border-t border-gruv-dark-4/20">
                            {/* Selected skill pills */}
                            {selectedSkills.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                    {selectedSkills.map(skill => (
                                        <span
                                            key={skill.id}
                                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[10px] font-semibold bg-monokai-purple/15 text-monokai-purple border border-monokai-purple/40"
                                        >
                                            <BookOpen className="w-3 h-3" />
                                            {skill.name}
                                            <button
                                                type="button"
                                                onClick={() => setSelectedSkills(prev => prev.filter(s => s.id !== skill.id))}
                                                className="ml-0.5 hover:text-monokai-red transition-colors"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}

                            <div className="mb-2 flex items-center gap-2 overflow-x-auto">
                                <button
                                    type="button"
                                    onClick={() => setActiveSurfaceTab('code')}
                                    className="inline-flex items-center gap-1.5 rounded-sm border border-gruv-dark-4/40 bg-gruv-dark-3/30 px-2 py-1 text-[10px] text-gruv-light-3 hover:text-gruv-light-1"
                                >
                                    <Plus className="w-3 h-3" />
                                    Add files
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveSurfaceTab('terminal')}
                                    className="inline-flex items-center gap-1.5 rounded-sm border border-gruv-dark-4/40 bg-gruv-dark-3/30 px-2 py-1 text-[10px] text-gruv-light-3 hover:text-gruv-light-1"
                                >
                                    <Code className="w-3 h-3" />
                                    Terminal
                                </button>
                                {activeWorkspace && (
                                    <span className="inline-flex items-center rounded-sm border border-monokai-aqua/20 bg-monokai-aqua/10 px-2 py-1 text-[10px] text-monokai-aqua">
                                        {activeWorkspace.name}
                                    </span>
                                )}
                                {activeWorkspaceSelection && (
                                    <span className="inline-flex items-center rounded-sm border border-gruv-dark-4/40 bg-gruv-dark-3/30 px-2 py-1 text-[10px] text-gruv-light-3">
                                        {activeWorkspaceSelection}
                                    </span>
                                )}
                            </div>

                            {activeSurfaceTab === 'terminal' ? (
                                <div className="rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-3/30 px-3 py-2 text-[11px] text-gruv-light-4">
                                    <span className="text-gruv-light-2">Terminal input is direct.</span>
                                    <span className="ml-2">Type inside the terminal pane.</span>
                                    <span className="ml-2 text-monokai-aqua">Use `stepbit .` to load the current repo.</span>
                                </div>
                            ) : (
                                <div className="relative">
                                    {composerSuggestions.length > 0 && (
                                        <div className="mb-2 flex flex-wrap gap-1.5">
                                            {composerSuggestions.slice(0, 5).map((suggestion) => (
                                                <button
                                                    key={suggestion.id}
                                                    type="button"
                                                    onClick={() => applyComposerSuggestion(suggestion)}
                                                    className={clsx(
                                                        "flex items-center gap-2 px-2.5 py-1.5 rounded-sm border text-left transition-all",
                                                        activeComposerCommand?.id === suggestion.id
                                                            ? "bg-monokai-aqua/10 border-monokai-aqua text-monokai-aqua"
                                                            : "bg-gruv-dark-3 border-gruv-dark-4 text-gruv-light-4 hover:border-monokai-aqua/60 hover:text-gruv-light-1"
                                                    )}
                                                >
                                                    <div className="flex flex-col gap-0.5 min-w-0">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded-md bg-gruv-dark-2 border border-gruv-dark-4 shrink-0">
                                                                {suggestion.trigger}
                                                            </span>
                                                            <span className="text-[11px] font-semibold truncate">{suggestion.title}</span>
                                                        </div>
                                                        <span className="text-[10px] text-gruv-light-4 max-w-[22rem]">
                                                            {suggestion.description}
                                                        </span>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    <textarea
                                        ref={inputRef}
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Tab' && composerSuggestions.length > 0) {
                                                e.preventDefault();
                                                applyComposerSuggestion(composerSuggestions[0]);
                                                return;
                                            }

                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSend();
                                            }
                                        }}
                                        placeholder={selectedSkills.length > 0
                                            ? `Type your message… (${selectedSkills.length} skill${selectedSkills.length > 1 ? 's' : ''} will be prepended)`
                                            : "Type a message... Try /task, /refs, /definition, or /file"}
                                        className="w-full bg-gruv-dark-3 border border-gruv-dark-4 text-gruv-light-1 rounded-sm py-3 pl-3 pr-12 focus:outline-none focus:border-monokai-pink transition-colors resize-none min-h-[78px] text-[13px] leading-6"
                                    />
                                    <button
                                        onClick={handleSend}
                                        disabled={!input.trim() || (activeSurfaceTab === 'chat' && isStreaming)}
                                        className="absolute right-2 bottom-2 p-1.5 bg-monokai-pink text-white rounded-sm disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 transition-all shadow-sm"
                                    >
                                        <Send className="w-4 h-4" />
                                    </button>
                                    {activeSurfaceTab === 'chat' && (isWaiting || isStreaming) && (
                                        <button
                                            type="button"
                                            onClick={cancel}
                                            className="absolute right-12 bottom-2 p-1.5 rounded-sm border border-monokai-red/20 bg-monokai-red/10 text-monokai-red hover:bg-monokai-red/15 transition-colors"
                                            title="Cancel current task"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            )}
                            {activeSurfaceTab !== 'terminal' && activeComposerCommand && (
                                <div className="mt-2 px-2.5 py-2 rounded-sm bg-gruv-dark-3/40 border border-gruv-dark-4/30 text-[11px] text-gruv-light-4">
                                    <span className="font-mono text-monokai-aqua uppercase tracking-widest">{activeComposerCommand.trigger}</span>
                                    <span className="ml-2">{activeComposerCommand.description}</span>
                                    <span className="ml-2 text-gruv-light-2">
                                        Press Tab to insert the template.
                                    </span>
                                    {activeWorkspaceSelection && activeComposerCommand.id !== 'task' && (
                                        <div className="mt-2 text-[11px] text-gruv-light-3">
                                            Context: <span className="text-gruv-light-1 font-semibold">{activeWorkspaceSelection}</span>
                                        </div>
                                    )}
                                    {activeWorkspaceSymbolSelection && activeComposerCommand.id !== 'task' && (
                                        <div className="mt-1 text-[11px] text-gruv-light-3">
                                            Symbol: <span className="text-gruv-light-1 font-semibold">{activeWorkspaceSymbolSelection.name}</span>
                                            {activeWorkspaceSymbolSelection.path && activeWorkspaceSymbolSelection.path !== activeWorkspaceSelection && (
                                                <span className="text-gruv-light-4"> • {activeWorkspaceSymbolSelection.path}</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2 justify-between">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="relative">
                                        <button
                                            onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                                            className="flex items-center gap-1 text-[10px] font-mono text-monokai-aqua hover:text-monokai-aqua/80 transition-colors uppercase tracking-widest bg-monokai-aqua/5 px-2 py-1 rounded-sm border border-monokai-aqua/20"
                                        >
                                            {activeDetail?.active_model || 'Select Model'}
                                            <ChevronDown className={clsx("w-2 h-2 transition-transform", isModelDropdownOpen && "rotate-180")} />
                                        </button>

                                        {isModelDropdownOpen && activeDetail?.supported_models && (
                                            <>
                                                <div className="fixed inset-0 z-40" onClick={() => setIsModelDropdownOpen(false)} />
                                                <div className="absolute bottom-full left-0 mb-2 w-52 bg-gruv-dark-2 border border-gruv-dark-4 rounded-sm shadow-xl z-50 overflow-hidden py-1">
                                                    <div className="px-2 py-1.5 text-[9px] text-gruv-light-4 font-mono uppercase tracking-widest border-b border-gruv-dark-4/30 mb-1">
                                                        Switch Model
                                                    </div>
                                                    <div className="max-h-64 overflow-y-auto scrollbar-thin">
                                                        {activeDetail.supported_models.map(m => (
                                                            <button
                                                                key={m}
                                                                onClick={() => {
                                                                    selectModelMutation.mutate(m);
                                                                    setIsModelDropdownOpen(false);
                                                                }}
                                                                className={clsx(
                                                                    "w-full px-2 py-1.5 text-left text-[11px] flex items-center justify-between transition-colors",
                                                                    activeDetail.active_model === m
                                                                        ? "bg-monokai-aqua/10 text-monokai-aqua font-bold"
                                                                        : "text-gruv-light-3 hover:bg-gruv-dark-3 hover:text-gruv-light-1"
                                                                )}
                                                            >
                                                                <span className="truncate">{m}</span>
                                                                {activeDetail.active_model === m && <Check className="w-3 h-3" />}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    <button
                                        onClick={() => setSearchEnabled(!searchEnabled)}
                                        className={clsx(
                                            "flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[10px] font-mono transition-all border",
                                            searchEnabled
                                                ? "bg-monokai-aqua/10 border-monokai-aqua text-monokai-aqua shadow-[0_0_10px_rgba(102,217,239,0.2)]"
                                                : "bg-gruv-dark-3 border-gruv-dark-4 text-gruv-light-4 hover:border-gruv-light-4"
                                        )}
                                    >
                                        <Globe className={clsx("w-3 h-3", searchEnabled && "animate-pulse")} />
                                        SEARCH
                                    </button>

                                    <button
                                        onClick={() => setReasoningEnabled(!reasoningEnabled)}
                                        className={clsx(
                                            "flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[10px] font-mono transition-all border",
                                            reasoningEnabled
                                                ? "bg-monokai-pink/10 border-monokai-pink text-monokai-pink shadow-[0_0_10px_rgba(249,38,114,0.2)]"
                                                : "bg-gruv-dark-3 border-gruv-dark-4 text-gruv-light-4 hover:border-gruv-light-4"
                                        )}
                                    >
                                        <Brain className={clsx("w-3 h-3", reasoningEnabled && "animate-pulse")} />
                                        REASON
                                    </button>

                                    <SkillsSelector
                                        selected={selectedSkills}
                                        onChange={setSelectedSkills}
                                    />
                                </div>

                                <button
                                    type="button"
                                    onClick={() => setReasoningEnabled((current) => !current)}
                                    className="inline-flex items-center gap-1.5 rounded-sm border border-gruv-dark-4/40 bg-gruv-dark-3/30 px-2 py-1 text-[10px] text-gruv-light-4 hover:text-gruv-light-1"
                                    title="More actions"
                                >
                                    <Plus className="w-3 h-3" />
                                    More
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Metadata Modal */}
            {isMetadataModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-2xl glass rounded-3xl overflow-hidden shadow-2xl border border-gruv-dark-4/30">
                        <div className="p-6 border-b border-gruv-dark-4/20 flex justify-between items-center bg-gruv-dark-2/30">
                            <h3 className="font-bold flex items-center gap-2">
                                <Settings className="w-5 h-5 text-monokai-aqua" />
                                Session Metadata
                            </h3>
                            <button onClick={() => setIsMetadataModalOpen(false)} className="p-1 hover:bg-gruv-dark-4 rounded-lg transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6">
                            <textarea
                                value={metadataValue}
                                onChange={(e) => setMetadataValue(e.target.value)}
                                className="w-full h-96 bg-gruv-dark-3 border border-gruv-dark-4 rounded-2xl p-4 font-mono text-xs text-monokai-aqua leading-relaxed focus:outline-none focus:border-monokai-aqua transition-colors resize-none"
                                spellCheck={false}
                            />
                        </div>
                        <div className="p-6 border-t border-gruv-dark-4/20 flex justify-end gap-3 bg-gruv-dark-2/30">
                            <button onClick={() => setIsMetadataModalOpen(false)} className="px-5 py-2 hover:bg-gruv-dark-4 rounded-xl transition-colors text-sm font-semibold">Cancel</button>
                            <button
                                onClick={() => {
                                    try {
                                        const metadata = JSON.parse(metadataValue);
                                        updateSession.mutate({ id: activeSessionId!, metadata });
                                    } catch (e) {
                                        alert('Invalid JSON');
                                    }
                                }}
                                className="btn-primary px-5 py-2 text-sm"
                            >
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
