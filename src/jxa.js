/* Runs in Apple's JavaScript for Automation, not Node. No caller-supplied code. */
ObjC.import('Foundation');

// Native handles are cached for the lifetime of one osascript process. The MCP
// bridge keeps a worker alive between calls, so database discovery no longer
// costs an Apple Event round trip on every request. Visibility decisions stay
// per-request: a tag or parent can change between calls.
var appCache = null;
var databasesCache = null;
var trashCache = {};

function application() {
  if (!appCache) appCache = Application('com.devon-technologies.think3');
  return appCache;
}

function refreshDatabases() {
  var list = application().databases();
  var entries = [];
  for (var i = 0; i < list.length; i++) {
    entries.push({ db: list[i], uuid: list[i].uuid().toUpperCase() });
  }
  databasesCache = entries;
  return entries;
}

function databases() {
  return databasesCache || refreshDatabases();
}

function fail(code, message) { throw { bridgeCode: code, message: message }; }

function createContext(config) {
  return {
    config: config,
    deniedTags: (config.excludedTags || []).map(function (tag) { return tag.toLowerCase(); }),
    decisions: {},
    trash: {}
  };
}

function dbAllowedId(id, ctx) {
  var config = ctx.config;
  return (config.excludedDatabaseUUIDs || []).indexOf(id) === -1 &&
    (config.databaseMode === 'open' || config.databaseUUIDs.indexOf(id) !== -1);
}

function dbAllowed(entry, ctx) { return dbAllowedId(entry.uuid, ctx); }

function visible(record, ctx, active, depth, knownDb) {
  var id = record.uuid();
  if (ctx.decisions[id] !== undefined) return ctx.decisions[id];
  if (depth > 64 || active[id]) return false;
  // Parents, replicants and children always live in the same database, so a
  // caller that already resolved the database can skip two Apple Events.
  var dbid = knownDb;
  if (!dbid) {
    var db = record.database();
    dbid = db.uuid().toUpperCase();
  }
  if (!dbAllowedId(dbid, ctx)) return false;
  if (!ctx.trash[dbid]) {
    var owner = knownDb ? record.database() : db;
    ctx.trash[dbid] = owner.trashGroup.uuid();
  }
  if (id === ctx.trash[dbid]) return false;
  var tags = record.tags();
  if (tags.some(function (tag) { return ctx.deniedTags.indexOf(String(tag).toLowerCase()) !== -1; })) return false;
  active[id] = true;
  var parents = record.parents();
  for (var i = 0; i < parents.length; i++) {
    if (!visible(parents[i], ctx, active, depth + 1, dbid)) { delete active[id]; return false; }
  }
  delete active[id];
  // Reuse the UUID and tags that visibility already read. Listings otherwise
  // pay for both twice per record.
  var info = { id: id, tags: tags };
  ctx.decisions[id] = info;
  return info;
}

function allowed(record, ctx, knownDb) {
  try { return visible(record, ctx, {}, 0, knownDb); } catch (_) { return false; }
}

function findRecord(id, ctx) {
  var entries = databases();
  for (var i = 0; i < entries.length; i++) {
    if (!dbAllowed(entries[i], ctx)) continue;
    var record = null;
    try { record = application().getRecordWithUuid(id, { in: entries[i].db }); } catch (_) { record = null; }
    if (record && allowed(record, ctx, entries[i].uuid)) return record;
  }
  return null;
}

function resolve(id, ctx) {
  var record = findRecord(id, ctx);
  if (!record) {
    // A database opened after the cached discovery must become visible.
    refreshDatabases();
    record = findRecord(id, ctx);
  }
  if (record) return record;
  fail('NOT_FOUND_OR_DENIED', 'Record is unavailable or outside the permitted scope.');
}

function dbUsable(entry) {
  try { entry.db.root().uuid(); return true; } catch (_) { return false; }
}

function findDatabase(id, ctx) {
  var entries = databases();
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].uuid === id && dbAllowed(entries[i], ctx)) return entries[i];
  }
  return null;
}

function database(id, ctx) {
  var entry = findDatabase(id, ctx);
  if (entry && dbUsable(entry)) return entry.db;
  refreshDatabases();
  entry = findDatabase(id, ctx);
  if (entry && dbUsable(entry)) return entry.db;
  fail('ACCESS_DENIED', 'Database is not open or is outside the configured scope.');
}

function group(id, writable, ctx) {
  var record = resolve(id, ctx);
  var type = record.type();
  if (type !== 'group' && (!(!writable && type === 'smart group'))) fail('NOT_A_GROUP', 'Choose a regular group for writes, or a group/smart group for browsing.');
  return record;
}

function bounded(value, limit) { return String(value == null ? '' : value).slice(0, limit); }
function date(value) { return value instanceof Date ? value.toISOString() : null; }

function state(record, access) {
  return {
    uuid: access ? access.id : record.uuid(), name: record.name(), tags: access ? access.tags : record.tags(), comment: record.comment(),
    modified: date(record.modificationDate()), contentHash: record.contentHash(),
    rating: record.rating(), unread: record.unread(), flagged: record.state(),
    parents: record.parents.uuid().sort(),
    locked: record.locking(), indexed: record.indexed()
  };
}

function brief(record, dbUuid, access) {
  var id = access ? access.id : record.uuid();
  return {
    uuid: id, database_uuid: dbUuid || record.database.uuid(), name: bounded(record.name(), 1024),
    type: record.type(),
    // DEVONthink item links are the UUID form; constructing one avoids an
    // Apple Event per record and keeps the citation identical to referenceURL().
    item_url: 'x-devonthink-item://' + id,
    resource_uri: 'devonthink3://record/' + id,
    tags: (access ? access.tags : record.tags()).slice(0, 64).map(function (tag) { return bounded(tag, 256); }),
    modified: date(record.modificationDate())
  };
}

function detail(record, dbUuid, access) {
  var result = brief(record, dbUuid, access);
  result.location = bounded(record.location(), 4096);
  result.comment = bounded(record.comment(), 8000);
  result.size_bytes = record.size();
  result.page_count = record.pageCount();
  result.pending = record.pending();
  result.indexed = record.indexed();
  result.locked = record.locking();
  result._state = state(record, access);
  if (JSON.stringify(result._state).length > 64000) fail('METADATA_LIMIT', 'Record metadata exceeds the edit limit; use the DEVONthink UI.');
  return result;
}

function page(records, relation, dbUuid, ctx, offset, limit) {
  offset = offset || 0;
  limit = limit || 25;
  var result = [], examined = 0;
  for (; offset < records.length && result.length < limit && examined < 5000; offset++, examined++) {
    var record = records[offset];
    var access = allowed(record, ctx, dbUuid);
    if (access) {
      var item = brief(record, dbUuid, access);
      if (relation === 'similar' || relation === 'classify') {
        var score = record.score();
        item.score = typeof score === 'number' && isFinite(score) ? score : null;
      }
      result.push(item);
    }
  }
  return { records: result, next_offset: offset < records.length ? offset : null, snapshot: false };
}

function textChunk(record, offset, limit) {
  if (record.type() === 'group' || record.type() === 'smart group') fail('NOT_A_DOCUMENT', 'Use list_group to browse a group.');
  if (record.pending()) fail('CONTENT_PENDING', 'Download this document in DEVONthink before reading it.');
  if (record.characterCount() > 5000000) fail('TEXT_LIMIT', 'The indexed text exceeds five million characters. Inspect this document in DEVONthink.');
  var raw = record.plainText();
  var text = raw == null ? '' : String(raw);
  var start = offset || 0;
  if (start > text.length) fail('INVALID_OFFSET', 'Offset exceeds the current text length.');
  var end = Math.min(text.length, start + limit);
  // Keep UTF-16 offsets without cutting a surrogate pair at a chunk boundary.
  if (end < text.length && /[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end--;
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text.charAt(start))) fail('INVALID_OFFSET', 'Use next_offset returned by the previous chunk.');
  return { text: text.slice(start, end), offset: start, next_offset: end < text.length ? end : null, total_characters: text.length, text_status: text.length ? 'available' : 'no_text' };
}

function checkWrite(record, config) {
  if (!config.writes) fail('READ_ONLY', 'Writes are disabled.');
  if (record.database.readOnly() || record.locking()) fail('LOCKED', 'Database or record is read-only or locked.');
  if (record.indexed()) fail('INDEXED_WRITE_DENIED', 'Indexed originals must be edited through their source application.');
}

function errorFor(error, mutationStarted) {
  return {
    code: error.bridgeCode || (error.errorNumber === -1743 ? 'AUTOMATION_DENIED' : 'AUTOMATION_FAILED'),
    message: error.bridgeCode ? error.message : 'DEVONthink automation failed. Check permissions, open databases, and pending dialogs.',
    outcomeUnknown: mutationStarted
  };
}

function dispatch(request) {
  var mutationStarted = false;
  try {
    var args = request.args || {}, config = request.config || {};
    var ctx = createContext(config);
    var app = application();
    if (!app.running()) fail('NOT_RUNNING', 'Open DEVONthink 3 and the intended databases first.');
    var version = app.version();
    if (!/^3\./.test(version)) fail('UNSUPPORTED_VERSION', 'This server targets DEVONthink 3. Use the native MCP server for DEVONthink 4.');

    if (request.op === 'status') {
      refreshDatabases();
      return { result: { running: true, version: version, writes_enabled: config.writes, database_mode: config.databaseMode || 'selected', configured_databases: (config.databaseUUIDs || []).length, permitted_open_databases: databases().filter(function (entry) { return dbAllowed(entry, ctx); }).length, text_source: 'DEVONthink plain text index' } };
    }
    if (request.op === 'databases') {
      refreshDatabases();
      return { result: { databases: databases().filter(function (entry) { return dbAllowed(entry, ctx); }).map(function (entry) { return { uuid: entry.uuid, name: bounded(entry.db.name(), 1024), root_uuid: entry.db.root().uuid(), read_only: entry.db.readOnly() }; }) } };
    }
    // Local CLI only. Never registered as an MCP tool or resource.
    if (request.op === 'discover') {
      refreshDatabases();
      return { result: { version: version, databases: databases().map(function (entry) { return { uuid: entry.uuid, name: bounded(entry.db.name(), 1024) }; }) } };
    }
    if (request.op === 'selection') {
      return { result: page(app.selectedRecords(), null, null, ctx, args.offset, args.limit) };
    }
    if (request.op === 'search') {
      var db = database(args.database_uuid, ctx);
      var root = args.group_uuid ? group(args.group_uuid, false, ctx) : db.root();
      if (root.database.uuid() !== db.uuid() || !allowed(root, ctx)) fail('ACCESS_DENIED', 'Search group must be inside the selected permitted database.');
      return { result: page(app.search(args.query, { in: root, excludeSubgroups: !args.recursive }), null, db.uuid(), ctx, args.offset, args.limit) };
    }
    if (request.op === 'list_group') {
      var parent = group(args.uuid, false, ctx);
      return { result: page(parent.children(), null, parent.database.uuid(), ctx, args.offset, args.limit) };
    }
    if (request.op === 'get_record') {
      var target = resolve(args.uuid, ctx), result = detail(target);
      if (args.include_custom_metadata) {
        var metadata = target.customMetaData() || {};
        if (JSON.stringify(metadata).length > 16000) fail('METADATA_LIMIT', 'Custom metadata exceeds 16,000 characters; inspect it in DEVONthink.');
        result.custom_metadata = metadata;
      }
      return { result: { record: result } };
    }
    if (request.op === 'get_records') {
      var records = [], errors = [];
      var uuids = args.uuids || [];
      for (var i = 0; i < uuids.length; i++) {
        try {
          var item = resolve(uuids[i], ctx);
          var row = detail(item, item.database.uuid());
          if (args.include_custom_metadata) {
            var custom = item.customMetaData() || {};
            if (JSON.stringify(custom).length > 16000) fail('METADATA_LIMIT', 'Custom metadata exceeds 16,000 characters; inspect it in DEVONthink.');
            row.custom_metadata = custom;
          }
          records.push(row);
        } catch (error) {
          var info = errorFor(error, false);
          errors.push({ uuid: uuids[i], code: info.code, message: info.message });
        }
      }
      return { result: { records: records, errors: errors } };
    }
    if (request.op === 'read_text') {
      var textRecord = resolve(args.uuid, ctx);
      var chunk = textChunk(textRecord, args.offset, args.limit);
      return { result: { record: detail(textRecord), text: chunk.text, offset: chunk.offset, next_offset: chunk.next_offset, total_characters: chunk.total_characters, text_status: chunk.text_status, source: 'devonthink_plain_text', untrusted: true } };
    }
    if (request.op === 'read_texts') {
      var documents = [], textErrors = [], used = 0, next = null;
      var list = args.uuids || [];
      var budget = args.max_total_characters || 60000;
      var wanted = args.limit || 4000;
      var startOffset = args.offset || 0;
      for (var j = 0; j < list.length; j++) {
        var remaining = budget - used;
        if (remaining < 2) { next = { index: j, uuid: list[j], offset: startOffset }; break; }
        var perDocument = Math.min(wanted, remaining);
        try {
          var doc = resolve(list[j], ctx);
          var part = textChunk(doc, startOffset, perDocument);
          documents.push({ record: brief(doc, doc.database.uuid()), text: part.text, offset: part.offset, next_offset: part.next_offset, total_characters: part.total_characters, text_status: part.text_status });
          used += part.text.length;
          if (perDocument < wanted) {
            if (part.next_offset !== null) next = { index: j, uuid: list[j], offset: part.next_offset };
            else if (j + 1 < list.length) next = { index: j + 1, uuid: list[j + 1], offset: startOffset };
            break;
          }
        } catch (textError) {
          var textInfo = errorFor(textError, false);
          textErrors.push({ uuid: list[j], code: textInfo.code, message: textInfo.message });
        }
      }
      return { result: { documents: documents, errors: textErrors, total_characters: used, next: next, truncated: next !== null, untrusted: true } };
    }
    if (request.op === 'related') {
      var relatedRecord = resolve(args.uuid, ctx), relatedRecords;
      if (args.kind === 'similar') relatedRecords = app.compare({ record: relatedRecord, to: relatedRecord.database() });
      else if (args.kind === 'classify') relatedRecords = app.classify({ record: relatedRecord, in: relatedRecord.database() });
      else if (args.kind === 'duplicates') relatedRecords = relatedRecord.duplicates();
      else if (args.kind === 'incoming') relatedRecords = relatedRecord.incomingReferences();
      else relatedRecords = relatedRecord.outgoingReferences();
      var relatedResult = page(relatedRecords, args.kind, null, ctx, args.offset, args.limit);
      relatedResult.kind = args.kind;
      relatedResult.advisory = args.kind === 'similar' || args.kind === 'classify';
      return { result: relatedResult };
    }

    if (['create_record', 'update_record', 'move_record', 'replicate_record', 'import_file'].indexOf(request.op) === -1) fail('UNKNOWN_OPERATION', 'Unknown operation.');
    if (!config.writes) fail('READ_ONLY', 'Writes are disabled.');
    if (args.tags && args.tags.some(function (tag) { return ctx.deniedTags.indexOf(tag.toLowerCase()) !== -1; })) fail('PRIVATE_TAG', 'Manage excluded tags in the DEVONthink UI.');
    var record = args.uuid ? resolve(args.uuid, ctx) : null;
    var destination = args.destination_uuid ? group(args.destination_uuid, true, ctx) : null;
    if (record) {
      checkWrite(record, config);
      if (JSON.stringify(state(record)) !== JSON.stringify(args.expected_state)) fail('CONFLICT', 'Record changed after validation. Read it again.');
      if (record.uuid() === record.database.root.uuid()) fail('ROOT_WRITE_DENIED', 'Database roots cannot be modified with this tool.');
    }
    if (destination) checkWrite(destination, config);
    if (record && destination && record.database.uuid() !== destination.database.uuid()) fail('CROSS_DATABASE_DENIED', 'Move and replicate within one database to preserve item identifiers.');
    var source;
    if (request.op === 'move_record') {
      source = group(args.from_uuid, true, ctx); checkWrite(source, config);
      if (!record.parents().some(function (parent) { return parent.uuid() === source.uuid(); })) fail('NOT_A_PARENT', 'from_uuid must be an existing direct parent.');
    }
    if ((request.op === 'move_record' || request.op === 'replicate_record') && record.type() === 'group') fail('GROUP_RELOCATION_DENIED', 'Move or replicate groups in DEVONthink; this tool operates on documents.');
    if (args.text !== undefined && record && ['txt', 'markdown'].indexOf(record.type()) === -1) fail('UNSUPPORTED_EDIT', 'Text replacement is limited to plain text and Markdown.');
    var before = record ? detail(record) : null;
    if (args.dry_run !== false) return { result: { dry_run: true, operation: request.op, before: before, destination: destination ? brief(destination) : null, changes: args.changes || null, applied: false } };
    mutationStarted = true;
    var written;
    if (request.op === 'create_record') {
      var properties = { name: args.name, type: args.type, tags: args.tags || [] };
      // createRecordWith takes an AppleScript record: use dictionary labels, not JXA property accessors.
      if (args.type !== 'group') properties['plain text'] = args.text || '';
      written = app.createRecordWith(properties, { in: destination });
    } else if (request.op === 'import_file') written = app.import(args.path, { to: destination });
    else if (request.op === 'move_record') written = app.move({ record: record, from: source, to: destination });
    else if (request.op === 'replicate_record') written = app.replicate({ record: record, to: destination });
    else {
      if (args.name !== undefined) record.name = args.name;
      if (args.tags !== undefined) record.tags = args.tags;
      if (args.comment !== undefined) record.comment = args.comment;
      if (args.rating !== undefined) record.rating = args.rating;
      if (args.unread !== undefined) record.unread = args.unread;
      if (args.flagged !== undefined) record.state = args.flagged;
      if (args.text !== undefined) record.plainText = args.text;
      written = record;
    }
    if (!written) fail('WRITE_UNCONFIRMED', 'DEVONthink did not confirm a result. Inspect the destination before retrying.');
    ctx.decisions = {};
    if (!allowed(written, ctx)) fail('WRITE_UNCONFIRMED', 'The resulting record is no longer accessible. Inspect it in DEVONthink before retrying.');
    return { result: { dry_run: false, operation: request.op, before: before, record: detail(written), applied: true } };
  } catch (error) {
    if (!error.bridgeCode) {
      // The app may have quit or restarted. Drop stale proxies so the next
      // request reconnects instead of failing until the MCP server restarts.
      appCache = null;
      databasesCache = null;
      trashCache = {};
    }
    return { error: errorFor(error, mutationStarted) };
  }
}

function send(handle, value) {
  var text = JSON.stringify(value) + '\n';
  handle.writeData($.NSString.alloc.initWithUTF8String(text).dataUsingEncoding($.NSUTF8StringEncoding));
}

function workerLoop() {
  var stdin = $.NSFileHandle.fileHandleWithStandardInput;
  var stdout = $.NSFileHandle.fileHandleWithStandardOutput;
  var buffer = '';
  send(stdout, { ready: true });
  while (true) {
    var data = stdin.availableData;
    if (!data || data.length.js === 0) break;
    buffer += ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
    var newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      var line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      var request = null, out;
      try { request = JSON.parse(line); } catch (_) { send(stdout, { error: { code: 'INVALID_REQUEST', message: 'Invalid JSON request.' } }); continue; }
      out = dispatch(request);
      out.id = request.id;
      send(stdout, out);
    }
  }
}

function run(argv) {
  if (argv && argv.length > 0 && argv[0] === '--worker') return workerLoop();
  var input = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  var request = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(input, $.NSUTF8StringEncoding)));
  var out = dispatch(request);
  return JSON.stringify(out.result !== undefined ? out.result : { error: out.error });
}
