import type { ExecutionKind, ExecutionRun, ExecutionStatus } from '../types';

export function filterExecutionRuns(
  runs: ExecutionRun[],
  statusFilter: 'all' | ExecutionStatus,
  kindFilter: 'all' | ExecutionKind,
) {
  return runs.filter((run) => {
    if (statusFilter !== 'all' && run.status !== statusFilter) return false;
    if (kindFilter !== 'all' && run.kind !== kindFilter) return false;
    return true;
  });
}
