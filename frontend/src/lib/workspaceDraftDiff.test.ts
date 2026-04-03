import { describe, expect, it } from 'vitest';
import { buildWorkspaceDraftDiff } from './workspaceDraftDiff';

describe('workspaceDraftDiff', () => {
  it('detects a replaced middle block', () => {
    const diff = buildWorkspaceDraftDiff(
      ['alpha', 'beta', 'gamma', 'delta'].join('\n'),
      ['alpha', 'beta', 'theta', 'delta'].join('\n'),
    );

    expect(diff.hasChanges).toBe(true);
    expect(diff.removedLineStart).toBe(3);
    expect(diff.addedLineStart).toBe(3);
    expect(diff.removedLines).toEqual(['gamma']);
    expect(diff.addedLines).toEqual(['theta']);
  });

  it('handles insertions and empty content', () => {
    const diff = buildWorkspaceDraftDiff('', 'one\ntwo\nthree');
    expect(diff.hasChanges).toBe(true);
    expect(diff.removedLines).toEqual([]);
    expect(diff.addedLines).toEqual(['one', 'two', 'three']);
    expect(diff.addedLineStart).toBe(1);
  });
});
