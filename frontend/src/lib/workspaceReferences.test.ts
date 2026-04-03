import { describe, expect, it } from 'vitest';
import { indexWorkspaceReferences, referencesForPath } from './workspaceReferences';

describe('workspaceReferences', () => {
  it('groups references by path and sorts by line', () => {
    const indexed = indexWorkspaceReferences([
      {
        id: 'ref-2',
        workspaceId: 'ws-1',
        fileId: 'file-1',
        path: 'src/app.ts',
        chunkId: 'chunk-2',
        chunkIndex: 2,
        startLine: 20,
        endLine: 24,
        snippet: 'callLater()',
        matchedText: 'callLater',
        indexedAt: '2026-03-31T12:00:00Z',
      },
      {
        id: 'ref-1',
        workspaceId: 'ws-1',
        fileId: 'file-1',
        path: 'src/app.ts',
        chunkId: 'chunk-1',
        chunkIndex: 1,
        startLine: 4,
        endLine: 6,
        snippet: 'callNow()',
        matchedText: 'callNow',
        indexedAt: '2026-03-31T12:00:00Z',
      },
    ]);

    const references = referencesForPath(indexed, 'src/app.ts');
    expect(references.map((reference) => reference.startLine)).toEqual([4, 20]);
  });
});
