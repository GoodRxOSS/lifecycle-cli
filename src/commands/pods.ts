import * as p from '@clack/prompts';
import { Command } from 'commander';
import pc from 'picocolors';

import { runAction, type Ctx } from '../lib/context.js';
import { streamPodLogs } from '../lib/logs.js';
import { printJson, renderTable, statusColor } from '../lib/output.js';
import type { PodInfo } from '../lib/types.js';

function podRows(pods: PodInfo[]): string[][] {
  return pods.map((pod) => [
    pod.podName,
    pod.serviceName ?? '',
    String(pod.ready),
    statusColor(pod.status),
    pod.restarts > 0 ? pc.yellow(String(pod.restarts)) : '0',
    pod.age,
  ]);
}

async function fetchPods(ctx: Ctx, uuid: string, service?: string): Promise<PodInfo[]> {
  return service ? ctx.api.listServicePods(uuid, service) : ctx.api.listEnvironmentPods(uuid);
}

async function pickPod(pods: PodInfo[], podName?: string): Promise<PodInfo> {
  if (podName) {
    const pod = pods.find((x) => x.podName === podName);
    if (!pod) throw new Error(`Pod ${podName} not found (run lfc pods list first)`);
    return pod;
  }
  if (pods.length === 1) return pods[0]!;
  if (!process.stdin.isTTY) {
    throw new Error(`Multiple pods found — specify one: ${pods.map((x) => x.podName).join(', ')}`);
  }
  const picked = await p.select({
    message: 'Select a pod',
    options: pods.map((pod) => ({
      value: pod.podName,
      label: pod.podName,
      hint: `${pod.serviceName ?? ''} ${pod.status} ${pod.ready} restarts:${pod.restarts}`.trim(),
    })),
  });
  if (p.isCancel(picked)) throw new Error('cancelled');
  return pods.find((x) => x.podName === picked)!;
}

async function pickContainer(pod: PodInfo, containerName?: string): Promise<string> {
  const containers = pod.containers ?? [];
  if (containerName) {
    if (containers.length > 0 && !containers.some((c) => c.name === containerName)) {
      throw new Error(`Container ${containerName} not in pod (has: ${containers.map((c) => c.name).join(', ')})`);
    }
    return containerName;
  }
  if (containers.length <= 1) {
    if (containers.length === 0) throw new Error(`No containers reported for pod ${pod.podName}`);
    return containers[0]!.name;
  }
  if (!process.stdin.isTTY) {
    // same default as the UI pod-logs dialog: the last (main) container
    return containers[containers.length - 1]!.name;
  }
  const picked = await p.select({
    message: 'Select a container',
    options: containers.map((c) => ({ value: c.name, label: c.name, hint: c.state })),
    initialValue: containers[containers.length - 1]!.name,
  });
  if (p.isCancel(picked)) throw new Error('cancelled');
  return picked as string;
}

export function registerPodsCommands(program: Command): void {
  const pods = program.command('pods').description('Pods running in a build\'s namespace');

  pods
    .command('list <buildUuid>')
    .description('List pods with health, restarts, and containers')
    .option('-s, --service <name>', 'only pods belonging to one service')
    .action(
      runAction(async (ctx, buildUuid: string, opts: { service?: string }) => {
        const list = await fetchPods(ctx, buildUuid, opts.service);
        if (ctx.json) {
          printJson({ build: buildUuid, pods: list });
          return;
        }
        if (list.length === 0) {
          process.stdout.write(pc.dim('No pods found.\n'));
          return;
        }
        process.stdout.write(renderTable(['pod', 'service', 'ready', 'status', 'restarts', 'age'], podRows(list)) + '\n');
        const multi = list.filter((pod) => (pod.containers?.length ?? 0) > 1);
        for (const pod of multi) {
          process.stdout.write(
            pc.dim(`  ${pod.podName} containers: ${pod.containers.map((c) => `${c.name}(${c.state ?? '?'})`).join(', ')}\n`)
          );
        }
      })
    );

  pods
    .command('logs <buildUuid> [podName]')
    .description('Stream logs from a pod (interactive pod/container picker on a TTY)')
    .option('-s, --service <name>', 'narrow pod selection to one service')
    .option('-c, --container <name>', 'container to stream (default: the main container)')
    .option('-f, --follow', 'keep following new log lines', false)
    .option('--tail <lines>', 'lines of history to fetch', '200')
    .option('--timestamps', 'prefix each line with its timestamp', false)
    .action(
      runAction(
        async (
          ctx,
          buildUuid: string,
          podName: string | undefined,
          opts: { service?: string; container?: string; follow: boolean; tail: string; timestamps: boolean }
        ) => {
          const build = await ctx.api.getBuild(buildUuid);
          const namespace = build.namespace || `env-${buildUuid}`;
          const list = await fetchPods(ctx, buildUuid, opts.service);
          if (list.length === 0) throw new Error('No pods found for this build');
          const pod = await pickPod(list, podName);
          const container = await pickContainer(pod, opts.container);
          const tailLines = Number.parseInt(opts.tail, 10);
          if (Number.isNaN(tailLines) || tailLines < 0) throw new Error(`Invalid --tail value "${opts.tail}"`);
          await streamPodLogs(
            ctx.api.baseUrl,
            {
              podName: pod.podName,
              namespace,
              containerName: container,
              follow: opts.follow,
              tailLines,
              timestamps: opts.timestamps,
            },
            { quiet: ctx.quiet || ctx.json }
          );
        }
      )
    );
}
