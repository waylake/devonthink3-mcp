# DEVONthink 3 MCP

Local, scoped MCP access to **DEVONthink 3** on macOS. Search your archive, read cited text, follow references, and preview document organization from an AI assistant.

**Tested on DEVONthink 3.9.18.** Uses the official MCP TypeScript SDK 2.0.0 with the 2026-07-28 protocol and compatibility for 2025 clients. JavaScript source runs directly on Node.js; no build step, web server, API key, or second search index.

[한국어 안내](docs/README.ko.md) · [Design and research](docs/design.md) · [Validation](docs/validation.md) · [Security boundaries](SECURITY.md)

> Already using DEVONthink 4? Its [built-in MCP server](https://www.devontechnologies.com/blog/20260526-devonthink-mcp-server) is the simpler starting point. This project is for people staying on version 3. It is independent of DEVONtechnologies.

## Install

Requires macOS, Node.js 22 or later, and a running, scriptable DEVONthink 3 installation. Open the databases you want to use. Allow the launching terminal or AI application to control DEVONthink in **System Settings → Privacy & Security → Automation** when macOS prompts.

```sh
git clone https://github.com/waylake/devonthink3-mcp.git
cd devonthink3-mcp
npm ci --ignore-scripts
npm test
npm run doctor
```

`doctor` prints open database names and UUIDs **locally**. Copy the UUID of the database you intend to expose. Keep this setup output private. No database is accessible through MCP until configured.

The GitHub source is the distribution for this release. The package name in `package.json` identifies the project; it does not imply publication to the npm registry.

## Connect Codex

Run this from the cloned directory, replacing `YOUR_DATABASE_UUID` with a value from `doctor`:

```sh
codex mcp add devonthink3 \
  --env "DT3_DATABASE_UUIDS=YOUR_DATABASE_UUID" \
  -- "$(command -v node)" "$PWD/src/index.js"
```

Restart or reconnect the client after changing MCP configuration. Ask: **“Check DEVONthink, list permitted databases, and find notes about my project. Cite the original item links.”**

Codex also accepts this in `~/.codex/config.toml`. Use absolute paths, especially when launching from a desktop application:

```toml
[mcp_servers.devonthink3]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/devonthink3-mcp/src/index.js"]
startup_timeout_sec = 15
tool_timeout_sec = 90

[mcp_servers.devonthink3.env]
DT3_DATABASE_UUIDS = "YOUR_DATABASE_UUID"
DT3_ENABLE_WRITES = "0"
```

Configuration format: [official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
Run `command -v node` to find the absolute Node path. GUI clients may not inherit your terminal's PATH. Multiple databases use `DT3_DATABASE_UUIDS="FIRST_UUID,SECOND_UUID"`.

## Other local MCP clients

For clients accepting an `mcpServers` JSON configuration:

```json
{
  "mcpServers": {
    "devonthink3": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/devonthink3-mcp/src/index.js"],
      "env": { "DT3_DATABASE_UUIDS": "YOUR_DATABASE_UUID" }
    }
  }
}
```

The server speaks **stdio**. Remote web-only clients need a separate local-to-remote bridge; none is included here.

## Tools

Eight read tools are available by default. Five write tools appear only with `DT3_ENABLE_WRITES=1`.

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
| `dt3_create_record` | Preview/create Markdown, plain text or a group |
| `dt3_update_record` | Preview/edit name, tags, comment, rating, flags, or plain/Markdown text |
| `dt3_move_record` | Move one document instance; preserve other replicants |
| `dt3_replicate_record` | Add a shared document instance within the same database |
| `dt3_import_file` | Import one permitted local file; retain its original |

Each successful tool response has an output schema, structured data and a text rendering. Record identifiers accept UUIDs or `x-devonthink-item://` links. Tool results include `item_url` for citations and `resource_uri` for MCP clients. `devonthink3://record/{uuid}` reads the first text chunk; `devonthink3://guide` describes the workflow. The `research` and `organize` prompts provide starting workflows.

## Read and cite

1. Call `dt3_databases`; choose an explicit database.
2. Call `dt3_search` with native syntax such as `name:report` or `tag:review`.
3. Inspect metadata; call `dt3_read_text` only for relevant records.
4. Continue with `next_offset` until `null`, comparing revisions if the source changes.
5. Cite the returned item link in the synthesis. Keep originals in DEVONthink and small, source-linked knowledge pages in Git.

List pages default to 25 records, capped at 100. Text chunks default to 8,000 UTF-16 code units, capped at 16,000; surrogate pairs are preserved. Search/browse order is native and **not a snapshot**. Concurrent imports or edits may change page membership; deduplicate by UUID when gathering an inventory.

## Preview and edit

Enable writes in the local client configuration and reconnect. The server still defaults every mutation to a preview:

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

| Variable | Default | Meaning |
| --- | --- | --- |
| `DT3_DATABASE_UUIDS` | empty | Comma-separated permitted database UUIDs; no wildcard |
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

MIT license. See [design and research](docs/design.md) for upstream references and reuse decisions.
