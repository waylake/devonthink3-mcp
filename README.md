# DEVONthink 3 MCP

Local, scoped MCP access to **DEVONthink 3** on macOS. Search your archive, read cited text, follow references, and preview document organization from an AI assistant.

**Tested on DEVONthink 3.9.18.** Uses the official MCP TypeScript SDK 2.4.0 with the 2026-07-28 protocol and compatibility for 2025 clients. JavaScript source runs directly on Node.js; no build step, web server, API key, or second search index.

[한국어 안내](docs/README.ko.md) · [Design and research](docs/design.md) · [Validation](docs/validation.md) · [Security boundaries](SECURITY.md) · [Changelog](CHANGELOG.md) · [Releasing](RELEASING.md)

> Already using DEVONthink 4? Its [built-in MCP server](https://www.devontechnologies.com/blog/20260526-devonthink-mcp-server) is the simpler starting point. This project is for people staying on version 3. It is independent of DEVONtechnologies.

## Install

Requires macOS, Node.js 22 or later, and a running, scriptable DEVONthink 3 installation. Open the databases you want to use. Allow the launching terminal or AI application to control DEVONthink in **System Settings → Privacy & Security → Automation** when macOS prompts.

Choose and register a client without cloning the repository:

```sh
npx -y @waylake/devonthink3-mcp@0.3.0 setup --client codex
```

For Pi:

```sh
npx -y @waylake/devonthink3-mcp@0.3.0 setup --client pi
```

For both, use `--client both`. Setup lists open databases by name, asks you to select their numbers or explicitly follow all open databases, and asks whether to enable writes. It saves local settings, then calls the client's own installer. Codex CLI or Pi must already be on PATH. `--client pi` installs `pi-mcp-adapter@2.32.1` and this package through `pi install`; no separate MCP JSON editing is required.

Setup stores settings in `~/.config/devonthink3-mcp/config.json` with owner-only permissions and preserves the previous file as `config.json.bak`. Existing unrelated MCP servers and Pi packages are retained. If client registration fails after settings were saved, fix the client installation and rerun setup. Keep setup output and configuration private.

Reconnect Codex or restart Pi after installation. In Pi, `/reload` and `/mcp` refresh and inspect available servers. The adapter discovers the package's `pi.mcp` manifest and connects lazily when needed. The package entry is named `waylake_devonthink3-mcp__devonthink3` in the adapter. [Pi package documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md), [adapter documentation](https://github.com/nicobailon/pi-mcp-adapter).

### Explicit setup without prompts

This grants reads and writes to **every database currently open and every database opened later**:

```sh
npx -y @waylake/devonthink3-mcp@0.3.0 setup --client both --database-mode open --enable-writes
```

Restrict access to selected UUIDs instead:

```sh
npx -y @waylake/devonthink3-mcp@0.3.0 --doctor
npx -y @waylake/devonthink3-mcp@0.3.0 setup --database-uuids FIRST_UUID,SECOND_UUID --read-only
```

Without `--client`, setup saves settings only. Replace example UUIDs with values from the local doctor output. `--exclude-databases UUID,UUID` adds an exclusion list that overrides either scope mode; passing an empty string clears that list. Setup preserves other saved settings, including import roots. Settings changes require a client reconnect. Opening or closing databases does **not** require a reconnect.

### Manual client installation

If you prefer the client's native commands, first run `npx -y @waylake/devonthink3-mcp@0.3.0 setup` to choose scope, then:

```sh
# Codex
codex mcp add devonthink3 -- npx -y @waylake/devonthink3-mcp@0.3.0

# Pi
pi install npm:pi-mcp-adapter@2.32.1
pi install npm:@waylake/devonthink3-mcp@0.3.0
```

The setup helper registers absolute Node and npm CLI paths for Codex so GUI launches do not depend on finding Node through a shell. The manual `npx` form requires Node/npm on the client's PATH. [Official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

For another local stdio MCP client:

```json
{
  "mcpServers": {
    "devonthink3": {
      "command": "npx",
      "args": ["-y", "@waylake/devonthink3-mcp@0.3.0"]
    }
  }
}
```

Version pins keep the chosen server version stable. To upgrade, review the release and rerun setup from the new version. The Pi manifest intentionally executes the matching npm version through `npx`; the first connection may download that version into npm's cache. Subsequent connections reuse it. No repository checkout is required. Web-only remote clients need a separate local bridge; none is included.

## Tools

Ten read tools are available by default. Five write tools appear when writes are enabled in setup or with `DT3_ENABLE_WRITES=1`.

| Tool | Purpose |
| --- | --- |
| `dt3_status` | App readiness, version and configured scope |
| `dt3_databases` | Permitted open databases and their root UUIDs |
| `dt3_selection` | Permitted records in the current selection |
| `dt3_search` | Native full-text/query search in one database or group |
| `dt3_list_group` | Direct children, including records with no indexed text |
| `dt3_get_record` | Metadata, optional custom metadata, and edit revision |
| `dt3_read_text` | Bounded indexed text, extraction status and source link |
| `dt3_related` | Similarity, classification, duplicates, incoming/outgoing item references |
| `dt3_get_records` | Metadata and edit revisions for up to 100 records in one call |
| `dt3_read_texts` | Bounded text for up to 100 records with a total character budget |
| `dt3_create_record` | Preview/create Markdown, plain text or a group |
| `dt3_update_record` | Preview/edit name, tags, comment, rating, flags, or plain/Markdown text |
| `dt3_move_record` | Move one document instance; preserve other replicants |
| `dt3_replicate_record` | Add a shared document instance within the same database |
| `dt3_import_file` | Import one permitted local file; retain its original |

Each successful tool response has an output schema, structured data and a text rendering. Record identifiers accept UUIDs or `x-devonthink-item://` links. Tool results include `item_url` for citations and `resource_uri` for MCP clients. `devonthink3://record/{uuid}` reads the first text chunk; `devonthink3://guide` describes the workflow. The `research` and `organize` prompts provide starting workflows.

## Performance and bulk work

The server keeps one `osascript` process alive per MCP session and caches database discovery between calls. The first call starts the worker; subsequent calls skip process startup and the initial `app.databases()` round trip. Set `DT3_ONESHOT=1` to force one process per call for debugging or compatibility.

Synthetic benchmark on DEVONthink 3.9.18 (100 Markdown records, best of three interleaved runs, milliseconds per call for `status`/`get_record`, per record for the rest; run `npm run bench` on your own archive):

| Operation | Worker | One-shot | Speedup |
| --- | ---: | ---: | ---: |
| `dt3_status` (10 calls) | 10.0 | 189.9 | 19.1x |
| `dt3_get_record` (10 calls) | 24.8 | 212.0 | 8.6x |
| `dt3_list_group` (100 records) | 3.0 | 4.5 | 1.5x |
| `dt3_get_records` (100 records) | 13.8 | 16.7 | 1.2x |
| `dt3_read_texts` (100 records) | 12.5 | 9.6 | ~1.0x |
| `dt3_search` (100 results) | 3.8 | 5.6 | 1.5x |

The worker removes fixed per-call overhead. Batch tools remove MCP round trips and keep output bounded; per-record Apple Event cost inside DEVONthink is unchanged, so their per-record speedup is roughly neutral. Run the benchmark on your own archive before planning a large export. Use `dt3_list_group`/`dt3_search` with `limit: 200`, then `dt3_get_records` or `dt3_read_texts` for the page. `dt3_read_text` now accepts up to 64,000 UTF-16 units, which reduces repeated full-text materialization for long documents.

## Read and cite

1. Call `dt3_databases`; choose relevant databases. Search each explicitly and combine evidence with database UUIDs and item links.
2. Call `dt3_search` with native syntax such as `name:report` or `tag:review`.
3. Inspect metadata; call `dt3_read_text` only for relevant records.
4. Continue with `next_offset` until `null`, comparing revisions if the source changes.
5. Cite the returned item link in the synthesis. Keep originals in DEVONthink and small, source-linked knowledge pages in Git.

List pages default to 25 records, capped at 200. Text chunks default to 8,000 UTF-16 code units, capped at 64,000; surrogate pairs are preserved. `dt3_read_texts` returns up to 100 documents per call under a 60,000-character default budget (200,000 maximum) and returns a `next` cursor for exact resumption. Search/browse order is native and **not a snapshot**. Concurrent imports or edits may change page membership; deduplicate by UUID when gathering an inventory.

## Preview and edit

Enable writes through setup or an environment override and reconnect. The server still defaults every mutation to a preview:

```json
{
  "uuid": "RECORD_UUID",
  "expected_revision": "REVISION_FROM_GET_RECORD",
  "request_id": "rename-project-note-001",
  "name": "Project note",
  "dry_run": true
}
```

Review `before`, `destination` and `changes`. For an authorized change, call the same tool with `dry_run: false`. A text preview shows its first 1,000 code units and total length. Tags replace the complete tag list. Moving requires both `from_uuid` and `destination_uuid` and operates on one document instance, within one database.

To preserve existing tags, read them first and include them in the replacement array.

A changed revision rejects the edit. The app is not transactional: multiple property updates can partially complete if an Apple Event fails. Inspect current state after any uncertain result. A timeout or cancellation stops the subprocess but cannot roll back an Apple Event already delivered.

Mutation receipts prevent exact retries from repeating a write **within one server process**. Reuse the same `request_id` only with identical arguments. Receipts are held for up to 256 writes without eviction; subsequent new writes return `RECEIPT_LIMIT`. Reconcile results before restarting. Receipts do not survive a restart and are not an audit log. Replays recheck access permissions.

## Configuration

Without settings or environment overrides, access is denied and writes are off. Settings are read once at startup. Environment values override saved settings. An explicit `DT3_DATABASE_UUIDS`, including an empty value, also selects `selected` mode unless `DT3_DATABASE_MODE` is explicitly provided. The Pi package uses the default settings file and does not inherit custom DT3 environment overrides; use setup or a custom MCP entry for a separate Pi profile.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DT3_CONFIG` | `~/.config/devonthink3-mcp/config.json` | Absolute settings-file path; an explicitly named missing file is an error |
| `DT3_DATABASE_MODE` | `selected` | `selected` allows UUIDs; explicit `open` follows all open databases |
| `DT3_DATABASE_UUIDS` | empty | Comma-separated permitted database UUIDs in selected mode; no wildcard |
| `DT3_EXCLUDE_DATABASE_UUIDS` | empty | Comma-separated denied database UUIDs, in both modes |
| `DT3_ENABLE_WRITES` | `0` | `1` exposes write tools; all other non-`0` values are rejected |
| `DT3_EXCLUDE_TAGS` | empty | Extra excluded tags, comma-separated; `mcp-private` is always excluded |
| `DT3_IMPORT_ROOTS` | `[]` | JSON array of absolute directories permitted for single-file imports |
| `DT3_TIMEOUT_MS` | `30000` | Per JXA subprocess timeout, 1,000–120,000 ms |

Example import root: `DT3_IMPORT_ROOTS='["/Users/you/Documents/MCP Import"]'`. Imports follow real paths, reject symlink escapes, directories, and files over 100 MiB. Use DEVONthink itself for large folder imports.

Tag a document or group `mcp-private` to exclude it. The server checks **every parent**: a replicant in a private group is denied even if another instance is in a public group. Trash is excluded. Metadata, search results, direct reads, resources and writes share the same scope check.

## Limits and troubleshooting

- The server has no network listener or telemetry. The connected AI host may send returned content to its model provider. There is no automatic sensitive-text redaction; this is separate from DEVONthink 4's built-in privacy controls.
- `no_text` means DEVONthink returned no plain text. It does not prove the source is empty. OCR, media transcription, archive expansion, spreadsheet formula evaluation and password recovery are outside this server.
- Metadata-only search is separate from text reading. PDF text comes from DEVONthink's index; page count is provided, but returned chunks do not claim page-level alignment.
- Text reads reject indexed text over five million characters. Native APIs may materialize full text or search results internally before pagination. A call scans at most 5,000 result candidates; follow `next_offset`, including on an empty filtered page.
- Writes to locked or indexed records, group relocation, cross-database moves, trash operations and permanent deletion are excluded. Edit original indexed files through their source application.
- `NOT_RUNNING`: open DEVONthink 3. `ACCESS_DENIED`: check UUID configuration and open databases. `NOT_FOUND_OR_DENIED`: check tags and ancestors. `AUTOMATION_DENIED`/`AUTOMATION_FAILED`: inspect macOS Automation permissions and app dialogs. `CONFLICT`: re-read and preview again.
- Configured databases must remain open in the app; the server does not mount closed database packages. A permission granted to Terminal does not automatically grant it to a GUI AI host. Open that host interactively and check its own Automation entry.
- Apple Events are serialized within one process; at most 16 calls queue. Use one server process for a given workflow. Multiple clients/processes and manual app edits are not protected by a distributed lock.

## Development

```sh
npm ci --ignore-scripts
npm run check
DT3_LIVE_TEST=1 npm run test:live
```

Portable tests cover policy, schemas, replay, imports, queueing and both protocol eras. The opt-in live test creates a temporary synthetic database, exercises actual app operations, closes it, and removes its temporary files. It requires DEVONthink 3 and Automation permission; do not run it while relying on the current selection for another workflow.

For a durable archive structure and agent review workflow, read [the knowledge organization guide](docs/knowledge-workflow.ko.md).

MIT license. See [design and research](docs/design.md) for upstream references and reuse decisions.
