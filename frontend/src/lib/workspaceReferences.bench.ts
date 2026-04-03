import { bench, describe } from 'vitest';
import { indexWorkspaceReferences } from './workspaceReferences';

function buildReferences(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `ref-${index}`,
    workspaceId: 'ws-1',
    fileId: `file-${index % 64}`,
    path: `src/file-${index % 64}.ts`,
    chunkId: `chunk-${index}`,
    chunkIndex: index,
    startLine: index + 1,
    endLine: index + 2,
    snippet: `symbol_${index}();`,
    matchedText: `symbol_${index % 8}`,
    indexedAt: '2026-03-31T12:00:00Z',
  }));
}

describe('workspaceReferences benchmarks', () => {
  bench('indexWorkspaceReferences 1k references', () => {
    indexWorkspaceReferences(buildReferences(1_000));
  });
});
