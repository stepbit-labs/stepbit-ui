import { bench, describe } from 'vitest';
import { expandComposerCommand, getComposerCommandSuggestions, parseComposerCommand } from './chatComposerCommands';

describe('chatComposerCommands benchmarks', () => {
  bench('command suggestion lookup 1k inputs', () => {
    for (let index = 0; index < 1_000; index += 1) {
      getComposerCommandSuggestions(index % 2 === 0 ? '/task fix bug' : '/refs open_workspace');
    }
  });

  bench('command expansion 1k inputs', () => {
    const parsed = parseComposerCommand('/task fix save flow');
    if (!parsed) {
      throw new Error('expected parsed command');
    }

    for (let index = 0; index < 1_000; index += 1) {
      expandComposerCommand(parsed, {
        workspaceName: 'repo',
      });
    }
  });
});
