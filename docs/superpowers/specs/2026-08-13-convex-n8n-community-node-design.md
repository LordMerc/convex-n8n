# Convex n8n Community Node Design

**Date:** 2026-08-13
**Package:** `@lordmerc/n8n-nodes-convex`
**Initial version:** `0.1.0`
**License:** MIT
**Author:** Mike Boyd

## Summary

Create a publishable n8n community-node package for Convex using the current
`@n8n/node-cli` toolchain. The package will contain two nodes with separate
credentials and trust boundaries:

- **Convex** calls application functions and custom HTTP Actions.
- **Convex Platform** performs a small, read-only set of team and deployment
  discovery operations.

The first release is a working MVP rather than an empty scaffold. It will use
n8n's built-in HTTP request facilities and have no runtime dependencies.

## Goals

- Call Convex queries, mutations, and actions from n8n workflows.
- Call JSON-based custom Convex HTTP Actions.
- Inspect a Team Access Token, list projects, and list or get deployments.
- Keep application credentials and administrative Team Access Tokens isolated.
- Produce an npm-ready package that follows current n8n verification and
  provenance-publishing conventions.
- Include focused automated tests and CI for the supported behavior.

## Non-goals

Version 0.1.0 will not:

- Create, update, pause, resume, or delete Convex projects or deployments.
- Read or modify deployment environment variables, logs, data, functions,
  domains, tokens, or other administrative state.
- Implement Convex OAuth.
- Use a Team Access Token to authenticate application function calls.
- Provide realtime query subscriptions or an n8n trigger node.
- Accept arbitrary external URLs in node parameters.
- Support binary or non-JSON custom HTTP Action bodies or responses.
- Add the Convex SDK or `@convex-dev/platform` as a runtime dependency.

## Repository and Tooling

The repository will follow the current n8n starter and `@n8n/node-cli`
conventions rather than copying the older hand-built TypeScript, Gulp, and
legacy ESLint stack from `roblox-cloud-n8n`.

The package will use:

- Node.js `>=22.22.0`.
- TypeScript in strict mode.
- `@n8n/node-cli` for development, build, lint, and release workflows.
- The current flat ESLint configuration supplied by the n8n starter.
- Prettier and EditorConfig.
- npm with a committed lockfile.
- `n8n-workflow` as a peer dependency.
- `n8nNodesApiVersion: 1` and the `n8n-community-node-package` keyword.
- A local, original SVG icon and a README disclaimer that the package is a
  community integration and is not endorsed by Convex.

The npm package will contain only the built distribution and package metadata.
Repository and homepage fields will be omitted until a GitHub origin exists.

## Package Architecture

The package contains two nodes and two credential types.

### Convex node

This is the application data-plane node. It supports two resources:

1. **Function**
   - Run Query
   - Run Mutation
   - Run Action
2. **HTTP Action**
   - Request

### Convex Platform node

This is the administrative control-plane node. It is deliberately read-only
in version 0.1.0. It supports three resources:

1. **Token**
   - Get Details
2. **Project**
   - Get Many
3. **Deployment**
   - Get Many
   - Get

### Implementation style

Static API operations use n8n's declarative request routing. Small local
pre-send and post-receive helpers handle JSON validation, URL construction,
Convex error envelopes, pagination termination, and output normalization.
These helpers remain isolated and directly testable. No external HTTP or
Convex client library is added.

## Credentials

### Convex API

Fields:

- **Deployment URL**: required HTTP(S) URL used for `/api/query`,
  `/api/mutation`, and `/api/action`.
- **HTTP Actions URL**: optional HTTP(S) URL used only by the HTTP Action
  resource. The selected operation requires it to be configured.
- **Bearer Token**: optional password field containing an end-user JWT from the
  deployment's configured authentication provider.

Both URLs must:

- use HTTP or HTTPS;
- contain no username or password;
- contain no query string or fragment;
- be normalized without a trailing slash; and
- be supplied only through encrypted n8n credentials, never as per-item node
  parameters.

HTTP is accepted to support local and self-hosted Convex deployments. The
credential does not have a remote test because Convex exposes no universal,
side-effect-free application function that every deployment must implement.
URL validation still runs before any request.

The optional bearer token is added as `Authorization: Bearer <token>` only to
requests made by the Convex node.

### Convex Team API

Fields:

- **Team ID**: required string.
- **Team Access Token**: required password field.

The Platform API base URL is hardcoded to `https://api.convex.dev/v1`. The
credential authenticates with `Authorization: Bearer <token>`.

The credential test calls `GET /token_details`. It must fail when the token is
invalid or when the returned team ID does not exactly match the configured
Team ID after string normalization.

The README will state prominently that read-only node operations do not make a
Team Access Token read-only. The token inherits the permissions of its owner.
Users should create it through a dedicated service account and apply the
least-privileged role available for the required view operations. The Convex
Management API is Beta, so its operations may need compatibility updates.

## Convex Function Contract

All function operations expose:

- **Function Path**: required Convex identifier such as `messages:list`.
- **Arguments**: required JSON object, defaulting to `{}`.

The node rejects malformed JSON, arrays, scalars, and `null` before making a
request. It sends:

```json
{
  "path": "messages:list",
  "args": {},
  "format": "json"
}
```

to the endpoint selected by the operation:

- Run Query: `POST <deploymentUrl>/api/query`
- Run Mutation: `POST <deploymentUrl>/api/mutation`
- Run Action: `POST <deploymentUrl>/api/action`

Each n8n input item is processed independently so expressions can supply the
function path and arguments. Successful output preserves the complete Convex
envelope:

```json
{
  "status": "success",
  "value": {},
  "logLines": []
}
```

This retains function logs and avoids ambiguous wrapping when a function
returns a scalar, array, object, or `null`.

## Custom HTTP Action Contract

The HTTP Action resource is intentionally JSON-only in version 0.1.0.

Fields:

- **Method**: `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`.
- **Path**: required path beginning with `/`.
- **Query Parameters**: JSON object, default `{}`.
- **Headers**: JSON object, default `{}`.
- **Body**: JSON object, default `{}`, shown only for `POST`, `PUT`, and
  `PATCH`.

The query, header, and body fields reject malformed JSON, arrays, scalars, and
`null`. Header names are compared case-insensitively. User-supplied
`Authorization`, `Host`, `Content-Length`, `Transfer-Encoding`, and
`Content-Type` headers are rejected. The node supplies `Accept:
application/json` and `Content-Type: application/json`; it attaches the
credential's optional bearer token itself.

Path handling follows these rules:

- Absolute URLs and scheme-relative values such as `//example.com` are
  rejected.
- Backslashes, userinfo, malformed percent encodings, and encoded or literal
  dot-segment traversal are rejected.
- The path is resolved with the platform URL parser against the credential's
  HTTP Actions URL.
- The resolved origin must exactly match the configured origin.
- Redirect following is disabled, preventing credentials from being forwarded
  to another origin.

The node sends the query and optional JSON body to the resolved URL. A 2xx
response must have a JSON-compatible content type and a valid JSON body. A
top-level JSON object becomes the item output directly. Arrays, scalars, and
`null` are returned as `{ "data": <value> }` so every n8n item remains an
object without unexpectedly splitting one HTTP response into multiple items.
Redirects, non-2xx responses, non-JSON responses, and malformed JSON responses
are execution errors.

## Convex Platform Contract

All Platform requests use the Convex Team API credential and the hardcoded
`https://api.convex.dev/v1` origin. Redirect following is disabled. Team Access
Tokens are never used by the Convex application node.

### Token: Get Details

Calls `GET /token_details` and returns the parsed JSON response.

### Project: Get Many

Calls `GET /teams/:teamId/projects` using the credential's Team ID.

The operation follows n8n's conventional controls:

- **Return All**: boolean, default `false`.
- **Limit**: positive integer shown when Return All is false.

The node follows `nextCursor` until the API is exhausted or the requested
limit is reached. It truncates the final result to the requested limit and
emits one n8n item per project. It stops on an empty page or missing cursor.
A repeated cursor or a cursor that makes no progress raises an error instead
of looping.

### Deployment: Get Many

Requires **Project ID** and calls
`GET /projects/:projectId/list_deployments`. The documented endpoint returns
the project's deployment collection without cursor pagination. Version 0.1.0
emits one n8n item per deployment.

### Deployment: Get

Requires **Project ID** and one lookup mode:

- **Reference**: sends the entered deployment reference.
- **Default Production**: sends `defaultProd=true`.
- **Default Development**: sends `defaultDev=true`.

It calls `GET /projects/:projectId/deployment` and returns the selected
deployment.

## Error Handling

- Standard HTTP failures become n8n API errors through n8n's request layer.
- A function response with `{ "status": "error" }` becomes an n8n execution
  error even if Convex returned HTTP 200.
- Function errors preserve `errorMessage`, `errorData`, and `logLines` as safe
  error context.
- Error messages never include authorization headers, credential fields, raw
  request configuration, or complete sensitive response/request payloads.
- Each input item is handled independently and follows n8n's Continue On Fail
  behavior.
- The package does not automatically retry queries, mutations, actions,
  custom HTTP Actions, or Platform calls. This avoids duplicating side effects
  and keeps retry policy visible in the workflow.

## Security Boundaries

The following invariants must hold:

1. The Convex API bearer token may reach only the configured Deployment URL or
   HTTP Actions URL for the selected application operation.
2. The Team Access Token may reach only `https://api.convex.dev/v1`.
3. An application bearer token is never attached to Platform requests.
4. A Team Access Token is never attached to function or HTTP Action requests.
5. User-entered node parameters cannot select a request origin.
6. Redirects cannot move an authenticated request to a different origin.
7. Secrets and raw authenticated request configuration never appear in logs or
   surfaced errors.

## Testing Strategy

Focused automated tests will cover the behavior introduced by this package,
without live Convex credentials:

- package metadata registers both nodes and both credentials;
- credentials mark token fields as passwords;
- function operations route to the correct endpoint and body;
- function arguments accept objects and reject malformed/non-object values;
- Convex success envelopes are preserved;
- Convex error envelopes become redacted n8n errors;
- HTTP Action URL handling rejects absolute URLs, `//host`, backslashes,
  traversal, malformed encodings, origin changes, and redirects;
- reserved headers cannot be overridden;
- application tokens and Team tokens never cross their trust boundaries;
- Team ID mismatch fails credential validation;
- project pagination handles Return All, limits, empty pages, final-page
  truncation, and repeated/no-progress cursors;
- no operation configures automatic retries; and
- Platform operations use the exact documented read-only endpoints.

Tests will use Node's built-in test runner against compiled code and mocked
HTTP behavior, avoiding an additional test runtime unless the generated n8n
starter requires one.

## Documentation

The README will include:

- npm and n8n Community Nodes installation instructions;
- compatibility requirements;
- credential setup for both nodes;
- examples for functions and HTTP Actions;
- the supported Platform operations;
- the Team Access Token least-privilege warning;
- the Convex Management API Beta notice;
- error and retry behavior;
- local development commands;
- links to the relevant Convex and n8n documentation; and
- the community-maintained/non-endorsement disclaimer.

The repository will also contain an MIT license, changelog, contribution
guidance, code of conduct, and editor configuration.

## CI and npm Publishing

CI will run on pushes and pull requests with Node 22 and will execute the
narrow checks that prove the package:

1. `npm ci`
2. n8n lint
3. production build
4. focused tests against compiled output
5. package metadata and packed-content verification

Before a release, the package will be checked with `npm pack --dry-run` and
`npm publish --dry-run`. The scoped `@lordmerc/n8n-nodes-convex` name must also be
verified directly with npm before the first publish.

Publishing will use the current n8n starter's protected tag workflow and npm
trusted publishing through GitHub OIDC. The workflow publishes with provenance
and does not store a long-lived npm token. Once the repository has a GitHub
origin and the npm package exists, the maintainer must configure npm Trusted
Publishers for that repository and workflow.

No commit, push, tag, npm publication, or GitHub repository mutation is part
of implementation unless separately authorized.

## Operational Containment

If a credential leak is discovered after publication:

1. Revoke or rotate every affected Team Access Token and end-user bearer token
   immediately.
2. Deprecate the affected npm version.
3. Publish a corrected version only after the leak path is tested and closed.

A patched package alone is not sufficient containment for an exposed token.

## Acceptance Criteria

The version 0.1.0 setup is complete when:

- the repository uses the current n8n community-node toolchain;
- both nodes and both credentials are registered and build successfully;
- all specified operations behave according to this document;
- platform operations are read-only;
- the credential and origin-isolation invariants are covered by tests;
- focused tests, n8n lint, and production build pass;
- the packed npm artifact contains only intended publishable files;
- documentation describes setup, supported operations, limitations, security,
  and release preparation; and
- no secrets, generated local state, or unrelated files are included.

## References

- [n8n node starter](https://github.com/n8n-io/n8n-nodes-starter)
- [n8n node development environment](https://docs.n8n.io/integrations/creating-nodes/build/node-development-environment/)
- [Convex HTTP API](https://docs.convex.dev/http-api/)
- [Convex HTTP Actions](https://docs.convex.dev/functions/http-actions)
- [Convex Management API](https://docs.convex.dev/management-api/overview)
- [Convex Platform APIs](https://docs.convex.dev/platform-apis/overview)
- [Convex token details](https://docs.convex.dev/management-api/get-token-details)
- [Convex list projects](https://docs.convex.dev/management-api/list-projects)
- [Convex list deployments](https://docs.convex.dev/management-api/list-deployments)
- [Convex get deployment](https://docs.convex.dev/management-api/get-deployment-in-project-by-project-id)
