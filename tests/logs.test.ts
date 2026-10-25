import { describe, expect, it } from 'vitest';

import { logStreamWsUrl, parseWsLogMessage } from '../src/lib/logs.js';
import { formatDuration } from '../src/lib/output.js';

describe('logStreamWsUrl', () => {
  it('builds a wss URL on the app host carrying the ticket and the stream options', () => {
    const url = new URL(
      logStreamWsUrl('https://app.lifecycle.example.com', {
        ticket: 'lfclt_v1.ticket',
        podName: 'web-abc',
        containerName: 'web',
        follow: true,
        tailLines: 200,
        timestamps: false,
      }),
    );
    expect(url.protocol).toBe('wss:');
    expect(url.pathname).toBe('/api/logs/stream');
    expect(url.search).toContain('ticket=');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ticket: 'lfclt_v1.ticket',
      follow: 'true',
      tailLines: '200',
      timestamps: 'false',
    });
  });

  it('sends no namespace or pod coordinates alongside the ticket', () => {
    const url = new URL(
      logStreamWsUrl('https://app.lifecycle.example.com', {
        ticket: 'lfclt_v1.ticket',
        podName: 'web-abc',
        containerName: 'web',
        follow: false,
      }),
    );
    expect(url.search).not.toContain('namespace=');
    expect(url.searchParams.has('podName')).toBe(false);
    expect(url.searchParams.has('containerName')).toBe(false);
  });

  it('uses ws: for http deployments and omits tailLines when unset', () => {
    const url = new URL(
      logStreamWsUrl('http://localhost:3000', {
        ticket: 't',
        podName: 'p',
        containerName: 'c',
        follow: false,
      }),
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
