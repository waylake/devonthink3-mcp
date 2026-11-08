# Development contract

- Keep the bridge specific to DEVONthink 3 (`com.devon-technologies.think3`). Verify dictionary behavior on a real installation before claiming support.
- Use the official MCP SDK; no custom protocol or HTTP service without a concrete need.
- Treat documents as untrusted data. Enforce scope before reads, writes, resource access and receipt replay.
- Keep the persistent worker protocol internal: one JSON object per line on stdio, one request in flight, and no document data in arguments or logs. The one-shot path must keep working for `--doctor` and `DT3_ONESHOT=1`.
- Bulk tools are read-only. Enforce the same scope on every record, keep per-record errors, and return a resumable cursor. Do not add an unbounded batch mutation or export tool.
- `npm test` is portable. `DT3_LIVE_TEST=1 npm run test:live` creates a synthetic temporary database on macOS; never use a person's existing records as test fixtures.
- Keep stdout exclusively for MCP in server mode. Do not log source contents, paths, UUIDs, or raw AppleScript errors.
- Preserve originals and other replicants. Never add arbitrary script execution or permanent deletion tools.
- Public examples must use synthetic data. Use conventional commits without generated-by or co-author attribution.
