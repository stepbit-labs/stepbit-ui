import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, PlayCircle, Power, PowerOff, RefreshCcw, Siren, Trash2, Workflow } from 'lucide-react';
import { clsx } from 'clsx';
import { automationsApi } from '../api/automations';
import type { CronJob, RecentAutomationEvent, TriggerDefinition } from '../types';

function formatUnixTimestamp(timestamp?: number | null) {
  if (!timestamp) return 'n/a';
  return new Date(timestamp * 1000).toLocaleString();
}

function triggerActionLabel(trigger: TriggerDefinition) {
  if ('Goal' in trigger.action) return 'Goal';
  if ('Pipeline' in trigger.action) return 'Pipeline';
  if ('ReasoningGraph' in trigger.action) return 'Reasoning';
  return 'Unknown';
}

function eventSummary(event: RecentAutomationEvent) {
  if (event.related_execution_id) return `execution ${event.related_execution_id}`;
  if (event.related_cron_job_id) return `cron ${event.related_cron_job_id}`;
  if (event.related_trigger_id) return `trigger ${event.related_trigger_id}`;
  return 'unlinked event';
}

interface AutomationsPanelProps {
  onOpenRun?: (runId: string) => void;
}

export function AutomationsPanel({ onOpenRun }: AutomationsPanelProps) {
  const queryClient = useQueryClient();

  const cronStatusQuery = useQuery({
    queryKey: ['automations', 'cron-status'],
    queryFn: () => automationsApi.getCronStatus(),
    refetchInterval: 15000,
  });

  const cronJobsQuery = useQuery({
    queryKey: ['automations', 'cron-jobs'],
    queryFn: () => automationsApi.listCronJobs(),
    refetchInterval: 15000,
  });

  const triggersQuery = useQuery({
    queryKey: ['automations', 'triggers'],
    queryFn: () => automationsApi.listTriggers(),
    refetchInterval: 15000,
  });

  const eventsQuery = useQuery({
    queryKey: ['automations', 'recent-events'],
    queryFn: () => automationsApi.listRecentEvents(20),
    refetchInterval: 10000,
  });

  const triggerCronMutation = useMutation({
    mutationFn: (jobId: string) => automationsApi.triggerCronJob(jobId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['automations', 'recent-events'] });
      queryClient.invalidateQueries({ queryKey: ['executions'] });
      if (result.run_id) {
        onOpenRun?.(result.run_id);
      }
    },
  });

  const enableCronMutation = useMutation({
    mutationFn: (jobId: string) => automationsApi.enableCronJob(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations', 'cron-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['automations', 'cron-status'] });
      queryClient.invalidateQueries({ queryKey: ['automations', 'recent-events'] });
    },
  });

  const disableCronMutation = useMutation({
    mutationFn: (jobId: string) => automationsApi.disableCronJob(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations', 'cron-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['automations', 'cron-status'] });
      queryClient.invalidateQueries({ queryKey: ['automations', 'recent-events'] });
    },
  });

  const deleteCronMutation = useMutation({
    mutationFn: (jobId: string) => automationsApi.deleteCronJob(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations', 'cron-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['automations', 'cron-status'] });
    },
  });

  const deleteTriggerMutation = useMutation({
    mutationFn: (triggerId: string) => automationsApi.deleteTrigger(triggerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations', 'triggers'] });
      queryClient.invalidateQueries({ queryKey: ['automations', 'recent-events'] });
    },
  });

  const failingJobs = useMemo(
    () => (cronJobsQuery.data || []).filter((job) => job.failure_count > 0),
    [cronJobsQuery.data],
  );

  if (cronStatusQuery.isLoading || cronJobsQuery.isLoading || triggersQuery.isLoading || eventsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 text-[11px] text-gruv-light-4">
        Loading automations…
      </div>
    );
  }

  if (cronStatusQuery.isError || cronJobsQuery.isError || triggersQuery.isError || eventsQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center rounded-sm border border-monokai-red/20 bg-monokai-red/5 text-[11px] text-monokai-red">
        Failed to load automations.
      </div>
    );
  }

  const cronStatus = cronStatusQuery.data!;
  const cronJobs = cronJobsQuery.data || [];
  const triggers = triggersQuery.data || [];
  const events = eventsQuery.data || [];

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)] gap-3">
      <section className="flex min-h-0 flex-col gap-3">
        <div className="rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-2/20 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.18em] text-monokai-aqua">
            <CalendarClock className="h-4 w-4" />
            Scheduler
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-[12px] text-gruv-light-2">
            <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-gruv-light-4">Status</div>
              <div className={clsx('mt-1 font-semibold', cronStatus.scheduler_running ? 'text-monokai-green' : 'text-monokai-red')}>
                {cronStatus.scheduler_running ? 'Running' : 'Stopped'}
              </div>
            </div>
            <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-gruv-light-4">Jobs</div>
              <div className="mt-1 font-semibold text-gruv-light-1">{cronStatus.total_jobs}</div>
            </div>
            <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-gruv-light-4">Failing</div>
              <div className="mt-1 font-semibold text-monokai-orange">{cronStatus.failing_jobs}</div>
            </div>
            <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-gruv-light-4">Retrying</div>
              <div className="mt-1 font-semibold text-monokai-aqua">{cronStatus.retrying_jobs}</div>
            </div>
          </div>
        </div>

        <div className="min-h-0 rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-2/20">
          <div className="flex items-center justify-between border-b border-gruv-dark-4/20 px-4 py-2">
            <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-gruv-light-2">Cron Jobs</div>
            <div className="text-[10px] text-gruv-light-4">{cronJobs.length}</div>
          </div>
          <div className="max-h-[26rem] overflow-y-auto px-3 py-3">
            <div className="space-y-2">
              {cronJobs.map((job: CronJob) => (
                <div key={job.id} className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-gruv-light-1">{job.id}</div>
                      <div className="mt-1 text-[11px] text-gruv-light-4">{job.schedule}</div>
                      <div className="mt-1 text-[11px] text-gruv-light-4">{job.execution_type}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className={clsx(
                          'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em]',
                          job.enabled
                            ? 'border-monokai-green/20 bg-monokai-green/10 text-monokai-green'
                            : 'border-gruv-dark-4/40 bg-gruv-dark-4/20 text-gruv-light-4',
                        )}
                      >
                        {job.enabled ? <Power className="h-3 w-3" /> : <PowerOff className="h-3 w-3" />}
                        {job.enabled ? 'enabled' : 'disabled'}
                      </span>
                      {job.failure_count > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-sm border border-monokai-orange/20 bg-monokai-orange/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-monokai-orange">
                          <AlertTriangle className="h-3 w-3" />
                          {job.failure_count} failures
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-[11px] text-gruv-light-3">
                    <div>Last run: {formatUnixTimestamp(job.last_run_at)}</div>
                    <div>Next retry: {formatUnixTimestamp(job.next_retry_at)}</div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => triggerCronMutation.mutate(job.id)}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-monokai-aqua/20 bg-monokai-aqua/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-monokai-aqua"
                      title={job.enabled ? 'Run this job immediately' : 'Manual run is available even while automatic scheduling is disabled'}
                    >
                      <PlayCircle className="h-3 w-3" />
                      Run Now
                    </button>
                    {job.enabled ? (
                      <button
                        type="button"
                        onClick={() => disableCronMutation.mutate(job.id)}
                        className="inline-flex items-center gap-1.5 rounded-sm border border-gruv-light-4/20 bg-gruv-dark-4/20 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-gruv-light-3"
                      >
                        <PowerOff className="h-3 w-3" />
                        Disable
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => enableCronMutation.mutate(job.id)}
                        className="inline-flex items-center gap-1.5 rounded-sm border border-monokai-green/20 bg-monokai-green/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-monokai-green"
                      >
                        <Power className="h-3 w-3" />
                        Enable
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteCronMutation.mutate(job.id)}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-monokai-red/20 bg-monokai-red/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-monokai-red"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {cronJobs.length === 0 && (
                <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20 px-3 py-4 text-[11px] text-gruv-light-4">
                  No cron jobs registered.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="min-h-0 space-y-3 overflow-y-auto rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-2/20 px-4 py-3">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20">
            <div className="flex items-center justify-between border-b border-gruv-dark-4/20 px-3 py-2">
              <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-gruv-light-2">Triggers</div>
              <div className="text-[10px] text-gruv-light-4">{triggers.length}</div>
            </div>
            <div className="space-y-2 px-3 py-3">
              {triggers.map((trigger) => (
                <div key={trigger.id} className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-gruv-light-1">{trigger.id}</div>
                      <div className="mt-1 text-[11px] text-gruv-light-4">{trigger.event_type}</div>
                      <div className="mt-1 text-[11px] text-gruv-light-4">Action: {triggerActionLabel(trigger)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteTriggerMutation.mutate(trigger.id)}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-monokai-red/20 bg-monokai-red/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-monokai-red"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {triggers.length === 0 && (
                <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 px-3 py-4 text-[11px] text-gruv-light-4">
                  No triggers registered.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20">
            <div className="flex items-center justify-between border-b border-gruv-dark-4/20 px-3 py-2">
              <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-gruv-light-2">Health Notes</div>
              <Siren className="h-4 w-4 text-monokai-orange" />
            </div>
            <div className="space-y-2 px-3 py-3 text-[11px] text-gruv-light-3">
              <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 px-3 py-2">
                Scheduler: {cronStatus.scheduler_running ? 'online and dispatching jobs' : 'offline, jobs will not execute automatically'}
              </div>
              <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 px-3 py-2">
                Failing jobs: {failingJobs.length > 0 ? failingJobs.map((job) => job.id).join(', ') : 'none'}
              </div>
              <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 px-3 py-2">
                Recent events feed shows execution-linked automation activity and can bridge into Runs.
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-3/20">
          <div className="flex items-center justify-between border-b border-gruv-dark-4/20 px-3 py-2">
            <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.18em] text-gruv-light-2">
              <RefreshCcw className="h-4 w-4 text-monokai-aqua" />
              Recent Events
            </div>
            <div className="text-[10px] text-gruv-light-4">{events.length}</div>
          </div>
          <div className="space-y-2 px-3 py-3">
            {events.map((event: RecentAutomationEvent) => (
              <div key={event.id} className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-gruv-light-1">{event.event_type}</div>
                    <div className="mt-1 text-[11px] text-gruv-light-4">{eventSummary(event)}</div>
                    <div className="mt-1 text-[10px] text-gruv-light-4">{new Date(event.timestamp).toLocaleString()}</div>
                  </div>
                  {event.related_execution_id && (
                    <button
                      type="button"
                      onClick={() => onOpenRun?.(event.related_execution_id!)}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-monokai-aqua/20 bg-monokai-aqua/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-monokai-aqua"
                    >
                      <Workflow className="h-3 w-3" />
                      Open Run
                    </button>
                  )}
                </div>
              </div>
            ))}
            {events.length === 0 && (
              <div className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 px-3 py-4 text-[11px] text-gruv-light-4">
                No recent automation events.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
