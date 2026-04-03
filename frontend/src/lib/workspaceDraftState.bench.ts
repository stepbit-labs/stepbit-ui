import { bench, describe } from 'vitest';
import {
  clearWorkspaceDraftForFile,
  draftContentForWorkspaceFile,
  hasWorkspaceDraftForFile,
  setWorkspaceDraftForFile,
  type WorkspaceDraftState,
} from './workspaceDraftState';

const state: WorkspaceDraftState = {
  'ws-1': {
    'src/app.ts': 'export const app = true;',
    'src/editor.ts': 'export const editor = true;',
  },
};

describe('workspaceDraftState benchmark', () => {
  bench('draft lookups 1k times', () => {
    for (let index = 0; index < 1_000; index += 1) {
      draftContentForWorkspaceFile(state, 'ws-1', index % 2 === 0 ? 'src/app.ts' : 'src/editor.ts');
    }
  });

  bench('draft writes and clears 1k times', () => {
    let current = state;
    for (let index = 0; index < 1_000; index += 1) {
      const path = index % 2 === 0 ? 'src/app.ts' : 'src/editor.ts';
      current = setWorkspaceDraftForFile(current, 'ws-1', path, `export const draft${index % 100} = true;`);
      if (!hasWorkspaceDraftForFile(current, 'ws-1', path)) {
        throw new Error('Expected draft to exist');
      }
      current = clearWorkspaceDraftForFile(current, 'ws-1', path);
    }
  });
});
