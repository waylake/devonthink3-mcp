// Synthetic benchmark. Requires a running DEVONthink 3 and Automation permission.
// It creates one temporary database, measures both transports interleaved over
// the same records, then closes and removes that database. It never reads or
// mutates user databases.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const exec = promisify(execFile);
const app = 'const a = Application("com.devon-technologies.think3");';
const native = async code => JSON.parse((await exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', code], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 })).stdout);
const records = Number(process.env.DT3_BENCH_RECORDS ?? 100);
const reps = Number(process.env.DT3_BENCH_REPS ?? 3);
const dir = await mkdtemp(join(homedir(), '.devonthink3-mcp-bench-'));
const path = join(dir, 'Benchmark.dtBase2');
let db, worker, oneShot;

async function connect(oneshot) {
  const client = new Client({ name: 'dt3-benchmark', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [resolve('src/index.js')],
    env: {
      ...process.env,
      DT3_CONFIG: join(dir, 'config.json'),
      DT3_DATABASE_MODE: 'selected',
      DT3_DATABASE_UUIDS: db.uuid,
      DT3_EXCLUDE_DATABASE_UUIDS: '',
      DT3_EXCLUDE_TAGS: '',
      DT3_ENABLE_WRITES: '0',
      ...(oneshot ? { DT3_ONESHOT: '1' } : {})
    },
    stderr: 'pipe'
  }));
  return client;
}

async function invoke(client, name, args = {}) {
  const result = await client.callTool({ name: `dt3_${name}`, arguments: args });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  return result.structuredContent;
}

async function timed(fn, count = 1) {
  const start = performance.now();
  await fn();
  return (performance.now() - start) / count;
}

const cases = [
  { label: 'status (10 calls)', run: c => Promise.all(Array.from({ length: 10 }, () => invoke(c, 'status'))), count: 10 },
  { label: 'get_record (10 calls)', run: async c => { for (const uuid of db.ids.slice(0, 10)) await invoke(c, 'get_record', { uuid }); }, count: 10 },
  { label: 'list_group 100', run: c => invoke(c, 'list_group', { uuid: db.group, limit: 200 }), count: records },
  { label: 'get_records 100', run: c => invoke(c, 'get_records', { uuids: db.ids }), count: records },
  { label: 'read_texts 100', run: c => invoke(c, 'read_texts', { uuids: db.ids, limit: 2000, max_total_characters: 200000 }), count: records },
  { label: 'search name:Doc', run: c => invoke(c, 'search', { database_uuid: db.uuid, query: 'name:Doc', limit: 200 }), count: records }
];

try {
  await writeFile(join(dir, 'config.json'), '{}');
  await native(`${app} JSON.stringify({ok:true});`);
  db = await native(`${app} const d = a.createDatabase(${JSON.stringify(path)}); const g = a.createRecordWith({name:'Bench', type:'group'}, {in:d.root()}); const ids=[]; for (let i=0;i<${records};i++){ const r=a.createRecordWith({name:'Doc '+i, type:'markdown', 'plain text':'Synthetic benchmark document '+i+'. '+ 'lorem ipsum '.repeat(200)}, {in:g}); ids.push(r.uuid()); } JSON.stringify({uuid:d.uuid(), root:d.root().uuid(), group:g.uuid(), ids:ids});`);
  await new Promise(done => setTimeout(done, 3000));
  worker = await connect(false);
  oneShot = await connect(true);
  for (const client of [worker, oneShot]) for (const item of cases) await item.run(client);
  const rows = [];
  for (const item of cases) {
    const workerSamples = [], oneShotSamples = [];
    for (let i = 0; i < reps; i++) {
      workerSamples.push(await timed(() => item.run(worker), item.count));
      oneShotSamples.push(await timed(() => item.run(oneShot), item.count));
    }
    rows.push({ label: item.label, worker: Math.min(...workerSamples), oneShot: Math.min(...oneShotSamples) });
  }
  console.log(`\nSynthetic benchmark: ${records} Markdown records, best of ${reps} interleaved runs, ms per item\n`);
  console.log('operation'.padEnd(26), 'worker'.padStart(10), 'one-shot'.padStart(10), 'speedup'.padStart(9));
  for (const row of rows) {
    console.log(row.label.padEnd(26), row.worker.toFixed(1).padStart(10), row.oneShot.toFixed(1).padStart(10), `${(row.oneShot / row.worker).toFixed(1)}x`.padStart(9));
  }
  console.log('\nworker = one persistent osascript process; one-shot = one process per MCP call.');
} finally {
  await worker?.close();
  await oneShot?.close();
  if (db) await native(`${app} const ds=a.databases(); for(let i=0;i<ds.length;i++){ if(ds[i].uuid()===${JSON.stringify(db.uuid)}) ds[i].close(); } JSON.stringify(true);`).catch(() => {});
  await rm(dir, { recursive: true, force: true });
}
