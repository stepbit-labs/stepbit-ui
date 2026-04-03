import { bench, describe } from 'vitest';
import {
  selectedFilePathForWorkspace,
  setSelectedFilePathForWorkspace,
  type WorkspaceEditorSelectionState,
} from './workspaceEditorState';

const state: WorkspaceEditorSelectionState = {
  'ws-1': 'src/app.ts',
  'ws-2': 'src/editor.ts',
};

describe('workspaceEditorState benchmark', () => {
  bench('selectedFilePathForWorkspace 1k lookups', () => {
    for (let index = 0; index < 1_000; index += 1) {
      selectedFilePathForWorkspace(state, index % 2 === 0 ? 'ws-1' : 'ws-2');
    }
  });

  bench('setSelectedFilePathForWorkspace 1k writes', () => {
    let current = state;
    for (let index = 0; index < 1_000; index += 1) {
      current = setSelectedFilePathForWorkspace(current, index % 2 === 0 ? 'ws-1' : 'ws-2', `src/generated-${index % 50}.ts`);
    }
  });
});
