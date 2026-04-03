import { bench, describe } from 'vitest';
import { bestDefinitionCandidate, indexWorkspaceSymbols } from './workspaceSymbols';
import type { WorkspaceSymbolRecord } from '../api/workspaces';

const symbols: WorkspaceSymbolRecord[] = Array.from({ length: 1_000 }, (_, index) => ({
  id: `symbol-${index}`,
  workspaceId: 'ws-1',
  fileId: `file-${Math.floor(index / 10)}`,
  path: index % 2 === 0 ? 'src/app.ts' : 'src/editor.ts',
  name: `symbol${index}`,
  kind: index % 2 === 0 ? 'function' : 'type',
  startLine: index + 1,
  endLine: index + 1,
  signature: `symbol ${index}`,
  containerName: null,
  indexedAt: '2026-03-31T12:00:00Z',
}));

describe('workspaceSymbols benchmark', () => {
  bench('indexWorkspaceSymbols 1k symbols', () => {
    indexWorkspaceSymbols(symbols);
  });

  bench('bestDefinitionCandidate 1k symbols', () => {
    const index = indexWorkspaceSymbols(symbols);
    bestDefinitionCandidate(index, symbols[799]);
  });
});
