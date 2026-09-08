import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { readConfig, loadSettings, recordId, BridgeError } from '../src/config.js';
import { selectedUUIDs, writeSettings } from '../src/setup.js';
import pkg from '../package.json' with { type: 'json' };
import { Devonthink, allowedImport, publicResult } from '../src/bridge.js';
import { createServer } from '../src/server.js';

const id = '11111111-1111-4111-8111-111111111111';
test('configuration fails closed; item links are data, never code', () => {
  assert.deepEqual(readConfig({}).databaseUUIDs, []);
  assert.equal(readConfig({}).writes, false);
  assert.equal(readConfig({}).databaseMode, 'selected');
  assert.throws(() => readConfig({ DT3_DATABASE_MODE: '*' }));
  assert.throws(() => readConfig({}, { unexpected: true }));
  assert.equal(readConfig({ DT3_DATABASE_UUIDS: id }, { databaseMode: 'open' }).databaseMode, 'selected');
  assert.equal(readConfig({ DT3_ENABLE_WRITES: '0' }, { writes: true }).writes, false);
  assert.throws(() => readConfig({ DT3_DATABASE_UUIDS: '*' }));
  assert.throws(() => readConfig({ DT3_ENABLE_WRITES: 'true' }));
  assert.throws(() => readConfig({ DT3_IMPORT_ROOTS: '["relative"]' }));
  assert.throws(() => readConfig({ DT3_TIMEOUT_MS: '0' }));
  assert.equal(recordId.parse(`x-devonthink-item://${id}?page=2`), id);
  assert.throws(() => recordId.parse('"; Application("Terminal").activate(); //'));
});

test('setup validates selections, preserves settings, backs up exact bytes and ships a pinned Pi manifest', async () => {
  assert.deepEqual(selectedUUIDs('1, 1', [{ uuid: id }]), [id]);
  assert.deepEqual(selectedUUIDs('0', []), []);
  for (const value of ['', '2', '1.5', '1x', '0,1']) assert.throws(() => selectedUUIDs(value, [{ uuid: id }]));
  const dir = await mkdtemp(join(tmpdir(), 'dt3-settings-test-'));
  try {
    const path = join(dir, 'config.json');
    assert.deepEqual(loadSettings(path), {});
    assert.throws(() => loadSettings(path, true));
    await writeSettings(path, { databaseMode: 'open', excludedDatabaseUUIDs: [id], writes: true });
    const before = await readFile(path, 'utf8');
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
    const config = readConfig({ DT3_ENABLE_WRITES: '0' }, loadSettings(path));
    assert.equal(config.databaseMode, 'open');
    assert.deepEqual(config.excludedDatabaseUUIDs, [id]);
    assert.equal(config.writes, false);
    await writeSettings(path, { ...loadSettings(path), writes: false });
    assert.equal(await readFile(`${path}.bak`, 'utf8'), before);
    await writeFile(path, '{broken');
    await assert.rejects(writeSettings(path, {}));
    assert.equal(await readFile(path, 'utf8'), '{broken');
    const manifest = JSON.parse(await readFile(new URL('../mcp.json', import.meta.url), 'utf8'));
    assert.deepEqual(manifest.mcpServers.devonthink3.args, ['-y', `${pkg.name}@${pkg.version}`]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('imports respect real paths, reject symlink escapes and directories', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dt3-path-test-'));
  const outside = await mkdtemp(join(tmpdir(), 'dt3-outside-test-'));
  try {
    const file = join(dir, 'note.txt'); await writeFile(file, 'synthetic');
    const secret = join(outside, 'outside.txt'); await writeFile(secret, 'synthetic');
    await symlink(secret, join(dir, 'escape.txt'));
    assert.equal(await allowedImport(file, [dir]), await (await import('node:fs/promises')).realpath(file));
    await assert.rejects(allowedImport(file, []), { code: 'IMPORT_DENIED' });
    await assert.rejects(allowedImport(join(dir, 'escape.txt'), [dir]), { code: 'IMPORT_DENIED' });
    await assert.rejects(allowedImport(dir, [dir]), { code: 'IMPORT_DENIED' });
  } finally { await rm(dir, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('writes have conflict detection, bounded replay protection, previews and unknown-outcome protection', async () => {
  let calls = 0, state = { name: 'before', tags: [] };
  const service = new Devonthink(readConfig({ DT3_ENABLE_WRITES: '1' }), async ({ op, args }) => {
    if (op === 'get_record') return { record: { _state: state } };
    calls++;
    if (args.name === 'timeout') throw new BridgeError('TIMEOUT', 'Timed out', true);
    return { dry_run: args.dry_run, applied: !args.dry_run, operation: op, before: null, changes: args.changes };
  });
  const revision = publicResult({ _state: state }).revision;
  const args = { uuid: id, expected_revision: revision, request_id: 'request-0001', dry_run: false, name: 'after' };
  const first = await service.call('update_record', args);
  assert.equal(first.applied, true);
  assert.equal((await service.call('update_record', args)).replayed, true);
  assert.equal(calls, 1);
  await assert.rejects(service.call('update_record', { ...args, name: 'different' }), { code: 'REQUEST_ID_REUSED' });
  state = { name: 'changed', tags: [] };
  await assert.rejects(service.call('update_record', { ...args, request_id: 'request-0002' }), { code: 'CONFLICT' });
  assert.equal(calls, 1);
  const preview = await service.call('create_record', { dry_run: true, request_id: 'preview-0001', text: 'x'.repeat(1100), name: 'preview' });
  assert.equal(preview.changes.text_preview.length, 1000);
  assert.equal(preview.changes.text_preview_truncated, true);
  const uncertain = { dry_run: false, request_id: 'timeout-0001', name: 'timeout' };
  await assert.rejects(service.call('create_record', uncertain), { code: 'TIMEOUT' });
  const count = calls;
  await assert.rejects(service.call('create_record', uncertain), { code: 'TIMEOUT' });
  assert.equal(calls, count);
  service.receipts = new Map(Array.from({ length: 256 }, (_, i) => [String(i), {}]));
  await assert.rejects(service.call('create_record', { dry_run: false, request_id: 'new-receipt' }), { code: 'RECEIPT_LIMIT' });
  await assert.rejects(new Devonthink(readConfig({})).call('create_record', {}), { code: 'READ_ONLY' });
});

test('queue is serial, bounded and does not execute cancelled queued calls', async () => {
  let release, calls = 0;
  const blocked = new Promise(resolve => { release = resolve; });
  const service = new Devonthink(readConfig({}), async () => { calls++; await blocked; return {}; });
  const controller = new AbortController();
  const first = service.call('status');
  const cancelled = service.call('status', {}, controller.signal);
  controller.abort();
  const rest = Array.from({ length: 14 }, () => service.call('status'));
  await assert.rejects(service.call('status'), { code: 'BUSY' });
  release(); await first; await assert.rejects(cancelled); await Promise.all(rest);
  assert.equal(calls, 15);
});

test('native policy blocks excluded ancestors, replicants and all unconfigured records before text reads', async () => {
  const source = await readFile(new URL('../src/jxa.js', import.meta.url), 'utf8');
  const db = { uuid: () => id, trashGroup: { uuid: () => 'trash' } };
  let reads = 0;
  const record = (uuid, tags, parents) => ({ uuid: () => uuid, database: () => db, tags: () => tags, parents: () => parents, plainText: () => { reads++; return 'secret'; } });
  const root = record('root', [], []), hidden = record('hidden', ['MCP-PRIVATE'], [root]);
  const child = record('child', [], [hidden]), replicant = record('replicant', [], [root, hidden]);
  const broken = record('broken', [], []); broken.parents = () => { throw new Error('unavailable'); };
  const app = { running: () => true, version: () => '3.9.18', databases: () => [db], getRecordWithUuid: key => ({ child, replicant, broken })[key] };
  for (const [key, ids, mode, excluded] of [['child', [id]], ['replicant', [id]], ['broken', [id]], ['child', []], ['replicant', [], 'open'], ['child', [], 'open', [id]]]) {
    const input = JSON.stringify({ op: 'read_text', args: { uuid: key, offset: 0, limit: 8000 }, config: { databaseUUIDs: ids, excludedTags: ['mcp-private'], databaseMode: mode, excludedDatabaseUUIDs: excluded } });
    const $ = { NSFileHandle: { fileHandleWithStandardInput: { readDataToEndOfFile: input } }, NSString: { alloc: { initWithDataEncoding: x => x } } };
    const output = vm.runInNewContext(`${source}\nrun()`, { ObjC: { import() {}, unwrap: x => x }, $, Application: () => app });
    assert.equal(JSON.parse(output).error.code, 'NOT_FOUND_OR_DENIED');
  }
  assert.equal(reads, 0);
});

for (const modern of [false, true]) test(`MCP ${modern ? '2026 stateless' : '2025 legacy'} schemas, tools, resources and prompts`, async () => {
  let calls = 0;
  const service = { config: { writes: false }, call: async op => {
    calls++;
    if (op === 'status') return { running: true, version: '3.9.18', writes_enabled: false, database_mode: 'selected', configured_databases: 0, permitted_open_databases: 0, text_source: 'DEVONthink plain text index' };
    return { databases: [] };
  } };
  const client = new Client({ name: 'test', version: '1.0.0' }, modern ? { versionNegotiation: { mode: 'auto' } } : {});
  let close;
  if (modern) {
    const handler = createMcpHandler(() => createServer(service));
    await client.connect(new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), { fetch: (url, init) => handler.fetch(new Request(url, init)) }));
    close = () => handler.close();
    assert.ok(client.getDiscoverResult());
  } else {
    const server = createServer(service), [c, s] = InMemoryTransport.createLinkedPair();
    await server.connect(s); await client.connect(c); close = () => server.close();
  }
  try {
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 8);
    assert.ok(tools.every(tool => tool.annotations.readOnlyHint && tool.outputSchema));
    assert.equal((await client.callTool({ name: 'dt3_status', arguments: {} })).structuredContent.version, '3.9.18');
    const before = calls;
    assert.equal((await client.callTool({ name: 'dt3_search', arguments: { database_uuid: id, query: 'hello', limit: 1000 } })).isError, true);
    assert.equal((await client.callTool({ name: 'dt3_status', arguments: { unexpected: 'arg' } })).isError, true);
    assert.equal(calls, before);
    assert.equal((await client.listPrompts()).prompts.length, 2);
    assert.match((await client.getPrompt({ name: 'research', arguments: { question: 'Synthetic test' } })).messages[0].content.text, /untrusted/);
    assert.match((await client.readResource({ uri: 'devonthink3://guide' })).contents[0].text, /UNTRUSTED/);
    assert.equal((await client.listResourceTemplates()).resourceTemplates.length, 1);
  } finally { await client.close(); await close(); }
});
