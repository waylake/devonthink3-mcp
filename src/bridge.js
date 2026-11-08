import { spawn } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { BridgeError } from './config.js';

const scriptPath = fileURLToPath(new URL('./jxa.js', import.meta.url));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const writeOps = new Set(['create_record', 'update_record', 'move_record', 'replicate_record', 'import_file']);
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const WORKER_IDLE_MS = 5 * 60 * 1000;
const WORKER_MAX_REQUESTS = 2000;

// Data travels on stdin. Neither a shell nor process arguments contain document text.
export async function executeJxa(payload, { signal, timeoutMs = 30000 } = {}) {
  if (process.platform !== 'darwin') throw new BridgeError('MACOS_REQUIRED', 'DEVONthink 3 requires macOS.');
  signal?.throwIfAborted();
  const source = await readFile(scriptPath, 'utf8');
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
      if (bytes > MAX_RESPONSE_BYTES) stop(new BridgeError('OUTPUT_LIMIT', 'Native result exceeded the response limit. Use smaller pages.', true));
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

// A persistent osascript process removes two fixed costs from every call:
// process/script startup and the initial `app.databases()` Apple Event.
// Requests and responses are one JSON object per line on the worker's stdio.
export class WorkerTransport {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.pending = new Map();
    this.nextId = 1;
    this.requests = 0;
    this.startPromise = null;
    this.startResolve = null;
    this.startReject = null;
    this.startTimer = null;
    this.idleTimer = null;
  }

  start() {
    if (this.child) return;
    if (process.platform !== 'darwin') throw new BridgeError('MACOS_REQUIRED', 'DEVONthink 3 requires macOS.');
    const child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', scriptPath, '--worker'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.buffer = '';
    this.requests = 0;
    this.startPromise = new Promise((resolve, reject) => { this.startResolve = resolve; this.startReject = reject; });
    this.startTimer = setTimeout(() => {
      this.kill(new BridgeError('AUTOMATION_FAILED', 'The DEVONthink worker did not start in time.'));
    }, 10000);
    this.startTimer.unref();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.receive(chunk));
    // stderr can contain paths or document text. Drain it; never forward it.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => this.kill(new BridgeError('AUTOMATION_FAILED', 'Could not start osascript.')));
    child.on('close', () => this.kill(new BridgeError('WORKER_EXITED', 'The DEVONthink worker stopped. The operation may not have completed; re-read before retrying a write.', true)));
  }

  async ensureStarted() {
    if (!this.child) this.start();
    if (this.startPromise) await this.startPromise;
    if (!this.child) throw new BridgeError('AUTOMATION_FAILED', 'The DEVONthink worker is unavailable.');
  }

  receive(chunk) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_RESPONSE_BYTES) {
      this.kill(new BridgeError('OUTPUT_LIMIT', 'Native result exceeded the response limit. Use smaller pages.'));
      return;
    }
    let newline;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { this.kill(new BridgeError('INVALID_RESPONSE', 'The DEVONthink worker returned an invalid response.')); return; }
      this.handle(message);
    }
  }

  handle(message) {
    if (message.ready) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
      const resolve = this.startResolve;
      this.startPromise = null;
      this.startResolve = null;
      this.startReject = null;
      resolve?.();
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener('abort', pending.cancel);
    if (message.error) pending.reject(new BridgeError(message.error.code, message.error.message, message.error.outcomeUnknown));
    else pending.resolve(message.result);
    this.requests++;
    if (this.requests >= WORKER_MAX_REQUESTS) {
      // Recycle after a bounded number of requests so a long-lived process
      // cannot accumulate native objects indefinitely.
      this.kill();
    } else {
      this.armIdle();
    }
  }

  armIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.pending.size) return;
    this.idleTimer = setTimeout(() => this.kill(), WORKER_IDLE_MS);
    this.idleTimer.unref();
  }

  async request(payload, { signal, timeoutMs = 30000, write = false } = {}) {
    if (process.platform !== 'darwin') throw new BridgeError('MACOS_REQUIRED', 'DEVONthink 3 requires macOS.');
    signal?.throwIfAborted();
    await this.ensureStarted();
    if (signal?.aborted) throw new BridgeError('CANCELLED', 'Operation cancelled; re-read before retrying a write.', write);
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const cancel = () => {
        this.rejectPending(id, new BridgeError('CANCELLED', 'Operation cancelled; re-read before retrying a write.', write));
        this.kill();
      };
      const timer = setTimeout(() => {
        this.rejectPending(id, new BridgeError('TIMEOUT', 'DEVONthink did not finish in time. Check the app; do not blindly retry a write.', write));
        this.kill();
      }, timeoutMs);
      timer.unref();
      signal?.addEventListener('abort', cancel, { once: true });
      this.pending.set(id, { resolve, reject, timer, cancel, signal });
      try {
        this.child.stdin.write(JSON.stringify({ id, ...payload }) + '\n');
      } catch {
        this.rejectPending(id, new BridgeError('AUTOMATION_FAILED', 'Could not send a request to the DEVONthink worker.', write));
        this.kill();
      }
    });
  }

  rejectPending(id, error) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener('abort', pending.cancel);
    pending.reject(error);
  }

  kill(error) {
    const child = this.child;
    const wasStarting = this.startPromise !== null;
    this.child = null;
    this.buffer = '';
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.startTimer) { clearTimeout(this.startTimer); this.startTimer = null; }
    if (wasStarting) {
      const reject = this.startReject;
      this.startPromise = null;
      this.startResolve = null;
      this.startReject = null;
      reject?.(error || new BridgeError('AUTOMATION_FAILED', 'The DEVONthink worker stopped.'));
    }
    const failure = error || new BridgeError('WORKER_EXITED', 'The DEVONthink worker stopped.');
    for (const [id] of this.pending) this.rejectPending(id, failure);
    if (child) child.kill('SIGKILL');
  }

  close() { this.kill(); }
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
  constructor(config, execute) {
    this.config = config;
    const useWorker = !execute && process.env.DT3_ONESHOT !== '1';
    this.worker = useWorker ? new WorkerTransport() : null;
    this.execute = execute || (useWorker ? (payload, options) => this.worker.request(payload, options) : executeJxa);
    this.queue = Promise.resolve();
    this.pending = 0;
    this.receipts = new Map();
    this.previews = new Map();
  }

  async call(op, args = {}, signal) {
    if (this.pending >= 16) throw new BridgeError('BUSY', 'Too many queued calls. Wait for earlier work to finish.');
    this.pending++;
    // One queue per server process; DEVONthink is a desktop app, not a parallel database service.
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
    // Only an actual apply can mutate; previews and internal metadata reads
    // are safe to retry even when they belong to a write tool.
    const mutating = write && args.dry_run === false;
    const native = (operation, data, isWrite = mutating) => this.execute({ op: operation, args: data, config: this.config }, { signal, timeoutMs: this.config.timeoutMs, write: isWrite });
    if (!write) return publicResult(await native(op, args));
    const key = args.request_id;
    // A preview and its apply differ only by dry_run. Reuse the state captured
    // by the preview so an authorized write does not re-read the record twice.
    const canonical = Object.fromEntries(Object.entries(args).filter(([name]) => name !== 'dry_run').sort(([a], [b]) => a.localeCompare(b)));
    const fingerprint = hash({ op, args: canonical });
    if (!args.dry_run) {
      const prior = this.receipts.get(key);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new BridgeError('REQUEST_ID_REUSED', 'Use a new request_id for different arguments.');
        if (prior.error) throw prior.error;
        // A tag, parent or database may have become private since the original response.
        for (const id of new Set([args.uuid, args.destination_uuid, args.from_uuid, prior.result.record?.uuid].filter(Boolean))) {
          await native('get_record', { uuid: id }, false);
        }
        return { ...prior.result, replayed: true };
      }
      // Never evict mutation receipts: an old retry could otherwise duplicate a write.
      if (this.receipts.size >= 256) throw new BridgeError('RECEIPT_LIMIT', '256 writes reached. Reconcile results before restarting the server.');
    }
    const data = { ...args };
    data.changes = Object.fromEntries(Object.entries(args).filter(([name]) => !['uuid', 'expected_revision', 'dry_run', 'request_id', 'text'].includes(name)));
    if (args.text !== undefined) {
      data.changes.text_preview = args.text.slice(0, 1000);
      data.changes.text_characters = args.text.length;
      data.changes.text_preview_truncated = args.text.length > 1000;
    }
    if (op === 'import_file') data.path = await allowedImport(args.path, this.config.importRoots);
    const preview = !args.dry_run ? this.previews.get(key) : null;
    if (preview && preview.fingerprint === fingerprint && args.expected_revision) {
      if (hash(preview.state) !== args.expected_revision) throw new BridgeError('CONFLICT', 'Record changed. Read it again and review a new preview.');
      data.expected_state = preview.state;
    } else if (args.uuid) {
      if (preview) this.previews.delete(key);
      const current = await native('get_record', { uuid: args.uuid }, false);
      if (hash(current.record._state) !== args.expected_revision) throw new BridgeError('CONFLICT', 'Record changed. Read it again and review a new preview.');
      data.expected_state = current.record._state;
    }
    try {
      const raw = await native(op, data);
      const result = publicResult(raw);
      if (args.dry_run) {
        const state = raw.before?._state;
        if (state) {
          if (this.previews.size >= 128) this.previews.delete(this.previews.keys().next().value);
          this.previews.set(key, { fingerprint, state });
        }
      } else {
        this.previews.delete(key);
        this.receipts.set(key, { fingerprint, result });
      }
      return result;
    } catch (error) {
      if (error.code === 'CONFLICT') this.previews.delete(key);
      if (!args.dry_run) this.receipts.set(key, { fingerprint, error });
      throw error;
    }
  }

  close() { this.worker?.close(); }
}
