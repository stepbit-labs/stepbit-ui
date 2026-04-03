import { describe, expect, it } from 'vitest';
import {
  COMPOSER_COMMANDS,
  expandComposerCommand,
  getComposerCommandSuggestions,
  parseComposerCommand,
} from './chatComposerCommands';

describe('chatComposerCommands', () => {
  it('suggests commands for slash input', () => {
    const suggestions = getComposerCommandSuggestions('/t');
    expect(suggestions.map((suggestion) => suggestion.id)).toContain('task');
  });

  it('parses a task command and expands it into a structured template', () => {
    const parsed = parseComposerCommand('/task fix the save flow');
    expect(parsed?.id).toBe('task');
    expect(parsed?.remainder).toBe('fix the save flow');

    const expanded = expandComposerCommand(parsed!, {
      workspaceName: 'repo',
    });

    expect(expanded).toContain('Task: fix the save flow');
    expect(expanded).toContain('Workspace: repo');
    expect(expanded).not.toContain('Focus paths');
  });

  it('uses the active file for refs and definition templates', () => {
    const parsedRefs = parseComposerCommand('/refs');
    const parsedDefinition = parseComposerCommand('/definition');

    expect(expandComposerCommand(parsedRefs!, { currentFilePath: 'src/app.ts' })).toContain('src/app.ts');
    expect(expandComposerCommand(parsedDefinition!, { currentFilePath: 'src/app.ts' })).toContain('src/app.ts');
  });

  it('supports the task command catalog', () => {
    expect(COMPOSER_COMMANDS.map((command) => command.trigger)).toContain('/task');
  });
});
