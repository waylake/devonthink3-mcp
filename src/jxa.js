/* Runs in Apple's JavaScript for Automation, not Node. No caller-supplied code. */
ObjC.import('Foundation');

function run() {
  var mutationStarted = false;
  function fail(code, message) { throw { bridgeCode: code, message: message }; }
  try {
    var input = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
    var request = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(input, $.NSUTF8StringEncoding)));
    var args = request.args, config = request.config;
    var app = Application('com.devon-technologies.think3');
    if (!app.running()) fail('NOT_RUNNING', 'Open DEVONthink 3 and the intended databases first.');
    var version = app.version();
    if (!/^3\./.test(version)) fail('UNSUPPORTED_VERSION', 'This server targets DEVONthink 3. Use the native MCP server for DEVONthink 4.');
    var databases = app.databases();
    var deniedTags = config.excludedTags.map(function (tag) { return tag.toLowerCase(); });
    var decisions = {}, trash = {};

    function dbAllowed(db) {
      var id = db.uuid().toUpperCase();
      return (config.excludedDatabaseUUIDs || []).indexOf(id) === -1 &&
        (config.databaseMode === 'open' || config.databaseUUIDs.indexOf(id) !== -1);
    }
    function database(id) {
      for (var i = 0; i < databases.length; i++) {
        if (databases[i].uuid().toUpperCase() === id && dbAllowed(databases[i])) return databases[i];
      }
      fail('ACCESS_DENIED', 'Database is not open or is outside the configured scope.');
    }
    function visible(record, active, depth) {
      var id = record.uuid();
      if (decisions[id] !== undefined) return decisions[id];
      if (depth > 64 || active[id]) return false;
      var db = record.database();
      if (!dbAllowed(db)) return false;
      var dbid = db.uuid();
      if (!trash[dbid]) trash[dbid] = db.trashGroup.uuid();
      if (id === trash[dbid]) return false;
      var tags = record.tags();
      if (tags.some(function (tag) { return deniedTags.indexOf(String(tag).toLowerCase()) !== -1; })) return false;
      active[id] = true;
      var parents = record.parents();
      for (var i = 0; i < parents.length; i++) {
        if (!visible(parents[i], active, depth + 1)) { delete active[id]; return false; }
      }
      delete active[id];
      decisions[id] = true;
      return true;
    }
    function allowed(record) {
      try { return visible(record, {}, 0); } catch (_) { return false; }
    }
    function resolve(id) {
      for (var i = 0; i < databases.length; i++) {
        if (!dbAllowed(databases[i])) continue;
        var record = app.getRecordWithUuid(id, { in: databases[i] });
        if (record && allowed(record)) return record;
      }
      fail('NOT_FOUND_OR_DENIED', 'Record is unavailable or outside the permitted scope.');
    }
    function group(id, writable) {
      var record = resolve(id);
      var type = record.type();
      if (type !== 'group' && (!(!writable && type === 'smart group'))) fail('NOT_A_GROUP', 'Choose a regular group for writes, or a group/smart group for browsing.');
      return record;
    }
    function bounded(value, limit) { return String(value == null ? '' : value).slice(0, limit); }
    function date(value) { return value instanceof Date ? value.toISOString() : null; }
    function state(record) {
      return {
        uuid: record.uuid(), name: record.name(), tags: record.tags(), comment: record.comment(),
        modified: date(record.modificationDate()), contentHash: record.contentHash(),
        rating: record.rating(), unread: record.unread(), flagged: record.state(),
        parents: record.parents().map(function (parent) { return parent.uuid(); }).sort(),
        locked: record.locking(), indexed: record.indexed()
      };
    }
    function brief(record) {
      return {
        uuid: record.uuid(), database_uuid: record.database.uuid(), name: bounded(record.name(), 1024),
        type: record.type(), item_url: record.referenceURL(),
        resource_uri: 'devonthink3://record/' + record.uuid(),
        tags: record.tags().slice(0, 64).map(function (tag) { return bounded(tag, 256); }),
        modified: date(record.modificationDate())
      };
    }
    function detail(record) {
      var result = brief(record);
      result.location = bounded(record.location(), 4096);
      result.comment = bounded(record.comment(), 8000);
      result.size_bytes = record.size();
      result.page_count = record.pageCount();
      result.pending = record.pending();
      result.indexed = record.indexed();
      result.locked = record.locking();
      result._state = state(record);
      if (JSON.stringify(result._state).length > 64000) fail('METADATA_LIMIT', 'Record metadata exceeds the edit limit; use the DEVONthink UI.');
      return result;
    }
    function page(records, relation) {
      var offset = args.offset || 0, limit = args.limit || 25, result = [], examined = 0;
      for (; offset < records.length && result.length < limit && examined < 5000; offset++, examined++) {
        var record = records[offset];
        if (allowed(record)) {
          var item = brief(record);
          if (relation === 'similar' || relation === 'classify') {
            var score = record.score();
            item.score = typeof score === 'number' && isFinite(score) ? score : null;
          }
          result.push(item);
        }
      }
      return { records: result, next_offset: offset < records.length ? offset : null, snapshot: false };
    }
    function checkWrite(record) {
      if (!config.writes) fail('READ_ONLY', 'Writes are disabled.');
      if (record.database.readOnly() || record.locking()) fail('LOCKED', 'Database or record is read-only or locked.');
      if (record.indexed()) fail('INDEXED_WRITE_DENIED', 'Indexed originals must be edited through their source application.');
    }

    if (request.op === 'status') return JSON.stringify({ running: true, version: version, writes_enabled: config.writes, database_mode: config.databaseMode || 'selected', configured_databases: config.databaseUUIDs.length, permitted_open_databases: databases.filter(dbAllowed).length, text_source: 'DEVONthink plain text index' });
    if (request.op === 'databases') return JSON.stringify({ databases: databases.filter(dbAllowed).map(function (db) { return { uuid: db.uuid(), name: bounded(db.name(), 1024), root_uuid: db.root.uuid(), read_only: db.readOnly() }; }) });
    // Local CLI only. Never registered as an MCP tool or resource.
    if (request.op === 'discover') return JSON.stringify({ version: version, databases: databases.map(function (db) { return { uuid: db.uuid(), name: bounded(db.name(), 1024) }; }) });
    if (request.op === 'selection') return JSON.stringify(page(app.selectedRecords()));
    if (request.op === 'search') {
      var db = database(args.database_uuid);
      var root = args.group_uuid ? group(args.group_uuid, false) : db.root();
      if (root.database.uuid() !== db.uuid() || !allowed(root)) fail('ACCESS_DENIED', 'Search group must be inside the selected permitted database.');
      return JSON.stringify(page(app.search(args.query, { in: root, excludeSubgroups: !args.recursive })));
    }
    if (request.op === 'list_group') return JSON.stringify(page(group(args.uuid, false).children()));
    if (request.op === 'get_record') {
      var record = resolve(args.uuid), result = detail(record);
      if (args.include_custom_metadata) {
        var metadata = record.customMetaData() || {};
        if (JSON.stringify(metadata).length > 16000) fail('METADATA_LIMIT', 'Custom metadata exceeds 16,000 characters; inspect it in DEVONthink.');
        result.custom_metadata = metadata;
      }
      return JSON.stringify({ record: result });
    }
    if (request.op === 'read_text') {
      var record = resolve(args.uuid);
      if (record.type() === 'group' || record.type() === 'smart group') fail('NOT_A_DOCUMENT', 'Use list_group to browse a group.');
      if (record.pending()) fail('CONTENT_PENDING', 'Download this document in DEVONthink before reading it.');
      if (record.characterCount() > 5000000) fail('TEXT_LIMIT', 'The indexed text exceeds five million characters. Inspect this document in DEVONthink.');
      var text = record.plainText();
      var start = args.offset || 0;
      if (start > text.length) fail('INVALID_OFFSET', 'Offset exceeds the current text length.');
      var end = Math.min(text.length, start + args.limit);
      // Keep UTF-16 offsets without cutting a surrogate pair at a chunk boundary.
      if (end < text.length && /[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end--;
      if (start > 0 && /[\uDC00-\uDFFF]/.test(text.charAt(start))) fail('INVALID_OFFSET', 'Use next_offset returned by the previous chunk.');
      return JSON.stringify({ record: detail(record), text: text.slice(start, end), offset: start, next_offset: end < text.length ? end : null, total_characters: text.length, text_status: text.length ? 'available' : 'no_text', source: 'devonthink_plain_text', untrusted: true });
    }
    if (request.op === 'related') {
      var record = resolve(args.uuid), records;
      if (args.kind === 'similar') records = app.compare({ record: record, to: record.database() });
      else if (args.kind === 'classify') records = app.classify({ record: record, in: record.database() });
      else if (args.kind === 'duplicates') records = record.duplicates();
      else if (args.kind === 'incoming') records = record.incomingReferences();
      else records = record.outgoingReferences();
      var result = page(records, args.kind);
      result.kind = args.kind;
      result.advisory = args.kind === 'similar' || args.kind === 'classify';
      return JSON.stringify(result);
    }

    if (['create_record', 'update_record', 'move_record', 'replicate_record', 'import_file'].indexOf(request.op) === -1) fail('UNKNOWN_OPERATION', 'Unknown operation.');
    if (!config.writes) fail('READ_ONLY', 'Writes are disabled.');
    if (args.tags && args.tags.some(function (tag) { return deniedTags.indexOf(tag.toLowerCase()) !== -1; })) fail('PRIVATE_TAG', 'Manage excluded tags in the DEVONthink UI.');
    var record = args.uuid ? resolve(args.uuid) : null;
    var destination = args.destination_uuid ? group(args.destination_uuid, true) : null;
    if (record) {
      checkWrite(record);
      if (JSON.stringify(state(record)) !== JSON.stringify(args.expected_state)) fail('CONFLICT', 'Record changed after validation. Read it again.');
      if (record.uuid() === record.database.root.uuid()) fail('ROOT_WRITE_DENIED', 'Database roots cannot be modified with this tool.');
    }
    if (destination) checkWrite(destination);
    if (record && destination && record.database.uuid() !== destination.database.uuid()) fail('CROSS_DATABASE_DENIED', 'Move and replicate within one database to preserve item identifiers.');
    var source;
    if (request.op === 'move_record') {
      source = group(args.from_uuid, true); checkWrite(source);
      if (!record.parents().some(function (parent) { return parent.uuid() === source.uuid(); })) fail('NOT_A_PARENT', 'from_uuid must be an existing direct parent.');
    }
    if ((request.op === 'move_record' || request.op === 'replicate_record') && record.type() === 'group') fail('GROUP_RELOCATION_DENIED', 'Move or replicate groups in DEVONthink; this tool operates on documents.');
    if (args.text !== undefined && record && ['txt', 'markdown'].indexOf(record.type()) === -1) fail('UNSUPPORTED_EDIT', 'Text replacement is limited to plain text and Markdown.');
    var before = record ? detail(record) : null;
    if (args.dry_run !== false) return JSON.stringify({ dry_run: true, operation: request.op, before: before, destination: destination ? brief(destination) : null, changes: args.changes || null, applied: false });
    mutationStarted = true;
    var result;
    if (request.op === 'create_record') {
      var properties = { name: args.name, type: args.type, tags: args.tags || [] };
      // createRecordWith takes an AppleScript record: use dictionary labels, not JXA property accessors.
      if (args.type !== 'group') properties['plain text'] = args.text || '';
      result = app.createRecordWith(properties, { in: destination });
    } else if (request.op === 'import_file') result = app.import(args.path, { to: destination });
    else if (request.op === 'move_record') result = app.move({ record: record, from: source, to: destination });
    else if (request.op === 'replicate_record') result = app.replicate({ record: record, to: destination });
    else {
      if (args.name !== undefined) record.name = args.name;
      if (args.tags !== undefined) record.tags = args.tags;
      if (args.comment !== undefined) record.comment = args.comment;
      if (args.rating !== undefined) record.rating = args.rating;
      if (args.unread !== undefined) record.unread = args.unread;
      if (args.flagged !== undefined) record.state = args.flagged;
      if (args.text !== undefined) record.plainText = args.text;
      result = record;
    }
    if (!result) fail('WRITE_UNCONFIRMED', 'DEVONthink did not confirm a result. Inspect the destination before retrying.');
    decisions = {};
    if (!allowed(result)) fail('WRITE_UNCONFIRMED', 'The resulting record is no longer accessible. Inspect it in DEVONthink before retrying.');
    return JSON.stringify({ dry_run: false, operation: request.op, before: before, record: detail(result), applied: true });
  } catch (error) {
    return JSON.stringify({ error: { code: error.bridgeCode || (error.errorNumber === -1743 ? 'AUTOMATION_DENIED' : 'AUTOMATION_FAILED'), message: error.bridgeCode ? error.message : 'DEVONthink automation failed. Check permissions, open databases, and pending dialogs.', outcomeUnknown: mutationStarted } });
  }
}
