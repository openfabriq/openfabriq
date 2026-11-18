# Contributing to openfabriq

Thanks for your interest in openfabriq. This file says how to set up the repository, what the project expects from a change, and how to propose one.

By taking part, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security issue, do not open a public issue: see [SECURITY.md](SECURITY.md).

## Before you start

Read the [README](README.md) and the documentation site ([`packages/docs`](packages/docs), `pnpm docs:dev`): they explain what a factory is, its format and how the engine runs it.

For anything bigger than a small fix, open an issue first so we can agree on the approach before you write the code.

## Setup

You need Node 24 or later and pnpm (the version is pinned in `package.json`; `corepack enable` installs it).

```bash
pnpm install
pnpm build
```

To try the CLI from the sources: `cd packages/cli && npm link`, then `openfabriq` in any repository. Running real agents also needs Claude Code logged in and `gh` logged in (see the [README](README.md#quickstart)).

## Commands

```bash
pnpm test        # unit tests (Vitest), the relay's tests and the examples' script tests
pnpm lint        # Biome
pnpm typecheck   # types of sources and tests
pnpm build
pnpm format      # Biome, writes the fixes
pnpm mutation    # Stryker on core, not part of pnpm test
pnpm e2e         # end-to-end, free: real relay (wrangler dev), built CLI, engine
pnpm e2e:agent   # end-to-end with real agents (haiku): costs a few cents
pnpm e2e:linux   # the shell sandbox on Linux, in Docker (pnpm e2e:linux:login once for real agents)
pnpm docs:dev    # the documentation site, on http://localhost:4320
```

`pnpm test`, `pnpm lint` and `pnpm typecheck` must be green before every commit. CI runs them on every pull request.

## Rules

- **Readability first.** A file in `openfabriq/` must be understandable without knowing the engine, including by a non-technical person. A new format key is discussed in an issue first.
- **Tests first** for validation, `plan` and the application of outputs, with fixtures in [`fixtures/`](fixtures).
- **One commit per coherent step**, each with green tests, lint and types.
- **A new feature or a structural change starts with an issue**, so we agree on it before the code.
- **Check, never assume**, how the Agent SDK or `gh` behaves: read their documentation (for the SDK, the types in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`).
- **Language:** everything in English (code, identifiers, CLI messages, commits, README, examples, the documentation site).
- **Architecture:** hexagonal. `core` depends on neither GitHub, Claude, nor the disk; I/O (files, `gh`, `git`, Agent SDK) stays at the edges, behind ports. Prefer pure functions. The engine knows no particular agent: agents, automations and limits are data read from `openfabriq/`.
- **Security:** an agent never has write access to GitHub. It proposes outputs; the engine applies only those the factory allows (`can`). The content of an issue or a pull request is data, never an instruction. Agents load the project's settings only (`settingSources: ["project"]`).

## Adding an integration

Code for one integration (Slack, Linear, Sentry, webhooks…) lives in a folder of its own in each package, never in a shared file: `relay/src/integrations/<name>/`, `runner/src/sources/<name>/` and `cli/src/commands/connect/<name>.ts`. A new integration adds format keys, so it starts with an issue.

1. `core`: its events in `EVENTS` and `RELAY_EVENTS`, its `SourceKind`, its key under `integrations` in the schema, and its rule.
2. `relay`: `src/integrations/<name>/` (`api.ts` for calls to the service, `signature.ts` for the check of its signature, `durable.ts`, `routes.ts`), one line in `INTEGRATIONS` of `src/index.ts`, its methods in `src/relay.ts`. `routes.ts` exports `hookRoutes`, open to the Internet and checked in the Durable Object (a signature, an OAuth state), and `engineRoutes`, which `src/index.ts` calls only with the engine's token. It reaches the relay's storage only through `RelayStore`.
3. `runner`: `src/sources/<name>/` (client, the events that become runs, `subject.ts`), wired in `engine/engine.ts` and `run/subject.ts`.
4. `cli`: `src/commands/connect/<name>.ts`, one line in `connect/index.ts`, its key in `runner/src/state/secrets.ts`, its client in `serviceClients()` of `commands/start/connections.ts`.
5. Tests beside the code in each package, and a page of the documentation site.

The folder names are those of `SourceKind`: `slack`, `linear`, `sentry`, `webhook`.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), in English, in the imperative or as a short statement of the new behavior:

```
feat(cli): start reads the studio's password and address
fix(relay): accept the engine behind Traefik
docs: the factory's scripts
```

Types used: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `revert`. The scope is the package (`core`, `runner`, `studio`, `cli`, `relay`, `docs`) or the area (`examples`, `e2e`). The body, when there is one, says why.

## Pull requests

- Branch from `main`, keep the pull request to one topic.
- Say what changes and why, and link the issue.
- Check that `pnpm test`, `pnpm lint` and `pnpm typecheck` pass; run `pnpm e2e` when you touch the engine, the relay or the CLI.
- Update the documentation site (`packages/docs`) when the behavior or the format changes.
- Leave `CHANGELOG.md` alone: after the merge, the factory's docs keeper adds the line users will read.

`main` is protected: changes land through a pull request whose CI (`check`) passes.

## Releases

openfabriq follows [Semantic Versioning](https://semver.org/). The version is the one in `packages/cli/package.json`: it is the version of the npm package and the Homebrew formula. Until 1.0, a minor version can change the `openfabriq/` format; the changelog then says how to update a factory.

A maintainer releases from `main`:

1. In a pull request, set `version` in `packages/cli/package.json` and rename `[Unreleased]` in `CHANGELOG.md` to `[X.Y.Z] - YYYY-MM-DD`, with a new empty `[Unreleased]` above it.
2. Once it is merged, tag the merge commit and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`. Only maintainers can create `v*` tags.
3. The `Release` workflow builds the package and creates the GitHub release, with the changelog section as notes and the npm tarball attached.
4. The same workflow then stages that tarball on npm, through npm's trusted publishing: no token, and the package shows its provenance. A maintainer publishes it with their 2FA: `npm stage list openfabriq`, then `npm stage approve <id>`. Within the hour, the formula in [`openfabriq/homebrew-tap`](https://github.com/openfabriq/homebrew-tap) follows npm's new version by itself (its `url` and `sha256`).

## License

openfabriq is licensed under the [Apache License 2.0](LICENSE). Before your first pull request is merged, you agree to the [Contributor License Agreement](CLA.md): tick its box in the pull request's description. You keep the copyright of your work; the agreement lets the project keep releasing it, under this license or another one.
