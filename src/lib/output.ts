import pc from 'picocolors';

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function visibleLength(s: string): number {
  return s.replace(ANSI_RE, '').length;
}

function pad(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - visibleLength(s)));
}

export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(visibleLength(h), ...rows.map(r => visibleLength(r[i] ?? ''))));
  const lines: string[] = [];
  lines.push(headers.map((h, i) => pc.bold(pad(h.toUpperCase(), widths[i] ?? 0))).join('  '));
  for (const row of rows) {
    lines.push(row.map((cell, i) => pad(cell ?? '', widths[i] ?? 0)).join('  '));
  }
  return lines.join('\n');
}

export function statusColor(status: string): string {
  const s = status?.toLowerCase() ?? '';
  if (s === 'deployed' || s === 'ready' || s === 'active' || s === 'built') return pc.green(status);
  if (s.includes('error') || s.includes('failed') || s === 'expired') return pc.red(status);
  if (s === 'torn_down' || s === 'deleted') return pc.dim(status);
  if (['building', 'deploying', 'cloning', 'queued', 'pending', 'waiting', 'tearing_down'].includes(s)) {
    return pc.yellow(status);
  }
  return status;
}

export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export function link(url: string): string {
  return pc.cyan(pc.underline(url));
}

export function formatAge(iso?: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatBytes(n?: number): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds?: number): string {
  if (seconds == null || Number.isNaN(seconds)) return '';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m${seconds % 60 ? ` ${seconds % 60}s` : ''}`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function parseDuration(input: string): number {
  const m = /^(\d+)(ms|s|m|h)?$/.exec(input.trim());
  if (!m) throw new Error(`Invalid duration "${input}" (use e.g. 5s, 2m, 1h)`);
  const n = Number(m[1]);
  switch (m[2] ?? 's') {
    case 'ms':
      return n;
    case 's':
      return n * 1000;
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    default:
      return n * 1000;
  }
}
