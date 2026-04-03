import { describe, expect, it } from 'vitest';
import { buildWorkspaceCompletionItems, editorLanguageExtension } from './workspaceEditorExtensions';

describe('workspaceEditorExtensions', () => {
  it('detects language extensions for common repo files', () => {
    expect(editorLanguageExtension('src/app.ts')).toHaveLength(1);
    expect(editorLanguageExtension('src/app.tsx')).toHaveLength(1);
    expect(editorLanguageExtension('src/lib.rs')).toHaveLength(1);
    expect(editorLanguageExtension('README.md')).toHaveLength(1);
    expect(editorLanguageExtension('notes.txt')).toHaveLength(0);
  });

  it('builds deduplicated completion items with current file priority', () => {
    const items = buildWorkspaceCompletionItems(
      ['src/app.ts', 'README.md'],
      [
        {
          id: 'sym-1',
          workspaceId: 'ws-1',
          fileId: 'file-1',
          path: 'src/app.ts',
          name: 'assembleContext',
          kind: 'function',
          startLine: 10,
          endLine: 20,
          signature: 'assembleContext(request)',
          containerName: null,
          indexedAt: '1',
        },
        {
          id: 'sym-2',
          workspaceId: 'ws-1',
          fileId: 'file-1',
          path: 'src/app.ts',
          name: 'assembleContext',
          kind: 'function',
          startLine: 10,
          endLine: 20,
          signature: 'assembleContext(request)',
          containerName: null,
          indexedAt: '1',
        },
      ],
      'src/app.ts',
    );

    expect(items.some((item) => item.label === 'assembleContext')).toBe(true);
    expect(items.some((item) => item.label === 'app.ts')).toBe(true);
    expect(items.some((item) => item.label === 'src/app.ts')).toBe(true);
    expect(items.some((item) => item.label === '../README.md' || item.label === './README.md')).toBe(true);
    expect(items.filter((item) => item.label === 'assembleContext')).toHaveLength(1);
    expect(items[0]?.label).toBe('assembleContext');
  });
});
