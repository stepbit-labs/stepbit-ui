import { describe, expect, it } from 'vitest';
import { buildWorkspaceTree, findWorkspaceFileRecord, flattenTreePaths, toggleFocusPath, type WorkspaceFileRecord } from './workspaceTree';

const files: WorkspaceFileRecord[] = [
  { id: '1', workspace_id: 'ws-1', path: 'src/app.ts', size_bytes: 10 },
  { id: '2', workspace_id: 'ws-1', path: 'src/components/Button.tsx', size_bytes: 12 },
  { id: '3', workspace_id: 'ws-1', path: 'README.md', size_bytes: 8 },
];

describe('workspaceTree', () => {
  it('builds a nested tree and keeps file paths stable', () => {
    const tree = buildWorkspaceTree(files);

    expect(tree.children.map((node) => node.path)).toEqual(['src', 'README.md']);
    expect(flattenTreePaths(tree)).toEqual(['src/components/Button.tsx', 'src/app.ts', 'README.md']);
  });

  it('toggles focus paths deterministically', () => {
    expect(toggleFocusPath(['src/app.ts'], 'src/components/Button.tsx')).toEqual(['src/app.ts', 'src/components/Button.tsx']);
    expect(toggleFocusPath(['src/app.ts'], 'src/app.ts')).toEqual([]);
  });

  it('finds file records by workspace path', () => {
    const tree = buildWorkspaceTree(files);

    expect(findWorkspaceFileRecord(tree, 'src/components/Button.tsx')?.id).toBe('2');
    expect(findWorkspaceFileRecord(tree, 'missing.ts')).toBeNull();
  });
});
