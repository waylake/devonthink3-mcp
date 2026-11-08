# Releasing

This repository publishes `@waylake/devonthink3-mcp` to the public npm registry
and attaches a GitHub release to each version tag. The package contains code
only; the benchmark and tests stay in the repository.

## Before you start

- macOS with a running, scriptable DEVONthink 3 for the live test and benchmark.
- Node.js 22 or newer.
- Permission to publish the `@waylake` scope on npm.
- A clean `main` checkout. Do not rewrite published tags or history.

## 1. Verify the current tree

```sh
npm ci --ignore-scripts
npm run check
DT3_LIVE_TEST=1 npm run test:live
DT3_BENCH_RECORDS=100 npm run bench
npm audit --omit=dev --audit-level=high
npm pack --dry-run
```

The live test creates and removes its own synthetic database. It does not read
or mutate user databases. The benchmark does the same.

## 2. Bump the version in both places

The npm package version and the Pi manifest pin must match. The contract test
checks this.

```sh
# Edit package.json: "version": "X.Y.Z"
# Edit mcp.json: "args": ["-y", "@waylake/devonthink3-mcp@X.Y.Z"]
npm install --package-lock-only --ignore-scripts
npm run check
```

Update `CHANGELOG.md` with the release date and user-visible changes. Keep the
release notes factual: describe behavior, limits, and migration steps, not
internal work logs.

## 3. Commit and tag

```sh
git add package.json package-lock.json mcp.json CHANGELOG.md
git commit -m "chore(release): X.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z: <short summary>"
git push origin main
git push origin vX.Y.Z
```

Wait for the `Check` workflow on the tag to pass before publishing.

## 4. Publish

Prefer npm **Trusted Publishing** with GitHub Actions OIDC. It avoids a
long-lived token and records provenance. If the package is not yet configured
for trusted publishing, configure it on npm under the package's publishing
access settings before adding an automated workflow.

For a manual publish, use a granular access token that is:

- scoped to `@waylake/devonthink3-mcp` only,
- short-lived (the npm UI defaults to 7 days for write tokens),
- never committed to the repository or pasted into logs.

```sh
npm publish --access public
npm view @waylake/devonthink3-mcp version dist-tags
```

The registry may take a minute or two to show the new `latest` version. Verify
the published tarball, not only the local checkout:

```sh
tmp=$(mktemp -d)
cd "$tmp"
npm pack @waylake/devonthink3-mcp@X.Y.Z
tar -xzf waylake-devonthink3-mcp-X.Y.Z.tgz
grep -c "class WorkerTransport" package/src/bridge.js
grep -c "dt3_get_records" package/src/server.js
node -e 'console.log(require("./package/package.json").version)'
```

Delete any temporary publish token immediately after the publish. If the
publish fails after the token was used, reconcile the registry state before
creating another token.

## 5. Create the GitHub release

```sh
gh release create vX.Y.Z \
  --title "vX.Y.Z — <short summary>" \
  --notes "<user-visible highlights and the install command>"
```

Include the install command in the notes:

```sh
npx -y @waylake/devonthink3-mcp@X.Y.Z setup --client pi
# or
pi mcp add devonthink3 -- npx -y @waylake/devonthink3-mcp@X.Y.Z
```

## 6. Verify the installed package

Run the published version outside the repository so the local checkout cannot
mask a packaging mistake:

```sh
cd /tmp
npx -y @waylake/devonthink3-mcp@X.Y.Z --doctor
pi mcp list
```

`pi mcp list` should report the published version and, with writes enabled,
fifteen tools. Reconnect or `/reload` a running Pi session after changing the
server version.

## Rollback

npm versions cannot be overwritten. If a release is broken:

1. Publish a fixed patch version.
2. Move the `latest` dist-tag to the fixed version.
3. Mark the broken GitHub release as a pre-release or edit its notes with the
   fixed version.
4. Do not delete the tag or rewrite `main`.
