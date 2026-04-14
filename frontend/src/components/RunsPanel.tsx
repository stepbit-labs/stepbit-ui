import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Clock3, FileStack, ListFilter, PlayCircle, Workflow } from 'lucide-react';
import { clsx } from 'clsx';
import { executionsApi } from '../api/executions';
import { filterExecutionRuns } from '../lib/executionRuns';
import type { ExecutionKind, ExecutionRun, ExecutionStatus } from '../types';

const STATUS_FILTERS: Array<{ value: 'all' | ExecutionStatus; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

const KIND_FILTERS: Array<{ value: 'all' | ExecutionKind; label: string }> = [
  { value: 'all', label: 'All kinds' },
  { value: 'goal', label: 'Goal' },
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'reasoning', label: 'Reasoning' },
  { value: 'cron_job', label: 'Cron' },
  { value: 'trigger', label: 'Trigger' },
];

function formatExecutionTimestamp(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString();
}

function statusTone(status: ExecutionStatus) {
  switch (status) {
    case 'completed':
      return 'text-monokai-green border-monokai-green/20 bg-monokai-green/10';
    case 'failed':
      return 'text-monokai-red border-monokai-red/20 bg-monokai-red/10';
    case 'running':
      return 'text-monokai-aqua border-monokai-aqua/20 bg-monokai-aqua/10';
    case 'queued':
      return 'text-monokai-orange border-monokai-orange/20 bg-monokai-orange/10';
  }
}

function kindLabel(kind: ExecutionKind) {
  switch (kind) {
    case 'cron_job':
      return 'Cron';
    default:
      return kind.replace('_', ' ');
  }
}

function summaryLine(run: ExecutionRun) {
  if (run.summary) return run.summary;
  if (run.error) return run.error;
  return `${run.steps.length} steps, ${run.artifacts.length} artifacts`;
}

interface RunsPanelProps {
  selectedRunId?: string | null;
  onSelectRun?: (runId: string | null) => void;
}

export function RunsPanel({ selectedRunId: controlledSelectedRunId, onSelectRun }: RunsPanelProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | ExecutionStatus>('all');
  const [kindFilter, setKindFilter] = useState<'all' | ExecutionKind>('all');
  const [internalSelectedRunId, setInternalSelectedRunId] = useState<string | null>(null);
  const selectedRunId = controlledSelectedRunId ?? internalSelectedRunId;

  const runsQuery = useQuery({
    queryKey: ['executions'],
    queryFn: () => executionsApi.list(),
    refetchInterval: 15000,
  });

  const filteredRuns = useMemo(() => {
    return filterExecutionRuns(runsQuery.data || [], statusFilter, kindFilter);
  }, [kindFilter, runsQuery.data, statusFilter]);

  useEffect(() => {
    if (!filteredRuns.length) {
      setInternalSelectedRunId(null);
      onSelectRun?.(null);
      return;
    }

    if (!selectedRunId || !filteredRuns.some((run) => run.id === selectedRunId)) {
      const nextId = filteredRuns[0].id;
      setInternalSelectedRunId(nextId);
      onSelectRun?.(nextId);
    }
  }, [filteredRuns, onSelectRun, selectedRunId]);

  const selectedRunSummary = useMemo(
    () => filteredRuns.find((run) => run.id === selectedRunId) || null,
    [filteredRuns, selectedRunId],
  );

  const runDetailQuery = useQuery({
    queryKey: ['executions', selectedRunId],
    queryFn: () => executionsApi.get(selectedRunId!),
    enabled: Boolean(selectedRunId),
  });

  const runEventsQuery = useQuery({
    queryKey: ['executions', selectedRunId, 'events'],
    queryFn: () => executionsApi.listEvents(selectedRunId!),
    enabled: Boolean(selectedRunId),
  });

  const selectedRun = runDetailQuery.data || selectedRunSummary;

  if (runsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 text-[11px] text-gruv-light-4">
        Loading runs…
      </div>
    );
  }

  if (runsQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center rounded-sm border border-monokai-red/20 bg-monokai-red/5 text-[11px] text-monokai-red">
        Failed to load executions.
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] gap-3">
      <section className="flex min-h-0 flex-col rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-2/30">
        <div className="flex items-center justify-between gap-2 border-b border-gruv-dark-4/20 px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.18em] text-gruv-light-2">
            <Workflow className="h-3.5 w-3.5 text-monokai-aqua" />
            Runs
          </div>
          <div className="text-[10px] text-gruv-light-4">
            {filteredRuns.length} / {(runsQuery.data || []).length}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 border-b border-gruv-dark-4/20 px-3 py-2">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.16em] text-gruv-light-4">
            <span className="inline-flex items-center gap-1">
              <ListFilter className="h-3 w-3" />
              Status
            </span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | ExecutionStatus)}
              className="rounded-sm border border-gruv-dark-4/40 bg-gruv-dark-3 px-2 py-1 text-[11px] text-gruv-light-1 outline-none"
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.16em] text-gruv-light-4">
            <span className="inline-flex items-center gap-1">
              <FileStack className="h-3 w-3" />
              Kind
            </span>
            <select
              value={kindFilter}
              onChange={(event) => setKindFilter(event.target.value as 'all' | ExecutionKind)}
              className="rounded-sm border border-gruv-dark-4/40 bg-gruv-dark-3 px-2 py-1 text-[11px] text-gruv-light-1 outline-none"
            >
              {KIND_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {filteredRuns.length === 0 ? (
            <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-4 text-[11px] text-gruv-light-4">
              No runs match the current filters.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredRuns.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => {
                    setInternalSelectedRunId(run.id);
                    onSelectRun?.(run.id);
                  }}
                  className={clsx(
                    'w-full rounded-sm border px-3 py-2 text-left transition-colors',
                    selectedRunId === run.id
                      ? 'border-monokai-aqua/40 bg-monokai-aqua/10'
                      : 'border-gruv-dark-4/20 bg-gruv-dark-3/20 hover:border-gruv-light-4/20 hover:bg-gruv-dark-3/40',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-gruv-light-1">{run.title}</div>
                      <div className="mt-1 truncate text-[10px] text-gruv-light-4">{summaryLine(run)}</div>
                    </div>
                    <span className={clsx('rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em]', statusTone(run.status))}>
                      {run.status}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-gruv-light-4">
                    <span>{kindLabel(run.kind)}</span>
                    <span>•</span>
                    <span>{run.steps.length} steps</span>
                    <span>•</span>
                    <span>{run.artifacts.length} artifacts</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="min-h-0 overflow-y-auto rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-2/20 px-4 py-3">
        {!selectedRun ? (
          <div className="flex h-full items-center justify-center text-[11px] text-gruv-light-4">
            Select a run to inspect it.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-monokai-aqua">
                  Execution Detail
                </div>
                <h3 className="mt-1 text-[18px] font-semibold text-gruv-light-1">{selectedRun.title}</h3>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gruv-light-4">
                  <span className="inline-flex items-center gap-1">
                    <PlayCircle className="h-3.5 w-3.5" />
                    {kindLabel(selectedRun.kind)}
                  </span>
                  <span className={clsx('rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em]', statusTone(selectedRun.status))}>
                    {selectedRun.status}
                  </span>
                  <span>{selectedRun.id}</span>
                </div>
              </div>
              <div className="text-right text-[11px] text-gruv-light-4">
                <div className="inline-flex items-center gap-1">
                  <Clock3 className="h-3.5 w-3.5" />
                  Updated {formatExecutionTimestamp(selectedRun.updated_at)}
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-2">
                <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-gruv-light-4">Summary</div>
                <div className="mt-2 text-[12px] text-gruv-light-2">{selectedRun.summary || 'No summary yet.'}</div>
              </div>
              <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-2">
                <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-gruv-light-4">Links</div>
                <div className="mt-2 space-y-1 text-[11px] text-gruv-light-2">
                  {selectedRun.links?.goal_run_id && <div>goal: {selectedRun.links.goal_run_id}</div>}
                  {selectedRun.links?.response_id && <div>response: {selectedRun.links.response_id}</div>}
                  {selectedRun.links?.cron_job_id && <div>cron: {selectedRun.links.cron_job_id}</div>}
                  {selectedRun.links?.trigger_id && <div>trigger: {selectedRun.links.trigger_id}</div>}
                  {!selectedRun.links?.goal_run_id && !selectedRun.links?.response_id && !selectedRun.links?.cron_job_id && !selectedRun.links?.trigger_id && (
                    <div className="text-gruv-light-4">No linked entities.</div>
                  )}
                </div>
              </div>
              <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-2">
                <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-gruv-light-4">Counts</div>
                <div className="mt-2 space-y-1 text-[11px] text-gruv-light-2">
                  <div>{selectedRun.steps.length} steps</div>
                  <div>{selectedRun.artifacts.length} artifacts</div>
                  <div>{runEventsQuery.data?.length || 0} events</div>
                </div>
              </div>
            </div>

            {selectedRun.error && (
              <div className="rounded-sm border border-monokai-red/20 bg-monokai-red/5 px-3 py-2 text-[12px] text-monokai-red">
                <div className="inline-flex items-center gap-1 font-mono uppercase tracking-[0.16em] text-[10px]">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Error
                </div>
                <div className="mt-2 whitespace-pre-wrap">{selectedRun.error}</div>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-gruv-light-3">Steps</div>
                <div className="space-y-2">
                  {selectedRun.steps.length === 0 ? (
                    <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-3 text-[11px] text-gruv-light-4">
                      No steps recorded.
                    </div>
                  ) : selectedRun.steps.map((step) => (
                    <div key={step.id} className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[12px] font-semibold text-gruv-light-1">{step.title}</div>
                        <span className={clsx('rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em]', statusTone(step.status as ExecutionStatus))}>
                          {step.status}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-gruv-light-4">{step.kind}</div>
                      {step.summary && <div className="mt-2 text-[11px] text-gruv-light-2">{step.summary}</div>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-gruv-light-3">Artifacts</div>
                <div className="space-y-2">
                  {selectedRun.artifacts.length === 0 ? (
                    <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-3 text-[11px] text-gruv-light-4">
                      No artifacts recorded.
                    </div>
                  ) : selectedRun.artifacts.map((artifact) => (
                    <div key={artifact.id} className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[12px] font-semibold text-gruv-light-1">{artifact.title}</div>
                        <span className="rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-2 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-gruv-light-3">
                          {artifact.family}
                        </span>
                      </div>
                      {artifact.source && <div className="mt-1 text-[11px] text-gruv-light-4">{artifact.source}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-gruv-light-3">Timeline</div>
              {runEventsQuery.isLoading ? (
                <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-3 text-[11px] text-gruv-light-4">
                  Loading events…
                </div>
              ) : runEventsQuery.isError ? (
                <div className="rounded-sm border border-monokai-red/20 bg-monokai-red/5 px-3 py-3 text-[11px] text-monokai-red">
                  Failed to load events.
                </div>
              ) : !runEventsQuery.data?.length ? (
                <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-3 text-[11px] text-gruv-light-4">
                  No events recorded.
                </div>
              ) : (
                <div className="space-y-2">
                  {runEventsQuery.data.map((event) => (
                    <div key={event.id} className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[12px] font-semibold text-gruv-light-1">{event.event_type}</div>
                        <div className="text-[10px] text-gruv-light-4">{formatExecutionTimestamp(event.timestamp)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
