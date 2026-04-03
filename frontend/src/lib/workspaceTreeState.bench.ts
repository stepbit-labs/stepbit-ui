import { bench, describe } from 'vitest';
import {
  expandedPathsForWorkspace,
  setWorkspaceTreeExpandedPaths,
  toggleTreePath,
  type WorkspaceTreeExpandedState,
} from './workspaceTreeState';

const state: WorkspaceTreeExpandedState = {
  'ws-1': Array.from({ length: 200 }, (_, index) => `src/path-${index}.ts`),
  'ws-2': Array.from({ length: 200 }, (_, index) => `lib/path-${index}.ts`),
};

describe('workspaceTreeState benchmark', () => {
  bench('expandedPathsForWorkspace 1k lookups', () => {
    for (let index = 0; index < 1_000; index += 1) {
      expandedPathsForWorkspace(state, index % 2 === 0 ? 'ws-1' : 'ws-2');
    }
  });

  bench('toggleTreePath 1k toggles', () => {
    let paths = state['ws-1'];
    for (let index = 0; index < 1_000; index += 1) {
      paths = toggleTreePath(paths, `src/generated-${index % 50}.ts`);
    }
  });

  bench('setWorkspaceTreeExpandedPaths 1k writes', () => {
    let current = state;
    for (let index = 0; index < 1_000; index += 1) {
      current = setWorkspaceTreeExpandedPaths(current, index % 2 === 0 ? 'ws-1' : 'ws-2', [
        `src/generated-${index % 50}.ts`,
        `src/generated-${(index + 1) % 50}.ts`,
      ]);
    }
  });
});
