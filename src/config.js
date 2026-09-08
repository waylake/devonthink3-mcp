import { isAbsolute } from 'node:path';
import * as z from 'zod/v4';

export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .transform(value => value.toUpperCase());
export const recordId = z.string().max(200).transform(value => {
  const match = /^x-devonthink-item:\/\/([0-9a-f-]{36})(?:\?[^#]*)?$/i.exec(value);
  return match ? match[1] : value;
}).pipe(uuid).describe('Record UUID or x-devonthink-item:// link. Link page/search parameters are ignored.');

export function readConfig(env = process.env) {
  const split = value => (value ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const databaseUUIDs = [...new Set(split(env.DT3_DATABASE_UUIDS).map(v => uuid.parse(v)))];
  const writes = z.enum(['0', '1']).parse(env.DT3_ENABLE_WRITES ?? '0') === '1';
  const excludedTags = [...new Set(['mcp-private', ...split(env.DT3_EXCLUDE_TAGS)])];
  const importRoots = z.array(z.string().refine(isAbsolute, 'Import roots must be absolute paths'))
    .parse(JSON.parse(env.DT3_IMPORT_ROOTS ?? '[]'));
  const timeoutMs = z.coerce.number().int().min(1000).max(120000).parse(env.DT3_TIMEOUT_MS ?? 30000);
  return { databaseUUIDs, writes, excludedTags, importRoots, timeoutMs };
}

export class BridgeError extends Error {
  constructor(code, message, outcomeUnknown = false) {
    super(message);
    this.code = code;
    this.outcomeUnknown = outcomeUnknown;
  }
}
