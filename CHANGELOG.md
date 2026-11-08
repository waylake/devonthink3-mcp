# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
semantic versioning.

## [0.3.0] - 2026-11-08

### Added

- A persistent JXA worker per MCP session. It keeps the DEVONthink application
  connection and database discovery warm, recycles after 2,000 requests or five
  idle minutes, and restarts automatically after a timeout or cancellation.
  `DT3_ONESHOT=1` keeps the previous one-process-per-call behavior.
- `dt3_get_records`: metadata and edit revisions for up to 100 records in one
  call, with per-record errors instead of a failed batch.
- `dt3_read_texts`: bounded text for up to 100 records under a total character
  budget, with a `next` cursor that resumes exactly.
- `npm run bench`: a synthetic benchmark that creates one temporary database,
  measures the worker and one-shot transports over the same records, and
  removes the fixture.
- A preview-state cache. An authorized apply reuses the state validated by its
  preview and skips a second metadata read; a changed record still returns
  `CONFLICT`.

### Changed

- List pages accept up to 200 records. Text chunks accept up to 64,000 UTF-16
  code units.
- Item URLs are constructed from the record UUID instead of a separate native
  call. Visibility reads reuse the UUID and tags already fetched for a listing.
- Database discovery is cached between calls and refreshed on `status`,
  `databases`, and a lookup miss.
- The MCP SDK is 2.4.0 and zod is 4.6.7.

### Fixed

- Cleared the high-severity npm advisories in the MCP server SDK and zod.
- Reset the worker request counter when a new worker starts, so recycling does
  not turn into one request per process.
- Canonicalized write fingerprints so a preview and its apply match even when
  the client serializes argument keys in a different order.

### Security

- Batch reads are read-only and bounded by 100 records and a 200,000-character
  text budget. No unbounded batch mutation or export tool is exposed.
- A killed worker cannot roll back an Apple Event that was already delivered;
  writes keep the existing `outcome_unknown` behavior.
- Temporary publish tokens should be scoped to this package, short-lived, and
  deleted after publishing. See [RELEASING.md](RELEASING.md).

## [0.2.0] - 2026-09-08

### Added

- `setup --client codex|pi|both` with numbered database selection, explicit open
  mode, exclusions, and optional writes.
- Dynamic database scope: databases opened or closed after startup are detected
  on the next call.
- `--doctor` local diagnostics and a pinned Pi package manifest.
- Strict saved configuration, owner-only settings files, and an exact backup of
  the previous settings file.

### Changed

- Search, listing, direct reads, resources, writes, and receipt replay share the
  same native scope checks.
- Indexed originals remain read-only; writes default to a dry-run preview.

## [0.1.0] - 2026-09-08

### Added

- Initial scoped DEVONthink 3 MCP server: status, databases, selection, search,
  group listing, record metadata, bounded text, and related records.
- Optional create, update, move, replicate, and single-file import tools.
- A fixed JXA dispatcher, official MCP TypeScript SDK, portable contract tests,
  an opt-in live test, and a synthetic PDF fixture.
