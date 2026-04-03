import { describe, expect, it } from 'vitest';
import { bestDefinitionCandidate, indexWorkspaceSymbols, symbolsForPath } from './workspaceSymbols';
import type { WorkspaceSymbolRecord } from '../api/workspaces';

const symbols: WorkspaceSymbolRecord[] = [
  {
    id: 'symbol-1',
    workspaceId: 'ws-1',
    fileId: 'file-1',
    path: 'src/app.ts',
    name: 'openWorkspace',
    kind: 'function',
    startLine: 20,
    endLine: 24,
    signature: 'export function openWorkspace() {',
    containerName: null,
    indexedAt: '2026-03-31T12:00:00Z',
  },
  {
    id: 'symbol-2',
    workspaceId: 'ws-1',
    fileId: 'file-1',
    path: 'src/app.ts',
    name: 'AppState',
    kind: 'type',
    startLine: 4,
    endLine: 12,
    signature: 'export type AppState = {',
    containerName: null,
    indexedAt: '2026-03-31T12:00:00Z',
  },
];

describe('workspaceSymbols', () => {
  it('groups and sorts symbols by path', () => {
    const index = indexWorkspaceSymbols(symbols);

    expect(index['src/app.ts']).toHaveLength(2);
    expect(index['src/app.ts'][0].name).toBe('AppState');
    expect(index['src/app.ts'][1].name).toBe('openWorkspace');
  });

  it('returns empty lists for unknown paths', () => {
    const index = indexWorkspaceSymbols(symbols);

    expect(symbolsForPath(index, 'missing.ts')).toEqual([]);
  });

  it('finds the best definition candidate for a symbol', () => {
    const index = indexWorkspaceSymbols([
      ...symbols,
      {
        id: 'symbol-3',
        workspaceId: 'ws-1',
        fileId: 'file-2',
        path: 'src/definitions.ts',
        name: 'openWorkspace',
        kind: 'function',
        startLine: 3,
        endLine: 5,
        signature: 'export function openWorkspace() {',
        containerName: null,
        indexedAt: '2026-03-31T12:00:00Z',
      },
    ]);

    const candidate = bestDefinitionCandidate(index, {
      id: 'symbol-4',
      workspaceId: 'ws-1',
      fileId: 'file-1',
      path: 'src/app.ts',
      name: 'openWorkspace',
      kind: 'function',
      startLine: 20,
      endLine: 24,
      signature: 'openWorkspace()',
      containerName: null,
      indexedAt: '2026-03-31T12:00:00Z',
    });

    expect(candidate?.path).toBe('src/definitions.ts');
    expect(candidate?.name).toBe('openWorkspace');
  });
});
