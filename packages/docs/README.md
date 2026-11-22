# Documentation site

[Fumadocs](https://www.fumadocs.dev) on Next.js, exported as static files. From the repository root:

```bash
pnpm docs:dev     # http://localhost:4320
pnpm docs:build   # static output in packages/docs/out
```

| Where | What |
| --- | --- |
| `content/docs/` | the pages, in MDX; a folder's `meta.json` gives the sidebar its title and order |
| `content/snippets/` | what several pages show, included with `<include>../../snippets/name.mdx</include>` (the engine's variables) |
| `app/` | the routes: the home page (`(home)`), the pages (`(docs)/[...slug]`), the search index (`api/search`) |
| `components/` | the logo, and what a page can use without importing it (`Steps`, `Tabs`, `Callout`, `Cards`) |
| `public/screenshots/studio/` | captures of the studio |

Pages live at the root of the site (`/factory/agents/`), not under `/docs`.

## The project's address

The GitHub repository is written once, in the root `package.json` (`repository`). A fork sets `OPENFABRIQ_REPOSITORY=owner/name` when it builds the site or the npm package. In a page, write a link to it as `repo:tree/main/examples/02-sdlc`, and `%GITHUB_URL%` or `%GITHUB_OWNER%` in a code block (`repository.mjs`).

## Search engines and shared links

The site's address is `https://openfabriq.dev`; a fork sets `OPENFABRIQ_SITE_URL` when it builds. `lib/site.ts` gives each page its title, description, canonical address and the card a shared link shows, drawn by `app/og/` at export time. The export also writes `sitemap.xml`, `robots.txt`, `manifest.webmanifest`, and `llms.txt` and `llms-full.txt` for agents. The sitemap dates each page by its last commit: build from a full clone (`fetch-depth: 0`), or every page gets the same date.

## Audience statistics

To count visits with [Plausible](https://plausible.io), which sets no cookies, build with `PLAUSIBLE_SCRIPT`, the address of its script (for example `https://plausible.example.com/js/script.js`). The pages report under the site's domain, the host of its address, which is the domain to add in Plausible. To count them with [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/) too, build with `CLOUDFLARE_ANALYTICS_TOKEN`, the token of the site in Cloudflare (its automatic setup does not reach pages a Worker serves). Without these variables, the pages load no script.

## Tables of variables

A table that defines environment variables reads `Variable | Effect | Values | Default`, in that order, and adds `Where to get it` when the person has to fetch the value. Each variable has its own row. `Values` says what is accepted: the closed set (`dumb`), the form (`owner/name`, comma-separated), or an example with made-up data (`acme/web-app`, `https://factory.example.com`). A secret shows the beginning of its shape and never a value: `sk-ant-api03-…`, `github_pat_…`, `xoxb-…`. `Default` only appears when the variable has one. A table that two pages need goes in `content/snippets/`, never copied.

## Screenshots

The studio's, from made-up data (never `~/.openfabriq`), with the `dev-browser` CLI:

```bash
pnpm build
pnpm --filter @openfabriq/studio docs-screenshots   # writes public/screenshots/studio/
dev-browser stop
```

The landing's studio is the real one: its demo build (`pnpm --filter @openfabriq/studio build:demo`, which `dev` and `build` run first) reads answers recorded from the same made-up data. Record them again when the studio's pages or API change:

```bash
pnpm build
pnpm --filter @openfabriq/studio docs-demo   # writes public/studio-demo/api/
dev-browser stop
```

The terminal captures come from `scripts/cli-screenshots.mjs`, the Slack and Linear ones from the `scripts/*-screenshots.js` next to it.
