import { Command } from 'commander';

import { registerAuthCommands } from './commands/auth.js';
import { registerBuildsCommands } from './commands/builds.js';
import { registerConfigCommands } from './commands/config.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerInitCommand } from './commands/init.js';
import { registerLlmsCommand } from './commands/llms.js';
import { registerPodsCommands } from './commands/pods.js';
import { registerSchemaCommands } from './commands/schema.js';
import { registerServicesCommands } from './commands/services.js';
import { registerSitesCommands } from './commands/sites.js';

import pkg from '../package.json' with { type: 'json' };

const program = new Command();

program
  .name('lfc')
  .description('Lifecycle CLI — preview environments, services, and static sites from your terminal')
  .version(pkg.version)
  .option('--json', 'machine-readable JSON output (also via LFC_JSON=1)')
  .option('--profile <name>', 'config profile to use (also via LFC_PROFILE)')
  .option('--api-url <url>', 'override the Lifecycle API base URL (also via LIFECYCLE_API_URL)')
  .option('-q, --quiet', 'suppress informational output');

registerInitCommand(program);
registerAuthCommands(program);
registerConfigCommands(program);
registerDoctorCommand(program);
registerBuildsCommands(program);
registerServicesCommands(program);
registerPodsCommands(program);
registerSchemaCommands(program);
registerSitesCommands(program);
registerLlmsCommand(program);

program.parseAsync().catch((err: Error) => {
  process.stderr.write(`error: ${err.message}\n`);
  process.exitCode = 1;
});
