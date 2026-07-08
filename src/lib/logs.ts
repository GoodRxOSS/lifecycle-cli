import pc from 'picocolors';

export interface LogStreamParams {
  podName: string;
  namespace: string;
  containerName: string;
  follow: boolean;
  tailLines?: number;
  timestamps?: boolean;
}

export function logStreamWsUrl(apiBaseUrl: string, params: LogStreamParams): string {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/logs/stream';
  url.searchParams.set('podName', params.podName);
  url.searchParams.set('namespace', params.namespace);
  url.searchParams.set('containerName', params.containerName);
  url.searchParams.set('follow', String(params.follow));
  if (params.tailLines !== undefined) url.searchParams.set('tailLines', String(params.tailLines));
  url.searchParams.set('timestamps', String(params.timestamps ?? false));
  return url.toString();
}

export type WsLogMessage =
  | { type: 'log'; payload: string }
  | { type: 'error'; message: string }
  | { type: 'end'; reason?: string };

export function parseWsLogMessage(raw: string): WsLogMessage | null {
  try {
    const msg = JSON.parse(raw) as WsLogMessage;
    if (msg && (msg.type === 'log' || msg.type === 'error' || msg.type === 'end')) return msg;
    return null;
  } catch {
    return null;
  }
}

/**
 * Stream pod logs over the ws-server's /api/logs/stream endpoint until the
 * stream ends (or Ctrl-C). Resolves true on clean end, rejects on stream error.
 * `prefix` is prepended to every line (used when tailing multiple containers).
 */
export function streamPodLogs(
  apiBaseUrl: string,
  params: LogStreamParams,
  opts: { prefix?: string; quiet?: boolean } = {},
): Promise<void> {
  const url = logStreamWsUrl(apiBaseUrl, params);
  const prefix = opts.prefix ? `${opts.prefix} ` : '';

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const stop = (): void => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    };
    const onSigint = (): void => {
      stop();
      process.exitCode = 0;
      resolve();
    };
    process.once('SIGINT', onSigint);

    ws.onopen = () => {
      if (!opts.quiet) {
        process.stderr.write(pc.dim(`— streaming ${params.podName}/${params.containerName} (Ctrl-C to stop) —\n`));
      }
    };
    ws.onmessage = event => {
      const msg = parseWsLogMessage(String(event.data));
      if (!msg) return;
      if (msg.type === 'log') {
        process.stdout.write(prefix + msg.payload + (msg.payload.endsWith('\n') ? '' : '\n'));
      } else if (msg.type === 'end') {
        if (!opts.quiet) process.stderr.write(pc.dim(`— stream ended${msg.reason ? ` (${msg.reason})` : ''} —\n`));
        process.removeListener('SIGINT', onSigint);
        stop();
        resolve();
      } else {
        process.removeListener('SIGINT', onSigint);
        stop();
        reject(new Error(msg.message));
      }
    };
    ws.onerror = () => {
      process.removeListener('SIGINT', onSigint);
      reject(new Error(`websocket connection to ${url.split('?')[0]} failed`));
    };
    ws.onclose = () => {
      process.removeListener('SIGINT', onSigint);
      resolve();
    };
  });
}
