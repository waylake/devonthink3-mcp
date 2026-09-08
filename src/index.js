#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { parseArgs } from 'node:util';
import { readConfig, loadSettings, configPath, BridgeError } from './config.js';
import { Devonthink } from './bridge.js';
import { createServer } from './server.js';
import { setup } from './setup.js';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean' }, doctor: { type: 'boolean' }, client: { type: 'string' },
    'database-mode': { type: 'string' }, 'database-uuids': { type: 'string' },
    'exclude-databases': { type: 'string' }, 'enable-writes': { type: 'boolean' }, 'read-only': { type: 'boolean' }
  } });
  if (values.help) {
    console.log(`devonthink3-mcp [--doctor | setup [options]]
Default: local stdio MCP server.
setup --client codex|pi|both     Choose databases interactively and register clients
setup --database-mode open --enable-writes   Follow all open databases, with writes
setup --database-uuids UUID,UUID --read-only Restrict access to selected databases
setup --exclude-databases UUID,UUID         Exclusions override either scope mode
DT3_CONFIG sets an absolute settings-file path. See README for environment overrides.`);
  } else if (positionals.length === 1 && positionals[0] === 'setup' && !values.doctor) {
    await setup(values);
  } else {
    if (positionals.length || Object.keys(values).some(key => key !== 'doctor')) throw new Error('Unknown command. Use --help.');
    const config = readConfig(process.env, loadSettings(configPath(), process.env.DT3_CONFIG !== undefined));
    const service = new Devonthink(config);
    if (values.doctor) {
      const discovered = await service.call('discover');
      console.log(JSON.stringify({ ...discovered, writes_enabled: config.writes, database_mode: config.databaseMode, configured_databases: config.databaseUUIDs.length, next_step: 'Run setup to select databases or explicitly follow all open databases. Database names and UUIDs shown here are local setup data; do not publish them.' }, null, 2));
    } else {
      const handle = serveStdio(() => createServer(service));
      process.on('SIGINT', () => { void handle.close(); });
      process.on('SIGTERM', () => { void handle.close(); });
    }
  }
} catch (error) {
  const cli = process.argv.includes('setup');
  const message = error instanceof BridgeError || (cli && !error.cmd) ? error.message : 'Invalid configuration or startup failure. Check README and --help. If setup failed after saving settings, rerun setup to finish client registration.';
  console.error(`DEVONthink 3 MCP: ${message}`);
  process.exitCode = 1;
}
