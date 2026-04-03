export interface WorkspaceDraftDiff {
  hasChanges: boolean;
  removedLineStart: number;
  addedLineStart: number;
  removedLines: string[];
  addedLines: string[];
  removedCount: number;
  addedCount: number;
  commonPrefixLines: number;
  commonSuffixLines: number;
}

export function buildWorkspaceDraftDiff(liveContent: string, draftContent: string): WorkspaceDraftDiff {
  const liveLines = normalizeLines(liveContent);
  const draftLines = normalizeLines(draftContent);
  const minLength = Math.min(liveLines.length, draftLines.length);

  let commonPrefixLines = 0;
  while (commonPrefixLines < minLength && liveLines[commonPrefixLines] === draftLines[commonPrefixLines]) {
    commonPrefixLines += 1;
  }

  let commonSuffixLines = 0;
  while (
    commonSuffixLines < minLength - commonPrefixLines &&
    liveLines[liveLines.length - 1 - commonSuffixLines] === draftLines[draftLines.length - 1 - commonSuffixLines]
  ) {
    commonSuffixLines += 1;
  }

  const liveEnd = Math.max(commonPrefixLines, liveLines.length - commonSuffixLines);
  const draftEnd = Math.max(commonPrefixLines, draftLines.length - commonSuffixLines);

  const removedLines = liveLines.slice(commonPrefixLines, liveEnd);
  const addedLines = draftLines.slice(commonPrefixLines, draftEnd);

  return {
    hasChanges: removedLines.length > 0 || addedLines.length > 0,
    removedLineStart: commonPrefixLines + 1,
    addedLineStart: commonPrefixLines + 1,
    removedLines,
    addedLines,
    removedCount: removedLines.length,
    addedCount: addedLines.length,
    commonPrefixLines,
    commonSuffixLines,
  };
}

function normalizeLines(content: string): string[] {
  if (!content) {
    return [];
  }

  return content.replace(/\r\n/g, '\n').split('\n');
}
