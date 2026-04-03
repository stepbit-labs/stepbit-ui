import { bench, describe } from 'vitest';
import {
  selectedSymbolForWorkspace,
  setSelectedSymbolForWorkspace,
  type WorkspaceSymbolSelectionState,
} from './workspaceSymbolState';

describe('workspaceSymbolState benchmarks', () => {
  bench('workspace symbol selection 1k lookups', () => {
    const state: WorkspaceSymbolSelectionState = {
      'ws-1': { id: 'sym-1', name: 'openWorkspace', path: 'src/app.ts', kind: 'function', startLine: 12 },
      'ws-2': { id: 'sym-2', name: 'closeWorkspace', path: 'src/app.ts', kind: 'function', startLine: 24 },
    };

    for (let index = 0; index < 1_000; index += 1) {
      selectedSymbolForWorkspace(state, index % 2 === 0 ? 'ws-1' : 'ws-2');
    }
  });

  bench('workspace symbol selection 1k writes', () => {
    let state: WorkspaceSymbolSelectionState = {};
    for (let index = 0; index < 1_000; index += 1) {
      state = setSelectedSymbolForWorkspace(state, 'ws-1', {
        id: `sym-${index}`,
        name: `symbol-${index}`,
        path: 'src/app.ts',
        kind: 'function',
        startLine: index,
      });
    }
  });
});
