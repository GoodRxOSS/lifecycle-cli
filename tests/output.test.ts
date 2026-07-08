import { describe, expect, it } from 'vitest';

import { formatBytes, parseDuration, renderTable, visibleLength } from '../src/lib/output.js';

describe('visibleLength', () => {
  it('ignores ANSI color codes', () => {
    expect(visibleLength('\x1b[32mdeployed\x1b[0m')).toBe(8);
    expect(visibleLength('plain')).toBe(5);
  });
});

describe('renderTable', () => {
  it('aligns columns including colored cells', () => {
    const out = renderTable(
      ['name', 'status'],
      [
        ['web', '\x1b[32mdeployed\x1b[0m'],
        ['longer-name', 'error'],
      ],
    );
    // eslint-disable-next-line no-control-regex
    const stripped = out.split('\n').map(l => l.replace(/\x1b\[[0-9;]*m/g, ''));
    expect(stripped).toHaveLength(3);
    // the second column starts at the same visible offset on every line
    expect(stripped[1]!.indexOf('deployed')).toBe(stripped[0]!.indexOf('STATUS'));
    expect(stripped[2]!.indexOf('error')).toBe(stripped[0]!.indexOf('STATUS'));
  });

  it('handles missing cells', () => {
    expect(() => renderTable(['a', 'b'], [['x']])).not.toThrow();
  });
});

describe('parseDuration', () => {
  it('parses units', () => {
    expect(parseDuration('5s')).toBe(5000);
    expect(parseDuration('2m')).toBe(120_000);
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('250ms')).toBe(250);
    expect(parseDuration('10')).toBe(10_000);
  });
  it('rejects junk', () => {
    expect(() => parseDuration('abc')).toThrow();
  });
});

describe('formatBytes', () => {
  it('scales units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
