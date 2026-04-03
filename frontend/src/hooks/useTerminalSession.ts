import { useEffect, useRef, useState } from 'react';
import { terminalApi, type TerminalWorkspaceEvent } from '../api/terminal';

interface UseTerminalSessionOptions {
  desiredCwd: string | null;
  onWorkspaceEvent?: (event: TerminalWorkspaceEvent) => void;
}

interface TerminalFrame {
  resetKey: number;
  chunk: string;
}

export function useTerminalSession({
  desiredCwd,
  onWorkspaceEvent,
}: UseTerminalSessionOptions) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<TerminalFrame>({ resetKey: 0, chunk: '' });

  const sessionIdRef = useRef<string | null>(null);
  const cursorRef = useRef(0);
  const desiredKeyRef = useRef<string | null>(null);
  const pollHandleRef = useRef<number | null>(null);
  const onWorkspaceEventRef = useRef<typeof onWorkspaceEvent>(onWorkspaceEvent);

  useEffect(() => {
    onWorkspaceEventRef.current = onWorkspaceEvent;
  }, [onWorkspaceEvent]);

  useEffect(() => {
    let cancelled = false;

    const stopPolling = () => {
      if (pollHandleRef.current !== null) {
        window.clearInterval(pollHandleRef.current);
        pollHandleRef.current = null;
      }
    };

    const closePrevious = async () => {
      stopPolling();
      const previousSessionId = sessionIdRef.current;
      if (!previousSessionId) {
        return;
      }

      sessionIdRef.current = null;
      setSessionId(null);
      try {
        await terminalApi.closeSession(previousSessionId);
      } catch (closeError) {
        console.error('Failed to close terminal session', closeError);
      }
    };

    const startPolling = (nextSessionId: string) => {
      const poll = async () => {
        try {
          const chunk = await terminalApi.readOutput(nextSessionId, cursorRef.current);
          if (cancelled || sessionIdRef.current !== nextSessionId) {
            return;
          }

          cursorRef.current = chunk.cursor;
          setCwd(chunk.cwd);

          if (chunk.workspaceEvent) {
            onWorkspaceEventRef.current?.(chunk.workspaceEvent);
          }

          if (chunk.output) {
            setFrame((current) => ({
              resetKey: current.resetKey,
              chunk: chunk.output,
            }));
          }
        } catch (pollError) {
          if (!cancelled) {
            console.error('Failed to read terminal output', pollError);
            setError('Failed to read terminal output');
          }
        }
      };

      void poll();
      pollHandleRef.current = window.setInterval(() => {
        void poll();
      }, 180);
    };

    const boot = async () => {
      const desiredKey = desiredCwd || '__backend_default__';
      if (desiredKeyRef.current === desiredKey && sessionIdRef.current) {
        return;
      }

      setIsLoading(true);
      setError(null);
      await closePrevious();

      try {
        const session = await terminalApi.createSession(desiredCwd);
        if (cancelled) {
          await terminalApi.closeSession(session.id).catch(() => undefined);
          return;
        }

        desiredKeyRef.current = desiredKey;
        sessionIdRef.current = session.id;
        cursorRef.current = 0;
        setSessionId(session.id);
        setCwd(session.cwd);
        setFrame((current) => ({ resetKey: current.resetKey + 1, chunk: '' }));
        startPolling(session.id);
      } catch (bootError) {
        if (!cancelled) {
          console.error('Failed to create terminal session', bootError);
          desiredKeyRef.current = null;
          sessionIdRef.current = null;
          setSessionId(null);
          setCwd(null);
          setError('Failed to start shell');
          setFrame((current) => ({ resetKey: current.resetKey + 1, chunk: '' }));
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
      stopPolling();
    };
  }, [desiredCwd]);

  useEffect(() => {
    return () => {
      const currentSessionId = sessionIdRef.current;
      if (currentSessionId) {
        void terminalApi.closeSession(currentSessionId).catch(() => undefined);
      }
    };
  }, []);

  return {
    sessionId,
    cwd,
    isLoading,
    isReady: Boolean(sessionId),
    error,
    outputChunk: frame.chunk,
    resetKey: frame.resetKey,
    async sendInput(input: string) {
      if (!sessionIdRef.current) {
        return;
      }
      await terminalApi.sendInput(sessionIdRef.current, input);
    },
    async interrupt() {
      if (!sessionIdRef.current) {
        return;
      }
      await terminalApi.interrupt(sessionIdRef.current);
    },
  };
}
