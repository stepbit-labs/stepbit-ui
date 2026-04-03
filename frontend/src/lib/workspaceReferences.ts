import type { WorkspaceReferenceRecord } from '../api/workspaces';

export function indexWorkspaceReferences(
  references: WorkspaceReferenceRecord[],
): Record<string, WorkspaceReferenceRecord[]> {
  const grouped: Record<string, WorkspaceReferenceRecord[]> = {};

  for (const reference of references) {
    const list = grouped[reference.path] || [];
    list.push(reference);
    grouped[reference.path] = list;
  }

  for (const path of Object.keys(grouped)) {
    grouped[path].sort((left, right) =>
      left.startLine - right.startLine
        || left.endLine - right.endLine
        || left.chunkIndex - right.chunkIndex
        || left.id.localeCompare(right.id)
    );
  }

  return grouped;
}

export function referencesForPath(
  indexed: Record<string, WorkspaceReferenceRecord[]>,
  path: string | null,
): WorkspaceReferenceRecord[] {
  if (!path) {
    return [];
  }

  return indexed[path] || [];
}
