import { bench, describe } from 'vitest';
import { buildWorkspaceCompletionItems } from './workspaceEditorExtensions';

describe('workspaceEditorExtensions', () => {
  bench('buildWorkspaceCompletionItems workspace scale', () => {
    const filePaths = Array.from({ length: 800 }, (_, index) => `src/module-${index}.ts`);
    const symbols = Array.from({ length: 1800 }, (_, index) => ({
      id: `sym-${index}`,
      workspaceId: 'ws-1',
      fileId: `file-${index % 800}`,
      path: `src/module-${index % 800}.ts`,
      name: `symbol${index}`,
      kind: index % 3 === 0 ? 'function' : 'variable',
      startLine: index + 1,
      endLine: index + 2,
      signature: null,
      containerName: null,
      indexedAt: '1',
    }));

    buildWorkspaceCompletionItems(filePaths, symbols, 'src/module-42.ts');
  });
});
