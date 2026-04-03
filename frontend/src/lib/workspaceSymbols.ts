import type { WorkspaceSymbolRecord } from '../api/workspaces';

export function indexWorkspaceSymbols(symbols: WorkspaceSymbolRecord[]): Record<string, WorkspaceSymbolRecord[]> {
  const grouped: Record<string, WorkspaceSymbolRecord[]> = {};

  for (const symbol of symbols) {
    const list = grouped[symbol.path] || [];
    list.push(symbol);
    grouped[symbol.path] = list;
  }

  for (const path of Object.keys(grouped)) {
    grouped[path].sort((left, right) =>
      left.startLine - right.startLine
        || left.endLine - right.endLine
        || left.name.localeCompare(right.name)
        || left.kind.localeCompare(right.kind)
    );
  }

  return grouped;
}

export function symbolsForPath(
  indexed: Record<string, WorkspaceSymbolRecord[]>,
  path: string | null,
): WorkspaceSymbolRecord[] {
  if (!path) {
    return [];
  }

  return indexed[path] || [];
}

export function bestDefinitionCandidate(
  indexed: Record<string, WorkspaceSymbolRecord[]>,
  symbol: WorkspaceSymbolRecord | null,
): WorkspaceSymbolRecord | null {
  if (!symbol) {
    return null;
  }

  const allSymbols = Object.values(indexed).flat();
  const matches = allSymbols.filter((candidate) =>
    candidate.name.toLowerCase() === symbol.name.toLowerCase(),
  );

  if (matches.length === 0) {
    return null;
  }

  const sameFileEarlier = matches
    .filter((candidate) => candidate.path !== symbol.path)
    .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine || left.path.localeCompare(right.path) || left.id.localeCompare(right.id));

  if (sameFileEarlier.length > 0) {
    return sameFileEarlier[0];
  }

  const sameFileEarlierInCurrent = matches
    .filter((candidate) => candidate.path === symbol.path && candidate.startLine <= symbol.startLine)
    .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine || left.id.localeCompare(right.id));

  if (sameFileEarlierInCurrent.length > 0) {
    return sameFileEarlierInCurrent[0];
  }

  const sameFileAny = matches
    .filter((candidate) => candidate.path === symbol.path)
    .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine || left.id.localeCompare(right.id));

  if (sameFileAny.length > 0) {
    return sameFileAny[0];
  }

  return matches
    .sort((left, right) =>
      left.startLine - right.startLine
        || left.endLine - right.endLine
        || left.path.localeCompare(right.path)
        || left.id.localeCompare(right.id)
    )[0] || null;
}

export function bestDefinitionCandidateFromMatches(
  symbol: Pick<WorkspaceSymbolRecord, 'path' | 'name' | 'startLine'> | null,
  matches: WorkspaceSymbolRecord[],
): WorkspaceSymbolRecord | null {
  if (!symbol || matches.length === 0) {
    return null;
  }

  const exactNameMatches = matches.filter((candidate) =>
    candidate.name.toLowerCase() === symbol.name.toLowerCase(),
  );

  if (exactNameMatches.length === 0) {
    return null;
  }

  const crossFile = exactNameMatches
    .filter((candidate) => candidate.path !== symbol.path)
    .sort((left, right) =>
      left.startLine - right.startLine
        || left.endLine - right.endLine
        || left.path.localeCompare(right.path)
        || left.id.localeCompare(right.id)
    );

  if (crossFile.length > 0) {
    return crossFile[0];
  }

  const sameFileEarlier = exactNameMatches
    .filter((candidate) => candidate.path === symbol.path && candidate.startLine <= symbol.startLine)
    .sort((left, right) =>
      left.startLine - right.startLine
        || left.endLine - right.endLine
        || left.id.localeCompare(right.id)
    );

  if (sameFileEarlier.length > 0) {
    return sameFileEarlier[0];
  }

  return exactNameMatches
    .sort((left, right) =>
      left.startLine - right.startLine
        || left.endLine - right.endLine
        || left.path.localeCompare(right.path)
        || left.id.localeCompare(right.id)
    )[0] || null;
}
