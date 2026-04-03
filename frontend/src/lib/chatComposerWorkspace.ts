import type {
  WorkspaceFileContentResponse,
  WorkspaceReferenceRecord,
  WorkspaceSymbolRecord,
} from '../api/workspaces';
import type { ComposerCommandSuggestion } from './chatComposerCommands';

function stripExtension(path: string): string {
  const filename = path.split('/').pop() || path;
  return filename.replace(/\.[^.]+$/, '');
}

export function inferWorkspaceCommandQuery(
  command: ComposerCommandSuggestion,
  currentFilePath: string | null,
  currentSymbolName: string | null = null,
  currentSymbolPath: string | null = null,
): string {
  const topic = command.remainder.trim();
  if (topic) {
    return topic;
  }

  const currentTargetPath = currentFilePath || '';
  const currentSelectedPath = currentSymbolPath || currentTargetPath;

  switch (command.id) {
    case 'refs':
      return currentSymbolName || currentSelectedPath;
    case 'definition':
      if (currentSymbolName) {
        return currentSymbolName;
      }
      return currentSelectedPath ? stripExtension(currentSelectedPath) : '';
    case 'file':
      return currentSelectedPath;
    default:
      return currentSelectedPath;
  }
}

export function formatWorkspaceEvidenceBlock(params: {
  workspaceName?: string | null;
  currentFilePath?: string | null;
  currentSymbolName?: string | null;
  currentSymbolPath?: string | null;
  command: ComposerCommandSuggestion;
  symbols?: WorkspaceSymbolRecord[];
  references?: WorkspaceReferenceRecord[];
  fileContent?: WorkspaceFileContentResponse | null;
}): string {
  const {
    workspaceName,
    currentFilePath,
    currentSymbolName,
    currentSymbolPath,
    command,
    symbols = [],
    references = [],
    fileContent = null,
  } = params;

  const lines: string[] = [];
  lines.push('[Workspace evidence]');
  lines.push(`Workspace: ${workspaceName || 'active workspace'}`);
  if (currentFilePath) {
    lines.push(`Current file: ${currentFilePath}`);
  }
  if (currentSymbolName) {
    lines.push(`Current symbol: ${currentSymbolName}${currentSymbolPath ? ` (${currentSymbolPath})` : ''}`);
  }

  if (command.id === 'refs') {
    lines.push('References:');
    if (references.length === 0) {
      lines.push('- No references matched the current query.');
    } else {
      for (const reference of references.slice(0, 8)) {
        lines.push(`- ${reference.path}:${reference.startLine}-${reference.endLine} | ${reference.snippet}`);
      }
    }
  } else if (command.id === 'definition') {
    lines.push('Definitions:');
    if (symbols.length === 0) {
      lines.push('- No symbols matched the current query.');
    } else {
      for (const symbol of symbols.slice(0, 8)) {
        lines.push(`- ${symbol.path}:${symbol.startLine}-${symbol.endLine} | ${symbol.kind} ${symbol.name}${symbol.signature ? ` — ${symbol.signature}` : ''}`);
      }
    }
  } else if (command.id === 'file') {
    lines.push('File content:');
    if (!fileContent) {
      lines.push('- No file content loaded.');
    } else {
      lines.push(`- ${fileContent.path}`);
      const preview = fileContent.content.split('\n').slice(0, 30).join('\n');
      lines.push('```text');
      lines.push(preview);
      lines.push('```');
    }
  }

  return lines.join('\n');
}

export function buildEditorActionPrompt(params: {
  action: 'explain' | 'refs' | 'definition';
  filePath: string | null;
  symbolName?: string | null;
  selectedText?: string | null;
}): string {
  const { action, filePath, symbolName = null, selectedText = null } = params;
  const trimmedSelection = (selectedText || '').trim();
  const trimmedSymbol = (symbolName || '').trim();
  const target = trimmedSelection || trimmedSymbol || filePath || 'current selection';

  if (action === 'refs') {
    return `/refs ${target}`;
  }

  if (action === 'definition') {
    return `/definition ${target}`;
  }

  const location = filePath ? ` in ${filePath}` : '';
  if (trimmedSelection) {
    return `Explain this code${location}:\n\n\`\`\`\n${trimmedSelection}\n\`\`\``;
  }

  return `Explain ${target}${location}.`;
}

export function formatEditorSelectionEvidenceBlock(params: {
  filePath: string;
  selectedText: string;
  symbolName?: string | null;
}): string {
  const trimmedSelection = params.selectedText.trim();
  const preview = trimmedSelection.split('\n').slice(0, 24).join('\n');
  const lines = ['[Editor selection]', `File: ${params.filePath}`];

  if (params.symbolName) {
    lines.push(`Symbol: ${params.symbolName}`);
  }

  lines.push('```text');
  lines.push(preview);
  lines.push('```');
  return lines.join('\n');
}
