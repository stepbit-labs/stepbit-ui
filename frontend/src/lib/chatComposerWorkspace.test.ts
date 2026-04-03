import { describe, expect, it } from 'vitest';
import { buildEditorActionPrompt, formatEditorSelectionEvidenceBlock, inferWorkspaceCommandQuery } from './chatComposerWorkspace';

describe('chatComposerWorkspace', () => {
  it('infers refs and definitions from current context', () => {
    expect(
      inferWorkspaceCommandQuery(
        {
          id: 'refs',
          trigger: '/refs',
          title: 'Refs',
          description: '',
          template: '/refs',
          remainder: '',
        } as any,
        'src/app.ts',
        'assembleContext',
        'src/app.ts',
      ),
    ).toBe('assembleContext');

    expect(
      inferWorkspaceCommandQuery(
        {
          id: 'definition',
          trigger: '/definition',
          title: 'Definition',
          description: '',
          template: '/definition',
          remainder: '',
        } as any,
        'src/app.ts',
        null,
        null,
      ),
    ).toBe('app');
  });

  it('builds prompts for editor actions', () => {
    expect(
      buildEditorActionPrompt({
        action: 'refs',
        filePath: 'src/app.ts',
        symbolName: 'assembleContext',
      }),
    ).toBe('/refs assembleContext');

    expect(
      buildEditorActionPrompt({
        action: 'definition',
        filePath: 'src/app.ts',
        selectedText: 'ContextAssembler',
      }),
    ).toBe('/definition ContextAssembler');

    expect(
      buildEditorActionPrompt({
        action: 'explain',
        filePath: 'src/app.ts',
        selectedText: 'fn main() {}',
      }),
    ).toContain('Explain this code in src/app.ts');
  });

  it('formats editor selection evidence for implicit chat context', () => {
    const block = formatEditorSelectionEvidenceBlock({
      filePath: 'src/app.ts',
      selectedText: 'fn main() {}',
      symbolName: 'main',
    });

    expect(block).toContain('[Editor selection]');
    expect(block).toContain('File: src/app.ts');
    expect(block).toContain('Symbol: main');
  });
});
