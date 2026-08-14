# Contributing

Thank you for improving `@lordmerc/n8n-nodes-convex`. By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Local workflow

Use Node.js 20.19 or later, then install and verify the project:

```bash
npm ci
npm run verify
npm run dev
```

`npm run verify` runs linting, tests, and a package dry run; `npm test` builds first via `pretest`, so tests always run against fresh `dist` output. Use `npm run dev` for the watching build that also copies icons and static files — there is no separate `build:watch`, because a bare `tsc --watch` produces iconless nodes.

## Changes

Keep changes focused, preserve the separation between application and Team API credentials, and add a focused test when behavior changes. Do not add credentials, tokens, or sensitive request data to source, tests, issues, or logs.

When a GitHub origin is configured, submit a pull request that explains the user-visible change and includes the relevant verification output.
