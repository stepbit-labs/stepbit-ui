import { bench, describe } from 'vitest';
import { filterExecutionRuns } from './executionRuns';
import type { ExecutionRun } from '../types';

const syntheticRuns: ExecutionRun[] = Array.from({ length: 100 }, (_, index) => ({
  id: `exec-${index}`,
  kind: index % 4 === 0 ? 'pipeline' : index % 3 === 0 ? 'reasoning' : 'goal',
  parent_id: null,
  title: `Run ${index}`,
  status: index % 5 === 0 ? 'failed' : index % 2 === 0 ? 'completed' : 'running',
  created_at: index,
  updated_at: index + 1,
  summary: null,
  results: null,
  error: index % 5 === 0 ? 'failed' : null,
  tags: [],
  links: {},
  steps: [],
  artifacts: [],
}));

describe('filterExecutionRuns', () => {
  bench('filters 100 runs by failed status', () => {
    filterExecutionRuns(syntheticRuns, 'failed', 'all');
  });

  bench('filters 100 runs by pipeline kind', () => {
    filterExecutionRuns(syntheticRuns, 'all', 'pipeline');
  });
});
