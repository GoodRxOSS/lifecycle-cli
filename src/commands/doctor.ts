import { Command } from 'commander';
import pc from 'picocolors';

import { runDoctor, type DoctorCheck, type DoctorStatus } from '../lib/doctor.js';
import { printJson } from '../lib/output.js';

function marker(status: DoctorStatus): string {
  if (status === 'ok') return pc.green('✓');
  if (status === 'warn') return pc.yellow('!');
  return pc.red('✗');
}

function printCheck(check: DoctorCheck): void {
  const suffix = check.fixed ? pc.dim(' fixed') : check.fixable && check.status !== 'ok' ? pc.dim(' fixable') : '';
  process.stdout.write(`${marker(check.status)} ${check.label.padEnd(18)} ${check.message}${suffix}\n`);
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check local Lifecycle CLI setup, config, token cache, and file permissions')
    .option('--fix', 'repair config/token file permissions when possible', false)
    .action((opts: { fix?: boolean }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<{ json?: boolean }>();
      const json = Boolean(globals.json) || process.env.LFC_JSON === '1';
      const report = runDoctor({ fix: opts.fix });

      if (json) {
        printJson(report);
      } else {
        process.stdout.write(`${pc.bold('lfc doctor')}\n`);
        for (const check of report.checks) printCheck(check);
        const fixable = report.checks.some((check) => check.fixable && check.status !== 'ok');
        if (fixable && !opts.fix) process.stdout.write(pc.dim('\nRun `lfc doctor --fix` to repair fixable permission issues.\n'));
      }

      if (report.checks.some((check) => check.status === 'error')) process.exitCode = opts.fix ? 3 : 1;
      else if (report.checks.some((check) => check.status === 'warn')) process.exitCode = 2;
    });
}
