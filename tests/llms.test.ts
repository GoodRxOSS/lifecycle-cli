import { describe, expect, it } from 'vitest';

import { LLMS_INSTRUCTIONS } from '../src/commands/llms.js';

describe('lfc llms instructions', () => {
  it('covers the essentials an agent needs', () => {
    // advanced reference for the platform itself
    expect(LLMS_INSTRUCTIONS).toContain('https://uselifecycle.com/llms.txt');
    // setup, auth, and machine-readable output
    expect(LLMS_INSTRUCTIONS).toContain('lfc init');
    expect(LLMS_INSTRUCTIONS).toContain('lfc login --device');
    expect(LLMS_INSTRUCTIONS).toContain('--json');
    // exit-code contract
    for (const line of ['0 = success', '2 = watch timeout', '4 = authentication error']) {
      expect(LLMS_INSTRUCTIONS).toContain(line);
    }
    // troubleshooting section exists
    expect(LLMS_INSTRUCTIONS).toContain('## Troubleshooting a stuck user');
  });

  it('is plain text safe for non-TTY consumption', () => {
    // no ANSI escape codes and no template-literal escaping artifacts
    // eslint-disable-next-line no-control-regex
    expect(LLMS_INSTRUCTIONS).not.toMatch(/\x1b\[/);
    expect(LLMS_INSTRUCTIONS).not.toContain('\\`');
    expect(LLMS_INSTRUCTIONS.endsWith('\n')).toBe(true);
  });
});
