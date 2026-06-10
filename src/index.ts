import { Command } from 'commander';

import { registerAuthCommands } from './commands/auth.js';
import { registerBuildsCommands } from './commands/builds.js';
import { registerConfigCommands } from './commands/config.js';
import { registerPodsCommands } from './commands/pods.js';
import { registerSchemaCommands } from './commands/schema.js';
import { registerServicesCommands } from './commands/services.js';
import { registerSitesCommands } from './commands/sites.js';

const program = new Command();

program
  .name('lfc')
  .description('Lifecycle CLI — preview environments, services, and static sites from your terminal')
  .version('0.1.0')
  .option('--json', 'machine-readable JSON output (also via LFC_JSON=1)')
  .option('--profile <name>', 'config profile to use (also via LFC_PROFILE)')
  .option('--api-url <url>', 'override the Lifecycle API base URL (also via LIFECYCLE_API_URL)')
  .option('-q, --quiet', 'suppress informational output');

registerAuthCommands(program);
registerConfigCommands(program);
registerBuildsCommands(program);
registerServicesCommands(program);
registerPodsCommands(program);
registerSchemaCommands(program);
registerSitesCommands(program);

program.parseAsync().catch((err: Error) => {
  process.stderr.write(`error: ${err.message}\n`);
  process.exitCode = 1;
});
