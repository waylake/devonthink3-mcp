import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import * as z from 'zod/v4';

export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .transform(value => value.toUpperCase());
export const recordId = z.string().max(200).transform(value => {
  const match = /^x-devonthink-item:\/\/([0-9a-f-]{36})(?:\?[^#]*)?$/i.exec(value);
  return match ? match[1] : value;
}).pipe(uuid).describe('Record UUID or x-devonthink-item:// link. Link page/search parameters are ignored.');

const settingsSchema = z.strictObject({
  databaseMode: z.enum(['selected', 'open']).default('selected'),
  databaseUUIDs: z.array(uuid).default([]),
  excludedDatabaseUUIDs: z.array(uuid).default([]),
  writes: z.boolean().default(false),
  excludedTags: z.array(z.string().trim().min(1).max(128)).default([]),
  importRoots: z.array(z.string().refine(isAbsolute, 'Import roots must be absolute paths')).default([]),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000)
});

export function configPath(env = process.env) {
  const path = env.DT3_CONFIG ?? join(homedir(), '.config', 'devonthink3-mcp', 'config.json');
  if (!isAbsolute(path)) throw new Error('DT3_CONFIG must be absolute.');
  return path;
}

export function loadSettings(path, required = false) {
  try { return settingsSchema.parse(JSON.parse(readFileSync(path, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT' && !required) return {}; throw error; }
}

export function readConfig(env = process.env, settings = {}) {
  const base = settingsSchema.parse(settings);
  const split = value => (value ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const result = settingsSchema.parse({
    ...base,
    // An explicit UUID override also narrows a previously saved open mode.
    databaseMode: env.DT3_DATABASE_MODE ?? (env.DT3_DATABASE_UUIDS !== undefined ? 'selected' : base.databaseMode),
    databaseUUIDs: env.DT3_DATABASE_UUIDS !== undefined ? split(env.DT3_DATABASE_UUIDS) : base.databaseUUIDs,
    excludedDatabaseUUIDs: env.DT3_EXCLUDE_DATABASE_UUIDS !== undefined ? split(env.DT3_EXCLUDE_DATABASE_UUIDS) : base.excludedDatabaseUUIDs,
    writes: env.DT3_ENABLE_WRITES !== undefined ? z.enum(['0', '1']).parse(env.DT3_ENABLE_WRITES) === '1' : base.writes,
    excludedTags: env.DT3_EXCLUDE_TAGS !== undefined ? split(env.DT3_EXCLUDE_TAGS) : base.excludedTags,
    importRoots: env.DT3_IMPORT_ROOTS !== undefined ? JSON.parse(env.DT3_IMPORT_ROOTS) : base.importRoots,
    timeoutMs: env.DT3_TIMEOUT_MS !== undefined ? Number(env.DT3_TIMEOUT_MS) : base.timeoutMs
  });
  result.excludedTags = [...new Set(['mcp-private', ...result.excludedTags])];
  result.databaseUUIDs = [...new Set(result.databaseUUIDs)];
  result.excludedDatabaseUUIDs = [...new Set(result.excludedDatabaseUUIDs)];
  return result;
}

export class BridgeError extends Error {
  constructor(code, message, outcomeUnknown = false) {
    super(message);
    this.code = code;
    this.outcomeUnknown = outcomeUnknown;
  }
}
