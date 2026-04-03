import { useEffect, useRef, useState } from 'react';
import { Loader2, Minus, Square, TerminalSquare } from 'lucide-react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { terminalApi, type TerminalWorkspaceEvent } from '../api/terminal';
import 'xterm/css/xterm.css';

export function TerminalStudio({
  workspaceName,
  desiredCwd,
  onWorkspaceEvent,
}: {
  workspaceName: string | null;
  desiredCwd: string | null;
  onWorkspaceEvent?: (event: TerminalWorkspaceEvent) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onWorkspaceEventRef = useRef<typeof onWorkspaceEvent>(onWorkspaceEvent);
  const sessionIdRef = useRef<string | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const desiredKeyRef = useRef<string | null>(null);
  const resizeHandleRef = useRef<number | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);

  const [cwd, setCwd] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizePath = (value: string | null | undefined) =>
    (value || '').trim().replace(/[\\/]+$/, '');

  const safeFit = () => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const host = hostRef.current;
    if (!terminal || !fitAddon || !host || !terminal.element || !host.isConnected) {
      return;
    }
    if (host.clientWidth === 0 || host.clientHeight === 0) {
      return;
    }
    try {
      fitAddon.fit();
    } catch (fitError) {
      console.debug('Skipped unsafe terminal fit', fitError);
    }
  };

  useEffect(() => {
    onWorkspaceEventRef.current = onWorkspaceEvent;
  }, [onWorkspaceEvent]);

  useEffect(() => {
    if (!hostRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      disableStdin: false,
      fontFamily: '"SF Mono", "Monaco", "Menlo", "Consolas", monospace',
      fontSize: 12,
      lineHeight: 1.45,
      letterSpacing: 0.2,
      theme: {
        background: '#161417',
        foreground: '#e8dfcf',
        cursor: '#66d9ef',
        cursorAccent: '#161417',
        selectionBackground: 'rgba(102, 217, 239, 0.20)',
        black: '#191718',
        red: '#f92672',
        green: '#a6e22e',
        yellow: '#e6db74',
        blue: '#66d9ef',
        magenta: '#ae81ff',
        cyan: '#66d9ef',
        white: '#f8f8f2',
        brightBlack: '#62584f',
        brightRed: '#ff5c8a',
        brightGreen: '#b8f45a',
        brightYellow: '#fff27a',
        brightBlue: '#8be9fd',
        brightMagenta: '#caa9fa',
        brightCyan: '#8be9fd',
        brightWhite: '#fffaf0',
      },
      scrollback: 5000,
      allowTransparency: false,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    safeFit();
    terminal.focus();
    terminal.onData((value) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      ws.send(JSON.stringify({ type: 'input', input: value }));
    });

    const handleResize = () => safeFit();
    window.addEventListener('resize', handleResize);

    const observer = new ResizeObserver(() => {
      safeFit();

      if (resizeHandleRef.current !== null) {
        window.clearTimeout(resizeHandleRef.current);
      }

      resizeHandleRef.current = window.setTimeout(() => {
        resizeHandleRef.current = null;
        const activeSessionId = sessionIdRef.current;
        if (!activeSessionId) {
          return;
        }

        const cols = terminal.cols;
        const rows = terminal.rows;
        const previous = lastSizeRef.current;
        if (previous && previous.cols === cols && previous.rows === rows) {
          return;
        }

        lastSizeRef.current = { cols, rows };
        void terminalApi.resizeSession(activeSessionId, cols, rows).catch((resizeError) => {
          console.error('Failed to resize terminal session', resizeError);
        });
      }, 50);
    });
    observer.observe(hostRef.current);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      if (resizeHandleRef.current !== null) {
        window.clearTimeout(resizeHandleRef.current);
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    safeFit();
  }, [cwd, isLoading, isReady]);

  useEffect(() => {
    let cancelled = false;

    const stopStreaming = () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };

    const closePrevious = async () => {
      stopStreaming();
      const previousSessionId = sessionIdRef.current;
      if (!previousSessionId) {
        return;
      }
      sessionIdRef.current = null;
      sessionTokenRef.current = null;
      setIsReady(false);
      try {
        await terminalApi.closeSession(previousSessionId);
      } catch (closeError) {
        console.error('Failed to close terminal session', closeError);
      }
    };

    const startStreaming = (nextSessionId: string, sessionToken: string) => {
      const host = import.meta.env.VITE_WS_BASE_URL || window.location.host;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const base = host.startsWith('ws://') || host.startsWith('wss://')
        ? host
        : `${protocol}//${host}`;
      const wsUrl = `${base}/ws/terminal/${nextSessionId}?terminal_token=${encodeURIComponent(sessionToken)}`.replace(/([^:]\/)\/+/g, '$1');
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (cancelled || sessionIdRef.current !== nextSessionId) {
          return;
        }
        try {
          const payload = JSON.parse(event.data) as {
            output: string;
            cwd: string;
            workspaceEvent?: TerminalWorkspaceEvent | null;
          };
          setCwd(payload.cwd);
          if (payload.workspaceEvent) {
            onWorkspaceEventRef.current?.(payload.workspaceEvent);
          }
          if (payload.output) {
            terminalRef.current?.write(payload.output);
          }
        } catch (parseError) {
          console.error('Failed to parse terminal event', parseError);
        }
      };

      ws.onerror = () => {
        if (!cancelled) {
          setError('Terminal stream disconnected');
        }
      };

      ws.onclose = () => {
        if (!cancelled && sessionIdRef.current === nextSessionId) {
          setIsReady(false);
        }
      };
    };

    const boot = async () => {
      const desiredKey = desiredCwd || '__backend_default__';
      if (sessionIdRef.current) {
        const normalizedDesired = normalizePath(desiredCwd);
        const normalizedCurrent = normalizePath(cwd);
        if (desiredKeyRef.current === desiredKey || (normalizedDesired && normalizedDesired === normalizedCurrent)) {
          desiredKeyRef.current = desiredKey;
          return;
        }
      }
      if (desiredKeyRef.current === desiredKey && sessionIdRef.current) {
        return;
      }

      setIsLoading(true);
      setError(null);
      await closePrevious();

      try {
        terminalRef.current?.clear();
        const session = await terminalApi.createSession(desiredCwd);
        if (cancelled) {
          await terminalApi.closeSession(session.id).catch(() => undefined);
          return;
        }

        desiredKeyRef.current = desiredKey;
        sessionIdRef.current = session.id;
        sessionTokenRef.current = session.sessionToken;
        lastSizeRef.current = null;
        setCwd(session.cwd);
        setIsReady(true);
        try {
          const initialChunk = await terminalApi.readOutput(session.id, 0);
          if (!cancelled) {
            setCwd(initialChunk.cwd);
            if (initialChunk.workspaceEvent) {
              onWorkspaceEventRef.current?.(initialChunk.workspaceEvent);
            }
            if (initialChunk.output) {
              terminalRef.current?.write(initialChunk.output);
            }
          }
        } catch (initialError) {
          console.error('Failed to read initial terminal output', initialError);
        }
        startStreaming(session.id, session.sessionToken);
        requestAnimationFrame(() => {
          safeFit();
          const terminal = terminalRef.current;
          if (terminal) {
            lastSizeRef.current = { cols: terminal.cols, rows: terminal.rows };
            void terminalApi.resizeSession(session.id, terminal.cols, terminal.rows).catch((resizeError) => {
              console.error('Failed to resize terminal session', resizeError);
            });
            terminal.focus();
          }
        });
      } catch (bootError) {
        if (!cancelled) {
          console.error('Failed to create terminal session', bootError);
          desiredKeyRef.current = null;
          sessionIdRef.current = null;
          setIsReady(false);
          setCwd(null);
          setError('Failed to start shell');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
      stopStreaming();
    };
  }, [desiredCwd]);

  useEffect(() => {
    return () => {
      const activeSessionId = sessionIdRef.current;
      if (activeSessionId) {
        void terminalApi.closeSession(activeSessionId).catch(() => undefined);
      }
    };
  }, []);

  const handleInterrupt = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify({ type: 'interrupt' }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-sm border border-gruv-dark-4/20 bg-[#161417] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <div className="flex items-center justify-between gap-3 border-b border-gruv-dark-4/20 bg-[#1c1a1d] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
          <div className="ml-2 flex min-w-0 items-center gap-2">
            <TerminalSquare className="h-3.5 w-3.5 text-gruv-light-4" />
            <span className="truncate text-[11px] font-medium text-gruv-light-2">
              {workspaceName || 'Local terminal'}
            </span>
            <span className="truncate text-[10px] text-gruv-light-4">
              {cwd}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {error ? (
            <div className="inline-flex items-center gap-1 text-[10px] text-monokai-red">
              {error}
            </div>
          ) : !isReady && isLoading ? (
            <div className="inline-flex items-center gap-1 text-[10px] text-gruv-light-4">
              <Loader2 className="h-3 w-3 animate-spin" />
              Starting shell
            </div>
          ) : (
            <div className="inline-flex items-center gap-1 text-[10px] text-gruv-light-4">
              <Minus className="h-3 w-3" />
              Live
            </div>
          )}
          <button
            type="button"
            onClick={handleInterrupt}
            disabled={!isReady}
            className="inline-flex items-center gap-1 rounded-sm border border-gruv-dark-4/40 px-2 py-1 text-[10px] text-gruv-light-4 hover:bg-gruv-dark-3/60 disabled:opacity-40"
          >
            <Square className="h-3 w-3" />
            Stop
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-[#161417] px-1 py-1">
        <div
          ref={hostRef}
          className="h-full w-full overflow-hidden rounded-sm"
          onMouseDown={() => requestAnimationFrame(() => terminalRef.current?.focus())}
        />
        {!cwd && !isLoading && !isReady && (
          <div className="absolute inset-1 flex items-center justify-center rounded-sm bg-[#161417] text-sm text-gruv-light-4">
            Launch a terminal to start working here.
          </div>
        )}
        {isLoading && !isReady && (
          <div className="absolute inset-1 flex items-center justify-center rounded-sm bg-[#161417] text-[11px] text-gruv-light-4">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Launching shell…
          </div>
        )}
      </div>
    </div>
  );
}
