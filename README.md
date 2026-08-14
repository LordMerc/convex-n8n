# @lordmerc/n8n-nodes-convex

## About

`@lordmerc/n8n-nodes-convex` is an n8n community node package for running Convex functions, calling Convex HTTP Actions, and discovering selected Convex Platform resources.

## Community/Non-endorsement Notice

This package is community maintained. It is not affiliated with, sponsored by, or endorsed by Convex.

## Installation

Install `@lordmerc/n8n-nodes-convex` from n8n's Community Nodes settings, then restart n8n if prompted. Self-hosted n8n instances can also install the package with npm according to their normal community-node deployment process.

## Compatibility

The package targets Node.js 20.19 or later, matching n8n's own supported runtimes, and uses the n8n community-node API. Use a current, compatible n8n release when installing it.

## Convex API Credential

The **Convex API** credential is used only by the **Convex** node:

- **Deployment URL** is required and identifies the Convex deployment for function calls.
- **HTTP Actions URL** is optional until an HTTP Action is used and identifies its configured HTTP Actions origin.
- **Bearer Token** is optional. It is an end-user JWT for the application API, not a Team Access Token.

Keep application credentials separate from team credentials.

## Convex Team API Credential

The **Convex Team API** credential is used only by the **Convex Platform** node. Enter the **Team ID** and a **Team Access Token**. The token is checked against the configured team before token details are returned.

The Convex Platform/Management API is Beta. Team Access Tokens inherit their owner's permissions; they are not inherently read-only. Use a dedicated service account with a least-privileged custom role, and use this node only with credentials that are appropriate for the data it can discover.

## Supported Operations

| Node | Resource | Operations |
| --- | --- | --- |
| Convex | Function | Run Query, Run Mutation, Run Action |
| Convex | HTTP Action | Request with GET, POST, PUT, PATCH, or DELETE |
| Convex Platform | Project | Get Many |
| Convex Platform | Deployment | Get, Get Many |
| Convex Platform | Token | Get Details |

The Platform node is intentionally limited to discovery operations; it does not create, update, or delete Platform resources.

## Function Example

To run a Convex query, add a **Convex** node and choose **Function** → **Run Query**. Set **Function Path** to the deployed query name and provide **Arguments** as a JSON object, for example:

```json
{
  "status": "open"
}
```

Configure the credential's **Deployment URL**. Add an end-user JWT to **Bearer Token** only when that function requires application authentication.

## HTTP Action Example

To call an HTTP Action, configure **HTTP Actions URL**, choose **HTTP Action** → **Request**, and provide an absolute **Path** such as `/hooks/example`. **Query Parameters**, **Headers**, and (for POST, PUT, or PATCH) **Body** must each be JSON objects.

HTTP Actions are JSON-only: requests send JSON and successful responses must declare and contain JSON. Requests cannot redirect or leave the configured origin. Custom headers cannot override `Accept`, `Authorization`, `Host`, `Content-Length`, `Transfer-Encoding`, or `Content-Type`.

## Security and Least Privilege

Use two isolated credentials: **Convex API** for application functions and HTTP Actions, and **Convex Team API** for Platform discovery. Never put a Team Access Token in the application credential; its optional **Bearer Token** is for an end-user JWT. Store both credentials in n8n's credential store.

Team tokens inherit the permissions of their owner and are not automatically read-only. Prefer a dedicated service account and a least-privileged custom role. Limit HTTP Actions to an explicitly configured origin, review each JSON header/body, and do not use sensitive values in URLs.

## Error/Retry Behavior

None of the node operations automatically retry. A non-success HTTP Action response, redirect, non-JSON response, invalid JSON, or invalid request field fails the execution. Configure any retry policy deliberately in the surrounding n8n workflow after considering whether the operation is safe to repeat.

## Local Development

```bash
npm ci
npm run verify
npm run dev
```

`npm run dev` starts the local n8n development environment with the node package loaded.

## Publishing Setup

Publishing is intentionally inactive until a public GitHub origin exists. After creating the GitHub repository and adding it as this repository's `origin`:

1. Add the exact GitHub repository URL to this package's `repository` and `homepage` metadata, then commit and push the initial repository.
2. Protect the GitHub environment named `npm-publish` with required reviewers and restrict releases to protected `v*.*.*` version tags.
3. Bootstrap `@lordmerc/n8n-nodes-convex@0.1.0` once from a GitHub-hosted Actions run using a short-expiry, granular npm access token with bypass 2FA enabled. Temporarily supply it to the release step as `NODE_AUTH_TOKEN`, keep provenance enabled, then delete both the secret and its workflow wiring immediately after the package exists. npm does not allow Trusted Publishing to be configured for a package that has not been published yet.
4. In the new npm package's settings, add a GitHub Actions Trusted Publisher using the repository's actual owner and name, the workflow filename `publish.yml`, the environment `npm-publish`, and the `npm publish` permission.
5. For every later release, keep `NPM_TOKEN` and other long-lived npm credentials absent. The publish job exchanges its GitHub OIDC token with npm.
6. Run `npm run release` from a clean, up-to-date `main` branch. Its version tag must be a full `v*.*.*` version tag (for example, `v0.1.1`) for the publish workflow to run.

The committed workflow is the steady-state, tokenless workflow. It uses the starter-supported release command, which lints, builds, and publishes the scoped package publicly with an npm provenance attestation in GitHub Actions. The one-time bootstrap credential is deliberately not wired into this repository while no GitHub origin exists.

## Limitations

- The Convex Platform/Management API is Beta and this package exposes only the listed discovery operations.
- HTTP Action paths must remain on the configured origin; redirects are disabled.
- HTTP Action request and response payloads are JSON-only.
- No node operation automatically retries.

## Resources

- [Convex HTTP API documentation](https://docs.convex.dev/http-api/)
- [Convex Platform API overview](https://docs.convex.dev/platform-apis/overview/)
- [n8n community-node documentation](https://docs.n8n.io/integrations/creating-nodes/)

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

This project is licensed under the [MIT License](LICENSE.md).
