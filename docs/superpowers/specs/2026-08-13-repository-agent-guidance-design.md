# Repository Agent Guidance Design

## Goal

Add a concise root `AGENTS.md` that helps coding agents understand this n8n community-node package, preserve its architectural boundaries, and run proportionate validation without duplicating the README or full implementation design.

## Audience and Scope

The guidance applies to the entire repository. It is written for automated coding agents making focused source, test, documentation, or release-automation changes. Human-facing installation and usage documentation remains in `README.md` and `CONTRIBUTING.md`.

## Proposed Structure

The file will contain:

1. A short summary of the package and its supported Convex and Convex Platform operations.
2. An architecture map covering credential classes, node entry points, resource descriptions, transport modules, shared safety helpers, tests, and package registration.
3. Non-negotiable security invariants for credential isolation, redirect blocking, HTTP Action origin confinement, header validation, error sanitization, and pagination state.
4. Focused change rules that preserve n8n metadata contracts and keep UI descriptions separate from request/response behavior.
5. A minimal validation matrix mapping common change types to the relevant build and test commands.
6. Release constraints for the scoped npm package, GitHub provenance, protected OIDC publishing, and the absence of persistent npm credentials.

## Style

The resulting `AGENTS.md` should be approximately 100–130 lines, use direct mandatory language for invariants, and prefer paths and commands over long explanations. It will not restate API examples, contributor etiquette, or the historical implementation plan.

## Acceptance Criteria

- `AGENTS.md` exists at the repository root and applies repository-wide.
- Its architecture map matches the implemented file layout.
- It explicitly preserves both credential trust boundaries and all current request-safety controls.
- It identifies the smallest relevant tests and the full `npm run verify` command.
- It prohibits committing, pushing, tagging, publishing, or changing external services without explicit user authorization.
- It contains no placeholders, secrets, inaccurate repository URL, or instructions that conflict with the current package metadata and workflows.
