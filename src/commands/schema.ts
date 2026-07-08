import path from 'node:path';

import { Command } from 'commander';
import pc from 'picocolors';

import { runAction, type Ctx } from '../lib/context.js';
import { printJson } from '../lib/output.js';
import {
  ConfigFileNotFoundError,
  findConfigFile,
  validateConfigFile,
  type SchemaValidationResult,
} from '../lib/schema.js';

function reportResult(ctx: Ctx, source: string, result: SchemaValidationResult): void {
  if (ctx.json) {
    printJson({ ...result, file: source });
  } else if (result.valid) {
    process.stdout.write(`${pc.green('✓')} ${source} is a valid lifecycle config (schema ${result.schemaVersion})\n`);
  } else {
    const n = result.errors.length;
    process.stdout.write(
      `${pc.red('✗')} ${source} failed schema ${result.schemaVersion} validation (${n} error${n === 1 ? '' : 's'})\n`,
    );
    for (const issue of result.errors) {
      process.stdout.write(`  ${pc.yellow(issue.path)}: ${issue.message}\n`);
    }
  }
  if (!result.valid) process.exitCode = 1;
}

async function validate(ctx: Ctx, target: string | undefined): Promise<void> {
  const opts = ctx.cmd.opts<{ repo?: string; branch?: string }>();

  if (opts.repo || opts.branch) {
    if (!opts.repo || !opts.branch) throw new Error('--repo and --branch must be used together');
    if (target) throw new Error('Provide either a local path or --repo/--branch, not both');
    const { valid } = await ctx.api.validateSchema(opts.repo, opts.branch);
    if (ctx.json) {
      printJson({ valid, repo: opts.repo, branch: opts.branch });
    } else if (valid) {
      process.stdout.write(`${pc.green('✓')} ${opts.repo}@${opts.branch} has a valid lifecycle config\n`);
    } else {
      process.stdout.write(
        `${pc.red('✗')} ${opts.repo}@${opts.branch} failed validation ` +
          `(run locally on a checkout for error details)\n`,
      );
    }
    if (!valid) process.exitCode = 1;
    return;
  }

  let file: string;
  try {
    file = findConfigFile(target);
  } catch (err) {
    if (err instanceof ConfigFileNotFoundError) {
      if (ctx.json) printJson({ valid: false, file: null, errors: [{ path: '(file)', message: err.message }] });
      else process.stderr.write(`${pc.red('error:')} ${err.message}\n`);
      process.exitCode = 3;
      return;
    }
    throw err;
  }

  const result = validateConfigFile(file);
  reportResult(ctx, path.relative(process.cwd(), file) || file, result);
}

export function registerSchemaCommands(program: Command): void {
  const schema = program.command('schema').description('lifecycle config schema tools');

  schema
    .command('validate')
    .description('validate a lifecycle config against the 1.0.0 schema (same checks the server runs)')
    .argument('[path]', 'config file or directory to search (default: current directory)')
    .option('--repo <org/repo>', 'validate the config on a GitHub repo via the Lifecycle API')
    .option('--branch <branch>', 'branch to validate (with --repo)')
    .action(runAction(validate));
}
