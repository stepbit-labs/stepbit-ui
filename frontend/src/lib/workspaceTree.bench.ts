import { bench, describe } from 'vitest';
import { buildWorkspaceTree, findWorkspaceFileRecord, type WorkspaceFileRecord } from './workspaceTree';

const files: WorkspaceFileRecord[] = Array.from({ length: 1_000 }, (_, index) => ({
  id: String(index),
  workspace_id: 'ws-1',
  path: index % 3 === 0
    ? `src/components/component-${index}.tsx`
    : index % 3 === 1
      ? `src/features/feature-${index}.ts`
      : `docs/topic-${index}.md`,
  size_bytes: 128,
}));

describe('workspaceTree benchmark', () => {
  bench('buildWorkspaceTree 1k files', () => {
    buildWorkspaceTree(files);
  });

  const tree = buildWorkspaceTree(files);

  bench('findWorkspaceFileRecord deep path', () => {
    findWorkspaceFileRecord(tree, 'src/features/feature-999.ts');
  });
});
