import { bench, describe } from 'vitest';
import { buildWorkspaceDraftDiff } from './workspaceDraftDiff';

const liveContent = Array.from({ length: 500 }, (_, index) => `line-${index}`).join('\n');
const draftContent = Array.from({ length: 500 }, (_, index) => (index === 250 ? 'line-250-edited' : `line-${index}`)).join('\n');

describe('workspaceDraftDiff benchmark', () => {
  bench('buildWorkspaceDraftDiff 1k times', () => {
    for (let index = 0; index < 1_000; index += 1) {
      buildWorkspaceDraftDiff(liveContent, draftContent);
    }
  });
});
