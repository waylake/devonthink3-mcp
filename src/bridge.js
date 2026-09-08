import { spawn } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { BridgeError } from './config.js';

const script = new URL('./jxa.js', import.meta.url);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const writeOps = new Set(['create_record', 'update_record', 'move_record', 'replicate_record', 'import_file']);

// Data travels on stdin. Neither a shell nor process arguments contain document text.
export async function executeJxa(payload, { signal, timeoutMs = 30000 } = {}) {
  if (process.platform !== 'darwin') throw new BridgeError('MACOS_REQUIRED', 'DEVONthink 3 requires macOS.');
  signal?.throwIfAborted();
  const source = await readFile(script, 'utf8');
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', source], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', bytes = 0, failure;
    const stop = error => { failure ??= error; child.kill('SIGKILL'); };
    const cancel = () => stop(new BridgeError('CANCELLED', 'Operation cancelled; re-read before retrying a write.', true));
    const timer = setTimeout(() => stop(new BridgeError('TIMEOUT', 'DEVONthink did not finish in time. Check the app; do not blindly retry a write.', true)), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > 1024 * 1024) stop(new BridgeError('OUTPUT_LIMIT', 'Native result exceeded 1 MiB. Use smaller pages.', true));
      else output += chunk;
    });
    // Native errors may contain document paths or content. Do not forward or log stderr.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => { failure = new BridgeError('AUTOMATION_FAILED', 'Could not start osascript.'); });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (failure) return reject(failure);
      if (code !== 0) return reject(new BridgeError('AUTOMATION_FAILED', 'Check macOS Privacy & Security → Automation and DEVONthink dialogs.', true));
      try {
        const result = JSON.parse(output);
        if (result.error) reject(new BridgeError(result.error.code, result.error.message, result.error.outcomeUnknown));
        else resolve(result);
      } catch { reject(new BridgeError('INVALID_RESPONSE', 'DEVONthink returned an invalid response.', true)); }
    });
    child.stdin.end(JSON.stringify(payload));
    if (signal?.aborted) cancel();
  });
}

export function publicResult(value) {
  if (Array.isArray(value)) return value.map(publicResult);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, data] of Object.entries(value)) {
    if (key === '_state') result.revision = hash(data);
    else result[key] = publicResult(data);
  }
  return result;
}

export async function allowedImport(path, roots) {
  const actual = await realpath(path).catch(() => { throw new BridgeError('IMPORT_DENIED', 'File is unavailable or outside configured import roots.'); });
  let allowed = false;
  for (const root of roots) {
    const canonical = await realpath(root).catch(() => null);
    if (!canonical) continue;
    const child = relative(canonical, actual);
    if (child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)) allowed = true;
  }
  if (!allowed) throw new BridgeError('IMPORT_DENIED', 'File is unavailable or outside configured import roots.');
  const info = await stat(actual);
  if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new BridgeError('IMPORT_LIMIT', 'Import accepts one regular file up to 100 MiB. Use DEVONthink for bulk imports.');
  return actual;
}

export class Devonthink {
  constructor(config, execute = executeJxa) {
    this.config = config;
    this.execute = execute;
    this.queue = Promise.resolve();
    this.pending = 0;
    this.receipts = new Map();
  }

  async call(op, args = {}, signal) {
    if (this.pending >= 16) throw new BridgeError('BUSY', 'Too many queued calls. Wait for earlier work to finish.');
    this.pending++;
    // ponytail: one queue per server process; DEVONthink is a desktop app, not a parallel database service.
    const job = this.queue.then(async () => {
      signal?.throwIfAborted();
      return this.perform(op, args, signal);
    });
    this.queue = job.catch(() => {});
    try { return await job; } finally { this.pending--; }
  }

  async perform(op, args, signal) {
    const write = writeOps.has(op);
    if (write && !this.config.writes) throw new BridgeError('READ_ONLY', 'Restart with DT3_ENABLE_WRITES=1 to expose write tools.');
    const native = (operation, data) => this.execute({ op: operation, args: data, config: this.config }, { signal, timeoutMs: this.config.timeoutMs });
    if (!write) return publicResult(await native(op, args));
    const key = args.request_id;
    const fingerprint = hash({ op, args });
    if (!args.dry_run) {
      const prior = this.receipts.get(key);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new BridgeError('REQUEST_ID_REUSED', 'Use a new request_id for different arguments.');
        if (prior.error) throw prior.error;
        // A tag, parent or database may have become private since the original response.
        for (const id of new Set([args.uuid, args.destination_uuid, args.from_uuid, prior.result.record?.uuid].filter(Boolean))) {
          await native('get_record', { uuid: id });
        }
        return { ...prior.result, replayed: true };
      }
      // Never evict mutation receipts: an old retry could otherwise duplicate a write.
      if (this.receipts.size >= 256) throw new BridgeError('RECEIPT_LIMIT', '256 writes reached. Reconcile results before restarting the server.');
    }
    const data = { ...args };
    data.changes = Object.fromEntries(Object.entries(args).filter(([key]) => !['uuid', 'expected_revision', 'dry_run', 'request_id', 'text'].includes(key)));
    if (args.text !== undefined) {
      data.changes.text_preview = args.text.slice(0, 1000);
      data.changes.text_characters = args.text.length;
      data.changes.text_preview_truncated = args.text.length > 1000;
    }
    if (op === 'import_file') data.path = await allowedImport(args.path, this.config.importRoots);
    if (args.uuid) {
      const current = await native('get_record', { uuid: args.uuid });
      if (hash(current.record._state) !== args.expected_revision) throw new BridgeError('CONFLICT', 'Record changed. Read it again and review a new preview.');
      data.expected_state = current.record._state;
    }
    try {
      const result = publicResult(await native(op, data));
      if (!args.dry_run) this.receipts.set(key, { fingerprint, result });
      return result;
    } catch (error) {
      if (!args.dry_run) this.receipts.set(key, { fingerprint, error });
      throw error;
    }
  }
}
