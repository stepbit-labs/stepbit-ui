import type { Extension } from '@codemirror/state';
import { autocompletion, type CompletionContext, type Completion } from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { EditorView, hoverTooltip } from '@codemirror/view';
import type { WorkspaceSymbolRecord } from '../api/workspaces';

export function editorLanguageExtension(path: string | null | undefined): Extension[] {
  const normalized = (path || '').toLowerCase();

  if (normalized.endsWith('.ts') || normalized.endsWith('.tsx')) {
    return [javascript({ typescript: true, jsx: normalized.endsWith('.tsx') })];
  }

  if (normalized.endsWith('.js') || normalized.endsWith('.jsx')) {
    return [javascript({ jsx: normalized.endsWith('.jsx') })];
  }

  if (normalized.endsWith('.json')) {
    return [json()];
  }

  if (normalized.endsWith('.md') || normalized.endsWith('.markdown')) {
    return [markdown()];
  }

  if (normalized.endsWith('.py')) {
    return [python()];
  }

  if (normalized.endsWith('.rs')) {
    return [rust()];
  }

  return [];
}

export function buildWorkspaceCompletionItems(
  filePaths: string[],
  symbols: WorkspaceSymbolRecord[],
  currentPath: string | null,
): Completion[] {
  const items = new Map<string, Completion>();
  const relativeImportPaths = currentPath
    ? buildRelativeImportCandidates(filePaths, currentPath)
    : [];

  for (const path of filePaths) {
    const basename = path.split('/').pop() || path;
    const detail = path === currentPath ? 'current file' : 'workspace file';
    items.set(`file-path:${path}`, {
      label: path,
      type: 'variable',
      detail,
      info: `Open or import ${path}`,
      boost: path === currentPath ? 88 : 64,
      apply: path,
    });
    items.set(`file-name:${path}`, {
      label: basename,
      type: 'variable',
      detail: path,
      info: `Open or import ${path}`,
      boost: path === currentPath ? 98 : 70,
      apply: basename,
    });
  }

  for (const importPath of relativeImportPaths) {
    items.set(`import:${importPath}`, {
      label: importPath,
      type: 'text',
      detail: 'relative import',
      info: `Import path ${importPath}`,
      boost: 84,
      apply: importPath,
    });
  }

  for (const symbol of symbols) {
    items.set(`symbol:${symbol.path}:${symbol.name}:${symbol.startLine}`, {
      label: symbol.name,
      type: completionTypeForSymbol(symbol.kind),
      detail: `${symbol.kind} • ${symbol.path}`,
      info: symbol.signature || symbol.path,
      boost: symbol.path === currentPath ? 120 : 92,
      apply: symbol.name,
    });
  }

  return Array.from(items.values()).sort((left, right) => {
    return (right.boost || 0) - (left.boost || 0) || left.label.localeCompare(right.label);
  });
}

export function workspaceHoverExtension(
  symbols: WorkspaceSymbolRecord[],
  currentPath: string | null,
): Extension {
  const pathSymbols = symbols.filter((symbol) => symbol.path === currentPath);

  return hoverTooltip((view, pos) => {
    const word = view.state.wordAt(pos);
    if (!word) {
      return null;
    }

    const label = view.state.sliceDoc(word.from, word.to);
    const match = pathSymbols.find((symbol) => symbol.name === label);
    if (!match) {
      return null;
    }

    return {
      pos: word.from,
      end: word.to,
      above: true,
      create() {
        const dom = document.createElement('div');
        dom.className = 'px-2 py-1.5 text-[11px] leading-5';
        dom.innerHTML = `
          <div style="font-weight:600;color:#f0e8d0;">${match.name}</div>
          <div style="color:#66d9ef;text-transform:uppercase;font-size:10px;">${match.kind}</div>
          <div style="color:#b8aa97;">${match.signature || `${match.path}:${match.startLine}`}</div>
        `;
        return { dom };
      },
    };
  });
}

export function workspaceAutocompleteExtension(
  filePaths: string[],
  symbols: WorkspaceSymbolRecord[],
  currentPath: string | null,
): Extension {
  const options = buildWorkspaceCompletionItems(filePaths, symbols, currentPath);

  return autocompletion({
    activateOnTyping: true,
    override: [
      (context: CompletionContext) => {
        const word = context.matchBefore(/\w[\w.-]*/);
        if (!word && !context.explicit) {
          return null;
        }

        const from = word ? word.from : context.pos;
        const query = (word?.text || '').toLowerCase();
        const filtered = query
          ? options.filter((option) =>
              option.label.toLowerCase().includes(query) ||
              String(option.detail || '').toLowerCase().includes(query),
            )
          : options;

        return {
          from,
          options: filtered.slice(0, 50),
        };
      },
    ],
  });
}

export const workspaceEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: '#f0e8d0',
    fontSize: '11px',
  },
  '.cm-content': {
    padding: '10px 0 24px 0',
    caretColor: '#66d9ef',
  },
  '.cm-gutters': {
    backgroundColor: 'rgba(34, 31, 32, 0.72)',
    color: '#8a7f70',
    borderRight: '1px solid rgba(90, 80, 70, 0.35)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(102, 217, 239, 0.18)',
  },
  '.cm-tooltip': {
    border: '1px solid rgba(90, 80, 70, 0.45)',
    backgroundColor: '#262225',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'rgba(102, 217, 239, 0.14)',
    color: '#f0e8d0',
  },
});

function completionTypeForSymbol(kind: string): Completion['type'] {
  switch (kind) {
    case 'function':
      return 'function';
    case 'class':
    case 'struct':
    case 'interface':
    case 'trait':
      return 'class';
    case 'type':
    case 'enum':
      return 'type';
    default:
      return 'variable';
  }
}

function buildRelativeImportCandidates(filePaths: string[], currentPath: string): string[] {
  const currentSegments = currentPath.split('/');
  currentSegments.pop();
  const currentDir = currentSegments.join('/');

  return filePaths
    .filter((path) => path !== currentPath)
    .map((path) => toRelativeImportPath(currentDir, path))
    .filter(Boolean);
}

function toRelativeImportPath(fromDir: string, targetPath: string): string {
  const fromParts = fromDir.split('/').filter(Boolean);
  const targetParts = targetPath.split('/').filter(Boolean);

  while (fromParts.length > 0 && targetParts.length > 0 && fromParts[0] === targetParts[0]) {
    fromParts.shift();
    targetParts.shift();
  }

  const up = Array.from({ length: fromParts.length }, () => '..');
  const joined = [...up, ...targetParts].join('/');
  if (!joined) {
    return './';
  }

  return joined.startsWith('.') ? joined : `./${joined}`;
}
