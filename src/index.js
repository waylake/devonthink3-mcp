#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { readConfig } from './config.js';
import { Devonthink } from './bridge.js';
import { createServer } from './server.js';

try {
  const config = readConfig();
  const service = new Devonthink(config);
  if (process.argv.includes('--doctor')) {
    const discovered = await service.call('discover');
    console.log(JSON.stringify({ ...discovered, writes_enabled: config.writes, permitted_database_count: config.databaseUUIDs.length, next_step: 'Set DT3_DATABASE_UUIDS to the comma-separated UUIDs you want to expose. Database names and UUIDs shown here are local setup data; do not publish them.' }, null, 2));
  } else if (process.argv.includes('--help')) {
    console.log('devonthink3-mcp [--doctor | --help]\nDefault: local stdio MCP server. See README for DT3_DATABASE_UUIDS and optional write configuration.');
  } else {
    if (process.argv.length > 2) throw new Error('Unknown argument. Use --help.');
    const handle = serveStdio(() => createServer(service));
    process.on('SIGINT', () => { void handle.close(); });
    process.on('SIGTERM', () => { void handle.close(); });
  }
} catch (error) {
  console.error(`DEVONthink 3 MCP: ${error.code ? error.message : 'Invalid configuration or startup failure. Check README and --help.'}`);
  process.exitCode = 1;
}
