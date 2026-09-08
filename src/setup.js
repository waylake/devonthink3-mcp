import { access, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, delimiter } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { configPath, loadSettings, readConfig } from './config.js';
import { Devonthink } from './bridge.js';
import pkg from '../package.json' with { type: 'json' };

const exec = promisify(execFile);
export async function writeSettings(path, settings) {
  const validated = readConfig({}, settings);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Keep the previous exact bytes; never replace a malformed existing configuration.
  loadSettings(path);
  try { await writeFile(`${path}.bak`, await readFile(path), { mode: 0o600 }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

async function executable(name) {
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const path = join(dir, name);
    try { await access(path, constants.X_OK); return await realpath(path); } catch { /* next PATH entry */ }
  }
  throw new Error(`${name} is not on PATH. Install the client first or run setup without --client.`);
}

export function selectedUUIDs(answer, databases) {
  if (answer.trim() === '0') return [];
  const numbers = answer.split(',').map(value => value.trim());
  if (!numbers.length || numbers.some(value => !/^[1-9][0-9]*$/.test(value) || Number(value) > databases.length)) {
    throw new Error('Choose displayed database numbers separated by commas, or 0 for none.');
  }
  return [...new Set(numbers.map(value => databases[Number(value) - 1].uuid))];
}

export async function setup(options) {
  const client = options.client ?? 'none';
  if (!['none', 'codex', 'pi', 'both'].includes(client)) throw new Error('--client must be codex, pi, both or none.');
  if (options['enable-writes'] && options['read-only']) throw new Error('Choose --enable-writes or --read-only.');
  const commands = {};
  if (client === 'codex' || client === 'both') {
    commands.codex = await executable('codex');
    commands.npx = await executable('npx');
  }
  if (client === 'pi' || client === 'both') commands.pi = await executable('pi');
  if (commands.pi && process.env.DT3_CONFIG) throw new Error('Pi package setup uses the default settings file. Unset DT3_CONFIG, or configure a custom MCP entry in Pi yourself.');
  const path = configPath(process.env);
  const previous = loadSettings(path);
  let config = readConfig({}, previous);
  const discovered = await new Devonthink(config).call('discover');
  const scope = {};
  if (options['database-mode'] !== undefined) scope.DT3_DATABASE_MODE = options['database-mode'];
  if (options['database-uuids'] !== undefined) scope.DT3_DATABASE_UUIDS = options['database-uuids'];
  if (options['exclude-databases'] !== undefined) scope.DT3_EXCLUDE_DATABASE_UUIDS = options['exclude-databases'];
  if (options['enable-writes']) scope.DT3_ENABLE_WRITES = '1';
  if (options['read-only']) scope.DT3_ENABLE_WRITES = '0';
  config = readConfig(scope, config);
  if (options['database-mode'] === undefined && options['database-uuids'] === undefined) {
    if (!process.stdin.isTTY) throw new Error('Interactive setup requires a terminal. Otherwise specify --database-mode open or --database-uuids UUID,UUID.');
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log('Open databases (local setup data; keep private):');
      discovered.databases.forEach((db, i) => console.log(`${i + 1}. ${JSON.stringify(db.name)}  ${db.uuid}`));
      const mode = (await prompt.question('Scope: selected databases [Enter], or type open to follow ALL present and future open databases: ')).trim();
      if (mode && mode !== 'selected' && mode !== 'open') throw new Error('Scope must be selected or open.');
      config.databaseMode = mode || 'selected';
      config.databaseUUIDs = config.databaseMode === 'open' ? [] : selectedUUIDs(await prompt.question('Database numbers, separated by commas (0 = none): '), discovered.databases);
      if (!options['enable-writes'] && !options['read-only']) {
        config.writes = (await prompt.question('Enable write tools with previews? [y/N]: ')).trim().toLowerCase() === 'y';
      }
    } finally { prompt.close(); }
  }
  await writeSettings(path, config);
  console.log(`Saved ${path}. Scope: ${config.databaseMode}; writes: ${config.writes ? 'enabled' : 'disabled'}. Excluded databases: ${config.excludedDatabaseUUIDs.length}.`);
  const spec = `${pkg.name}@${pkg.version}`;
  // Client-owned installers preserve other servers/packages and avoid custom config parsers.
  if (commands.codex) {
    await exec(commands.codex, ['mcp', 'add', 'devonthink3', '--env', `DT3_CONFIG=${path}`, '--', process.execPath, commands.npx, '-y', spec], { timeout: 30000 });
    console.log('Registered Codex server devonthink3. Reconnect or restart Codex.');
  }
  if (commands.pi) {
    for (const source of ['npm:pi-mcp-adapter@2.32.1', `npm:${spec}`]) {
      await exec(commands.pi, ['install', source], { timeout: 120000, maxBuffer: 1024 * 1024 });
    }
    console.log('Installed Pi adapter and MCP package. Restart Pi or use /reload, then /mcp.');
  }
}
