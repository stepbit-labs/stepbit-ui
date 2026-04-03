import { bench, describe } from 'vitest';
import { formatWorkspaceEvidenceBlock, inferWorkspaceCommandQuery } from './chatComposerWorkspace';

describe('chatComposerWorkspace benchmarks', () => {
  bench('workspace query inference 1k inputs', () => {
    for (let index = 0; index < 1_000; index += 1) {
      inferWorkspaceCommandQuery(
        {
          id: index % 2 === 0 ? 'refs' : 'definition',
          trigger: index % 2 === 0 ? '/refs' : '/definition',
          title: '',
          description: '',
          keywords: [],
          prefix: '/',
          remainder: index % 3 === 0 ? '' : 'open_workspace',
        },
        index % 2 === 0 ? 'src/app.ts' : 'src/lib.rs',
        index % 4 === 0 ? 'openWorkspace' : null,
        index % 4 === 0 ? 'src/app.ts' : null,
      );
    }
  });

  bench('workspace evidence formatting 1k inputs', () => {
    const command = {
      id: 'refs' as const,
      trigger: '/refs',
      title: '',
      description: '',
      keywords: [],
      prefix: '/',
      remainder: '',
    };

    for (let index = 0; index < 1_000; index += 1) {
      formatWorkspaceEvidenceBlock({
        workspaceName: 'repo',
        currentFilePath: 'src/app.ts',
        command,
        references: [{
          id: `ref-${index}`,
          workspaceId: 'ws-1',
          fileId: 'file-1',
          path: 'src/app.ts',
          chunkId: 'chunk-1',
          chunkIndex: 0,
          startLine: 12,
          endLine: 14,
          snippet: 'openWorkspace();',
          matchedText: 'openWorkspace',
          indexedAt: '2026-03-31T12:00:00Z',
        }],
      });
    }
  });
});
