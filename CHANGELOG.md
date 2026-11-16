# Changelog

All notable changes to openfabriq are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `openfabriq deploy coolify` runs the engine on your Coolify through its API, with no variables to export: it asks for Coolify's address and token and a Claude credential, masked, uses the GitHub App of `connect github`, gives the studio a domain and a password if you want, deploys, and reports the engine's checks.

## [0.1.2] - 2026-11-16

### Added

- `openfabriq --version` (or `-v`) prints the installed version.

### Changed

- Releases are staged on npm by the release workflow, with provenance, and published once a maintainer approves them; the Homebrew formula follows npm by itself.

## [0.1.1] - 2026-11-16

### Changed

- **The documentation site is online** at [openfabriq.dev](https://openfabriq.dev), and the npm package's homepage points to it.
- **The README** opens with "Your AI software factory, as code.", and its video plays again.

## [0.1.0] - 2026-11-16

The first public release, 0.1.0, built from November 1 to 7, 2026: a factory described in a few files that runs on a developer's machine or a team's server, easy to set up and pleasant to follow.

### Added

- **The `openfabriq/` format**: agents, automations (`when`, `agent`, `can`), limits and the factory's settings in readable Markdown and YAML files, validated with clear messages.
- **The CLI**: `init`, `validate`, `doctor`, `plan`, `apply`, `start`, `status`, `run`, `mcp`, `connect`, `secret` and `update`. `plan` shows what will change, `apply` applies it, and `start` shows the plan and applies it once you type yes.
- **AI onboarding**: `openfabriq init` opens a Claude Code session that reads the repository, asks a few questions and writes the factory; `init --example <name>` copies one of the templates in [`examples/`](examples).
- **The local engine**: watches GitHub through `gh`, runs agents with the user's Claude Code in a worktree, and applies only the outputs `can` allows (pull requests, comments, labels, issues, closing an issue or a pull request, merging a pull request under the factory's conditions). Pull requests that fall into conflict can be resolved by an agent. A persistent queue, `setup` commands, ignored paths, and reliable schedules with a time zone and catch-up after sleep.
- **The harness**: named `commands` for agents, `checks` run by the engine before it applies code, the factory's own `scripts/`, environment variables and secrets kept on the engine's machine.
- **The internal review**: `reviewed_by` on an automation names an agent that reviews the change before the pull request exists. Its verdict (`approved`, `needs_changes`, `needs_human`) goes back to the implementer at most `review_rounds` times; the pull request reaches people with one line on the review and the labels `ready-to-merge` and `risk:low`, `risk:medium` or `risk:high`, or with `needs-human` and only the findings still open. The rounds are on the run's page in the studio, and the `02-sdlc` template reviews this way instead of on GitHub.
- **Safety**: no GitHub credentials for agents, a sandbox for the agents' shell and the engine's commands, network rules (`network`: the sites agents and commands reach, the package registries and GitHub by default), commits that change CI workflows refused, secrets masked in command output, and what a run started by untrusted text writes does not start the automations kept for maintainers.
- **Integrations through a relay** the user deploys, on Cloudflare or self-hosted with Docker: Slack mentions and thread replies, Linear labels and delegation, new Sentry issues, and signed webhooks from any service. MCP servers for agents, chosen tool by tool.
- **The studio**: a local app with the projects, agents, runs, the readable detail of a run, a board, a graph of the workflow, metrics, and a read-only chat with the factory. It opens with a token, or with a password on a server.
- **openfabriq as a connector of Claude**: with the studio's password and domain, the engine serves its read-only MCP server at `https://<domain>/mcp`, for Claude Desktop, claude.ai and Claude Code, behind OAuth whose key is the studio's password.
- **Running for a team**: the engine on a server with an Anthropic API key, in Docker with `docker-compose.yml`.
- **A GitHub App of your team** instead of a token (trial): `openfabriq connect github` creates it from a manifest, and the engine works as it with a token per repository, renewed by itself, that reads the CI's checks; no bot account to create.
- **Sign-in with GitHub** to the studio and to the connector on a server: whoever can write to a repository of the factory enters with their own GitHub account, through the team's GitHub App, and is out within the hour once removed. Failed sign-ins count per address, so a stranger on the public domain can no longer lock the team out.
- **Distribution**: an npm package and a Homebrew formula.
- **Documentation**: a static site in [`packages/docs`](packages/docs).
