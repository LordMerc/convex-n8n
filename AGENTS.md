# Repository Agent Guidance

## Project Summary

`@lordmerc/n8n-nodes-convex` is a community-maintained n8n package for Convex. It is not affiliated with or endorsed by Convex.

The package exposes two version-1 nodes:

- **Convex** runs deployed queries, mutations, and actions, and calls JSON HTTP Actions.
- **Convex Platform** performs read-only discovery of projects, deployments, and Team Access Token details through the Beta Platform API.

Target Node.js 22.22.0 or later. The package uses the n8n community-node API with strict mode enabled and compiles TypeScript into ignored `dist/` output.

## Architecture Map

- `package.json` owns npm metadata, scripts, and the exact compiled credential/node registrations under `n8n`.
- `credentials/ConvexApi.credentials.ts` defines the application credential: deployment URL, optional HTTP Actions URL, and optional end-user bearer JWT.
- `credentials/ConvexTeamApi.credentials.ts` defines the Platform credential: Team ID and Team Access Token against fixed base URL `https://api.convex.dev/v1`.
- `nodes/Convex/Convex.node.ts` assembles the application node and binds only `convexApi`.
- `nodes/Convex/resources/` contains declarative UI descriptions for Function and HTTP Action operations.
- `nodes/Convex/transport.ts` validates and prepares application requests and normalizes their responses.
- `nodes/ConvexPlatform/ConvexPlatform.node.ts` assembles the discovery node and binds only `convexTeamApi`.
- `nodes/ConvexPlatform/resources/` contains declarative UI descriptions for Deployment, Project, and Token operations.
- `nodes/ConvexPlatform/transport.ts` handles Platform request preparation, team checks, response extraction, limits, and pagination.
- `nodes/shared/convexUtils.ts` is the shared trust-boundary layer for JSON parsing, URL normalization, HTTP Action confinement, header restrictions, output normalization, team matching, and error sanitization.
- `nodes/shared/types.ts` contains shared internal types only.
- `*.node.json` and `icons/` contain n8n catalog metadata and light/dark icons.
- `tests/` uses Node's test runner against compiled modules in `dist/`; build before behavior tests.
- `.github/workflows/ci.yml` verifies pull requests and pushes. `.github/workflows/publish.yml` is the protected, tag-triggered npm publishing path.

Keep declarative fields and display conditions in `resources/`. Keep request/response behavior in the matching `transport.ts`. Put validation in `nodes/shared/` only when both nodes genuinely share it.

## Non-Negotiable Security Invariants

- Never use a Team Access Token in `convexApi`, and never expose application JWT fields through `convexTeamApi`.
- The Convex node may request only `convexApi`; the Platform node may request only `convexTeamApi`.
- Keep Team Platform traffic on the fixed Convex Platform API base URL.
- Set `disableFollowRedirect = true` on every credential-bearing request, including credential tests.
- Validate deployment and HTTP Actions base URLs with `normalizeBaseUrl`. Accept only HTTP(S) URLs without embedded credentials, query strings, or fragments.
- HTTP Action paths must begin with one `/`, remain on the configured origin, and reject scheme-relative paths, backslashes, encoded traversal, and double-encoded traversal.
- HTTP Actions remain JSON-only. Preserve the supported method allowlist and reject non-success, redirected, non-JSON, or invalid-JSON responses.
- Custom headers must be valid HTTP field-name tokens with single-line string values. Do not allow overrides of Authorization, Host, Content-Length, Transfer-Encoding, Content-Type, or Accept.
- Never include tokens, authorization data, cookies, request bodies, credential objects, or raw upstream responses in errors or logs. Route Convex error context through the existing recursive sanitizer.
- Platform token details must match the configured Team ID before returning data.
- Project pagination state is per execution. Detect any repeated cursor, stop on empty/non-advancing pages, and restore mutated query and post-receive state in `finally`.
- Keep Platform operations read-only unless the user explicitly approves a separately designed mutation feature.
- Never place real credentials, tokens, deployment URLs, or private payloads in source, tests, fixtures, documentation, screenshots, or commits.

Treat any change to authentication, URL handling, headers, redirects, error formatting, pagination, publishing, or GitHub permissions as security-sensitive.

## Change Rules

- Make the smallest coherent change and preserve unrelated staged or unstaged work.
- Do not edit generated `dist/` or installed `node_modules/`; edit TypeScript sources and rebuild.
- Preserve node names, credential names, version numbers, `testedBy` associations, catalog JSON, icons, and `package.json` registrations unless the change explicitly requires coordinated updates.
- When adding an operation, update its resource description, transport hook, catalog/user documentation when relevant, and one focused regression test.
- Use n8n `NodeOperationError` or `NodeApiError` for execution-facing failures where a node context exists. Keep messages useful but secret-safe.
- Do not broaden accepted URLs, methods, headers, response types, retries, or Platform permissions speculatively.
- Avoid new dependencies and abstractions unless the current change cannot be expressed clearly with existing code.
- Keep README statements accurate for user-visible operations, credentials, limitations, and release setup.

## Validation

Tests import compiled CommonJS from `dist/`, so run the build before affected behavior tests:

- Shared validation or errors: `npm run build && node --test tests/shared-utils.test.js`
- Credentials: `npm run build && node --test tests/credentials.test.js`
- Convex node/resources/transport: `npm run build && node --test tests/convex-node.test.js`
- Platform node/resources/transport: `npm run build && node --test tests/convex-platform-node.test.js`
- Metadata, docs, or workflow presence: `node --test tests/package-metadata.test.js`
- Full pre-handoff verification: `npm run verify`

`npm run verify` runs lint, build, all tests, and an npm pack dry run. Inspect the tarball file list when package registrations, files, icons, or metadata change. A local tooling warning is not a passing check; report exact exit status and any remaining warning.

## Git and Release Safety

- Inspect `git status` before editing. This repository may have user-owned staged changes and may not yet have an initial commit.
- Do not commit, push, create or push tags, publish to npm, create releases, alter GitHub settings, or configure npm trust without explicit user authorization.
- The package name is `@lordmerc/n8n-nodes-convex`. Do not substitute the occupied unscoped name `n8n-nodes-convex`.
- Keep the steady-state publish workflow on GitHub-hosted runners with `contents: read`, `id-token: write`, protected `v*.*.*` tags, and the `npm-publish` environment.
- npm Trusted Publishing requires the package to exist first. Follow the README's one-time bootstrap procedure, then remove the temporary npm credential and its workflow wiring.
- Subsequent releases must use GitHub OIDC provenance without a persistent `NPM_TOKEN`.
- Add exact `repository` and `homepage` metadata only after the real public GitHub origin exists.
