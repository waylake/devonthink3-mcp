# Security boundaries

This is a local stdio bridge running with the launching user's macOS privileges. It is not a sandbox for a malicious local process or a substitute for the AI host's tool authorization.

## Enforced by the server

- Default selected mode with an empty UUID list denies record access. Local setup may explicitly enable open mode, which grants access to all currently open databases, including databases opened later. Explicit database exclusions override both modes. The scope is checked on every native call.
- `mcp-private` and configured exclusion tags are checked case-insensitively on the record and every ancestor. Any private replicant parent denies access. Trash is excluded. Unreadable ancestry fails closed.
- The same native scope checks apply to search, listing, direct UUID lookup, text resources, mutation inputs and receipt replay.
- The server evaluates a fixed script. User content travels as JSON on stdin, never as shell code, interpolated JXA source or subprocess arguments.
- Write tools are absent by default. Enabled tools validate explicit destinations, revisions, lock state, original-file indexing and database boundaries. Previews are the default.
- Import roots use real paths. Symlink escapes, directories and files over 100 MiB are rejected. No server operation fetches arbitrary URLs.
- Bounded outputs, a subprocess timeout, cancellation propagation, a 16-call queue and a 256-receipt ceiling constrain work. Batch reads accept at most 100 records and a 200,000-character text budget. No unbounded batch mutation tool is exposed.
- The persistent worker is a child of the MCP server with the same user privileges. It reads newline-delimited JSON from stdin and writes only MCP responses to stdout. It is recycled after 2,000 requests or five idle minutes, and killed on timeout or cancellation. A killed worker cannot roll back an Apple Event that was already delivered.
- Raw native errors, record paths and document contents are not written to server logs. The local `--doctor` command and interactive setup intentionally display database names and UUIDs for setup. Settings and backups remain local with owner-only file permissions.

## Limits to understand

The connected AI host receives returned text and metadata and may send it to a remote model provider. This server does not perform sensitive-text redaction. Exclusion tags and database scope are local policy, not DEVONthink 4's native “Exclude from Chat & MCP” setting.

Documents, titles, tags, metadata, links and tool results are untrusted source data. Server instructions and prompts label that boundary, but they cannot guarantee that a model will ignore prompt injection. The host must decide whether a proposed write is authorized by the user.

Native Apple Events are not transactional. Property updates may partially complete; a cancellation or timeout cannot undo a delivered event. Write receipts are memory-only and stop duplicate execution only within the same process. They are not durable recovery records. Inspect affected records after uncertainty or restart, and keep normal DEVONthink backups.

The server's queue does not coordinate with other processes, the DEVONthink UI, attached scripts or smart rules configured by the user. Native app rules may react to imported or edited records. The server does not alter or disable them. The original file may also change between import validation and native import; use a dedicated staging directory that other processes are not modifying.

Tag and metadata sizes are bounded in responses; text extraction uses native APIs that can materialize a whole document before returning a slice. `dt3_read_texts` bounds the returned characters, not the native materialization cost of each document. This is not a streaming parser or an exhaustive archive auditor.

## Reporting

Use GitHub's private vulnerability reporting for this repository if available. For ordinary bugs, open an issue with a minimal synthetic reproduction. Do not attach a database, document contents, local UUIDs, account information or raw automation logs.
