export interface WorkspaceFileRecord {
  id: string;
  workspace_id: string;
  path: string;
  kind?: string | null;
  size_bytes: number;
  sha256?: string | null;
  language?: string | null;
  last_modified_at?: string | null;
  indexed_at?: string | null;
}

export interface WorkspaceTreeNode {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  file?: WorkspaceFileRecord;
  children: WorkspaceTreeNode[];
}

export const ROOT_NODE_NAME = '__root__';

const pathSeparator = /[\\/]+/;

export function buildWorkspaceTree(files: WorkspaceFileRecord[]): WorkspaceTreeNode {
  const root: WorkspaceTreeNode = {
    name: ROOT_NODE_NAME,
    path: '',
    kind: 'directory',
    children: [],
  };
  const childIndexes = new Map<WorkspaceTreeNode, Map<string, WorkspaceTreeNode>>();
  childIndexes.set(root, new Map());

  for (const file of files) {
    const segments = file.path.split(pathSeparator).filter(Boolean);
    let current = root;
    let accumulatedPath = '';

    segments.forEach((segment, index) => {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;
      const currentIndex = childIndexes.get(current) || new Map<string, WorkspaceTreeNode>();
      childIndexes.set(current, currentIndex);
      const key = `${isLeaf ? 'file' : 'directory'}:${segment}`;

      let child = currentIndex.get(key);
      if (!child) {
        child = {
          name: segment,
          path: accumulatedPath,
          kind: isLeaf ? 'file' : 'directory',
          children: [],
        };
        current.children.push(child);
        currentIndex.set(key, child);
        if (child.kind === 'directory') {
          childIndexes.set(child, new Map());
        }
      }

      if (isLeaf) {
        child.file = file;
      }

      current = child;
    });
  }

  sortTree(root);
  return root;
}

export function flattenTreePaths(node: WorkspaceTreeNode): string[] {
  const paths: string[] = [];

  if (node.kind === 'file') {
    paths.push(node.path);
  }

  for (const child of node.children) {
    paths.push(...flattenTreePaths(child));
  }

  return paths;
}

export function findWorkspaceFileRecord(node: WorkspaceTreeNode, path: string): WorkspaceFileRecord | null {
  if (!path) {
    return null;
  }

  if (node.kind === 'file' && node.path === path) {
    return node.file || null;
  }

  for (const child of node.children) {
    const match = findWorkspaceFileRecord(child, path);
    if (match) {
      return match;
    }
  }

  return null;
}

export function toggleFocusPath(paths: string[], candidate: string): string[] {
  if (!candidate) return paths;
  const normalized = candidate.trim();
  if (!normalized) return paths;

  if (paths.includes(normalized)) {
    return paths.filter((path) => path !== normalized);
  }

  return [...paths, normalized];
}

function sortTree(node: WorkspaceTreeNode): void {
  node.children.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });

  for (const child of node.children) {
    sortTree(child);
  }
}
