# Validation

## Local release verification — 2026-09-08

Tested against the installed **DEVONthink 3.9.18** on macOS 26.4.1, Apple Silicon. Other DEVONthink 3 versions and editions have not been individually certified. DEVONthink 4 is outside this server's target.

`npm run check` runs eight portable test cases. `DT3_LIVE_TEST=1 npm run test:live` runs one opt-in integration scenario containing assertions across the operations below. Both passed during release preparation. The final live scenario took approximately 27 seconds on the test machine; this is a smoke-test duration, not a large-archive benchmark.

| Area | Evidence |
| --- | --- |
| MCP compatibility | Modern discovery/stateless requests and legacy initialization; real stdio process plus portable protocol tests |
| Tool contract | Eight tools by default, thirteen with writes enabled; input rejection, output schemas, two prompts, guide resource and document template |
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

The live test creates a uniquely named, hidden temporary directory in the user's home folder. DEVONthink imports files from OS temporary folders even when asked to index them, so a home-directory fixture is needed to verify an actual indexed record. The test closes its own database before deleting its directory. It does not mutate preexisting records. If database closing fails, its directory remains for inspection.

## What these tests do not establish

- Complete OCR, transcription, spreadsheet or archive extraction. Only the synthetic text PDF and text/Markdown fixtures were used for content assertions.
- Ranking quality of DEVONthink's classification or similarity engine on a real collection. Those native calls are exercised but their recommendations remain advisory.
- Non-empty custom metadata types across every DEVONthink edition or plugin.
- Recovery of an Apple Event after the app has already accepted a cancelled or timed-out write. There is no transaction rollback.
- Cross-process exactly-once behavior, durable receipts, or an immutable inventory during concurrent imports.
- Every AI host's UI, permission dialog or model behavior. SDK protocol compatibility is separate from a host's product-level integration.
- Performance over a large production archive. Native result/text materialization and the documented per-call limits still apply.

## Reproduce

```sh
npm ci --ignore-scripts
npm run check
DT3_LIVE_TEST=1 npm run test:live
npm audit --omit=dev
npm pack --dry-run
```

CI runs the portable checks on Linux and macOS with Node 22 and 24. The GUI application test remains opt-in because hosted CI does not include a licensed DEVONthink installation. The server intentionally does not launch an app or open a user's database to satisfy a test.

The PDF fixture contains only synthetic English text. It was generated for this repository, rendered for visual inspection, and independently text-checked with Poppler. No user archive data, real database UUIDs or local configuration is committed.
