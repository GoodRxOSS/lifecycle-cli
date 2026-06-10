import { describe, expect, it } from 'vitest';

import { logStreamWsUrl, parseWsLogMessage } from '../src/lib/logs.js';
import { formatDuration } from '../src/lib/output.js';

describe('logStreamWsUrl', () => {
  it('builds a wss URL on the app host with all parameters', () => {
    const url = new URL(
      logStreamWsUrl('https://app.lifecycle.example.com', {
        podName: 'web-abc',
        namespace: 'env-foo-123',
        containerName: 'web',
        follow: true,
        tailLines: 200,
        timestamps: false,
      })
    );
    expect(url.protocol).toBe('wss:');
    expect(url.pathname).toBe('/api/logs/stream');
    expect(url.searchParams.get('podName')).toBe('web-abc');
    expect(url.searchParams.get('namespace')).toBe('env-foo-123');
    expect(url.searchParams.get('containerName')).toBe('web');
    expect(url.searchParams.get('follow')).toBe('true');
    expect(url.searchParams.get('tailLines')).toBe('200');
    expect(url.searchParams.get('timestamps')).toBe('false');
  });

  it('uses ws: for http deployments and omits tailLines when unset', () => {
    const url = new URL(
      logStreamWsUrl('http://localhost:3000', {
        podName: 'p',
        namespace: 'n',
        containerName: 'c',
        follow: false,
      })
    );
    expect(url.protocol).toBe('ws:');
    expect(url.searchParams.has('tailLines')).toBe(false);
  });
});

describe('parseWsLogMessage', () => {
  it('parses the three message types', () => {
    expect(parseWsLogMessage('{"type":"log","payload":"hello"}')).toEqual({ type: 'log', payload: 'hello' });
    expect(parseWsLogMessage('{"type":"error","message":"boom"}')).toEqual({ type: 'error', message: 'boom' });
    expect(parseWsLogMessage('{"type":"end","reason":"ContainerTerminated"}')).toEqual({
      type: 'end',
      reason: 'ContainerTerminated',
    });
  });

  it('returns null for junk', () => {
    expect(parseWsLogMessage('not json')).toBeNull();
    expect(parseWsLogMessage('{"type":"unknown"}')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formats seconds, minutes, hours', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(95)).toBe('1m 35s');
    expect(formatDuration(3700)).toBe('1h 1m');
    expect(formatDuration(undefined)).toBe('');
  });
});
