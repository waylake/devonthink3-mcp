# Validation

## Local release verification — 2026-11-08

Tested against the installed **DEVONthink 3.9.18** on macOS 26.4.1, Apple Silicon. Other DEVONthink 3 versions and editions have not been individually certified. DEVONthink 4 is outside this server's target.

`npm run check` runs ten portable test cases. `DT3_LIVE_TEST=1 npm run test:live` runs one opt-in integration scenario containing assertions across the operations below. Both passed during release preparation. The final live scenario took approximately 29 seconds on the test machine; this is a smoke-test duration, not a large-archive benchmark. `npm run bench` creates a separate synthetic database and measures both transports; it is not part of CI.

| Area | Evidence |
| --- | --- |
| MCP compatibility | Modern discovery/stateless requests and legacy initialization; real stdio process plus portable protocol tests |
| Tool contract | Ten tools by default, fifteen with writes enabled; input rejection, output schemas, two prompts, guide resource and document template |
| Worker transport | One persistent osascript process per session; first-call startup, warm calls, one-shot fallback, timeout/cancellation kill and automatic restart verified by the live suite and smoke runs |
| Bulk reads | `dt3_get_records` returned metadata with per-record errors; `dt3_read_texts` enforced the character budget, reported `no_text`, and resumed exactly from `next`. The synthetic benchmark exercised 100 records per batch |
| Setup | Strict saved configuration, environment narrowing, numbered selection validation, exact backup bytes, owner-only permissions and matching Pi package/version manifest |
| Dynamic databases | Same live MCP connection detected a second synthetic DB opening, created/read its note, detected its closure and denied direct access and receipt replay afterward; preexisting DBs explicitly excluded from this fixture |
| App connection | Fixed version 3 bundle ID; actual app version and permitted database discovery |
| Research | Name query, paginated group browsing, long Korean/emoji text roundtrip, item-link input and text resource |
| PDF | Imported the committed synthetic one-page PDF, read its expected text and verified page count |
| Metadata | Name/type/location/flags/revision reads; optional empty custom-metadata dictionary; tags and comment edits |
| Native relationships | Similarity, classification, duplicates, incoming and outgoing calls exercised; an explicit Markdown outgoing link resolved to its target |
| Preview | Default dry-run did not create or edit a record; returned proposed changes |
| Edits | Plain text/Markdown content update, rating and flags; stale revision rejected |
| Replicants | Moved one instance, added a replicant, moved the first instance again, and verified the other remained |
| Write replay | Exact retry returned the receipt without another write; changed arguments with the same ID rejected in portable tests |
| Privacy | Excluded parent and private replicant blocked direct read, search, resource access, writes and old receipt replay; unconfigured database access denied |
| Original protection | Locked records and actually indexed external files rejected for writes; PDF text replacement rejected |
| Imports | Synthetic regular file imported with original retained; symlink escape and empty import roots rejected in portable tests |
| Work control | Real progress notifications; portable serial queue, queue capacity and queued cancellation checks; timeout errors retain an uncertain-write receipt in a simulated execution test |
| Preview reuse | A preview stores the validated native state; the authorized apply reuses it without a second `get_record`, while a changed record still returns `CONFLICT` |

The live test creates a uniquely named, hidden temporary directory in the user's home folder. DEVONthink imports files from OS temporary folders even when asked to index them, so a home-directory fixture is needed to verify an actual indexed record. The test closes its own database before deleting its directory. It does not mutate preexisting records. If database closing fails, its directory remains for inspection.

## Synthetic performance check

Run on DEVONthink 3.9.18, Apple Silicon, Node.js 24. The fixture is one temporary database with 100 Markdown records, each about 2.4 KB of synthetic text. Both transports ran interleaved over the same records; the table reports the best of three runs in milliseconds per call for `status`/`get_record` and per record for the rest.

| Operation | Worker | One-shot | Speedup |
| --- | ---: | ---: | ---: |
| `dt3_status` (10 calls) | 10.0 | 189.9 | 19.1x |
| `dt3_get_record` (10 calls) | 24.8 | 212.0 | 8.6x |
| `dt3_list_group` (100 records) | 3.0 | 4.5 | 1.5x |
| `dt3_get_records` (100 records) | 13.8 | 16.7 | 1.2x |
| `dt3_read_texts` (100 records) | 12.5 | 9.6 | ~1.0x |
| `dt3_search` (100 results) | 3.8 | 5.6 | 1.5x |

The persistent worker removes the fixed process and database-discovery cost from every call. The batch tools remove MCP round trips and bound the response; they do not reduce DEVONthink's own per-record Apple Event cost, so their per-record time is roughly neutral. Repeated runs vary with DEVONthink's background indexing. These numbers are not a large-archive capacity claim.

## What these tests do not establish

- Complete OCR, transcription, spreadsheet or archive extraction. Only the synthetic text PDF and text/Markdown fixtures were used for content assertions.
- Ranking quality of DEVONthink's classification or similarity engine on a real collection. Those native calls are exercised but their recommendations remain advisory.
- Non-empty custom metadata types across every DEVONthink edition or plugin.
- Recovery of an Apple Event after the app has already accepted a cancelled or timed-out write. There is no transaction rollback.
- Cross-process exactly-once behavior, durable receipts, or an immutable inventory during concurrent imports.
- Every AI host's UI, permission dialog or model behavior. SDK protocol compatibility is separate from a host's product-level integration.
- Performance over a large production archive or a specific DEVONthink edition. The synthetic 100-record fixture is a regression check, not a capacity plan. Native result/text materialization and the documented per-call limits still apply.

## Reproduce

```sh
npm ci --ignore-scripts
npm run check
DT3_LIVE_TEST=1 npm run test:live
DT3_BENCH_RECORDS=100 npm run bench
npm audit --omit=dev
npm pack --dry-run
```

CI runs the portable checks on Linux and macOS with Node 22 and 24. The GUI application test remains opt-in because hosted CI does not include a licensed DEVONthink installation. The server intentionally does not launch an app or open a user's database to satisfy a test.

The PDF fixture contains only synthetic English text. It was generated for this repository, rendered for visual inspection, and independently text-checked with Poppler. No user archive data, real database UUIDs or local configuration is committed.
