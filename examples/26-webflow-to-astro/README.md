# 26: Webflow to Astro, without freezing the content

A factory that moves a Webflow site to an Astro site, in the repository of the new site, close to one shot. The planner surveys the Webflow site, its CMS through the API and its published pages, settles each question with its own recommendation, and slices the work into tickets: all of it in one pull request, the plan. A maintainer reads and merges it: that is the one checkpoint. From there, each merge opens the tickets it unblocks, the builder builds each one with side by side screenshots, and before its pull request opens, the parity review compares the Webflow and the Astro pages and sends any loss back to the builder. A person merges each pull request the review approved (`ready-to-merge`, with its risk), and acts where the factory writes `needs-human`. Every Monday, the builder brings back the CMS content editors changed in Webflow that week: nobody stops writing while the site moves.

What Webflow changes for a migration: **no local copy to read, a CMS behind an API token, and files on Webflow's CDN that stop answering when the plan ends.** The concept it teaches: a script with a secret (`scripts/webflow-export.sh`) that only the engine runs, so agents work from an export they never fetch themselves.

## What this factory does

<img src="workflow.png" width="1451" alt="migration:discover on the migration issue starts the planner, which opens the plan's pull request; a maintainer's comment on it sends the planner back to change it. Each push to the default branch, the plan's merge or a ticket's, starts the planner again, which opens the tickets it unblocks with ready-for-agent; the astro-builder builds each one, and the parity-reviewer reads its change before the pull request opens, sending it back until parity holds; a person's merge pushes to the default branch again; the astro-builder resolves conflicts, and every Monday it syncs the content from Webflow.">

Tickets have a type, in their title: `foundation` (the skeleton, `pnpm run import` and `pnpm parity`, always first), `content-type` (one CMS collection, its tested mapper), `template` (one page template), `feature` (a form, an interaction, search, filters…), `seo` (redirects, sitemap, metadata), and `switch` (what a person does to go live, always last).

## The flow

1. **Discover**: a maintainer opens a migration issue and adds `migration:discover`. The planner surveys the site and opens one pull request, the plan: `migration/inventory.md` (what the site has), `migration/decisions.md` (each question, the planner's choice and why), and one file per ticket in `migration/tickets/` (its type, what blocks it, its acceptance criteria). What no agent can decide (an account to create, the final domain, a secret) is listed in the pull request, which carries `needs-human` until a person merges it: everything waiting for you is there, never on the issue.
2. **The checkpoint**: a maintainer reads the plan and merges it. A comment on it before that, starting with `@openfabriq`, sends the planner back to change it in the same pull request; people can discuss it there without starting anything.
3. **Tickets open as they unblock**: each push to the default branch, the plan's merge or a ticket's, starts the planner. It opens, with `ready-for-agent`, each ticket whose last blocker this push merged: T01 first, then up to four at a time, which is how many run at once on the engine. Nothing else: a push that unblocks nothing opens nothing.
4. **Build**: the builder builds the ticket, opens a pull request with side by side screenshots, and marks the ticket `Status: done` in its file, which is what the planner reads once it merges.
5. **Review, before the pull request**: when the builder finishes and the checks pass, the engine runs the parity review on its change (`reviewed_by`), on the machine. A loss goes back to the builder, until parity holds: nothing of that loop is written on GitHub. The pull request then opens with one line on the review, `ready-to-merge` and its risk (`risk:low` when the change only builds pages, content or scripts of a site not yet live). When the review asks for a person, or after 3 rounds (`review_rounds`), it opens with `needs-human` and only the findings still open. A person merges: that merge is step 3 again. The weekly content sync is reviewed the same way.
6. **Switch**: the last ticket, `switch`, opens when every other one is merged. The builder builds nothing for it: it comments the checklist (moving the domain, putting the redirects live, cancelling the Webflow plan) and adds `needs-human`.

## Tree

```
openfabriq/
├── factory.yaml                       LEGACY_SITE_URL, WEBFLOW_SITE_ID, the WEBFLOW_API_TOKEN secret, commands, checks
├── scripts/
│   ├── webflow-export.sh              the export command: CMS collections and items, and their files, into webflow-export/
│   └── test/                          its test, against a fake Webflow
├── agents/
│   ├── planner/agent.md               surveys the site, settles the questions, slices the tickets; opens them as they unblock
│   ├── astro-builder/agent.md         builds a ticket, fixes what the review flagged, syncs the content each week
│   └── parity-reviewer/agent.md       Webflow against Astro before the pull request opens: visual, content, interactions, SEO, links (opus)
├── automations/
│   ├── plan-migration/                when: issue.labeled migration:discover; opens the plan's pull request
│   ├── open-tickets/                  when: default_branch.updated; opens the tickets that push unblocked
│   ├── build-tickets/                 when: issue.labeled ready-for-agent; reviewed by parity-reviewer
│   ├── resolve-conflicts/             when: pull_request.conflicted
│   └── sync-content/                  when: schedule, Monday 07:00 Europe/Paris; reviewed by parity-reviewer
└── skills/
    ├── webflow-reading/SKILL.md       the export's files, the published pages, interactions, forms, redirects
    ├── astro-conventions/SKILL.md     collections, mappers, pnpm run import, no Webflow runtime, no Webflow CDN
    ├── keystatic/SKILL.md             the content as Keystatic files, only when the plan chooses it
    └── browser-evidence/SKILL.md      Webflow and Astro pages side by side with agent-browser
```

## The export, and its token

`export` runs [`scripts/webflow-export.sh`](openfabriq/scripts/webflow-export.sh). It asks Webflow's Data API for every CMS collection, its fields and its published items, then downloads every file of Webflow's CDN those items point to (images, documents, images inside rich text). It writes them to `webflow-export/`, which the site's `.gitignore` leaves out; `pnpm run import`, written by the foundation ticket, turns that folder into the site's content without calling the network.

- **The token stays out of the agents' environment.** Only the commands receive `WEBFLOW_API_TOKEN`. But an agent that edits code and runs a command could still read it: create a **site token with read scopes only** (`cms:read`, `sites:read`), never one that can write.
- **The script comes from the applied factory**, never from a pull request's branch: changing it goes through `plan`, which shows it as a security change.
- **Rate limits**: Webflow allows 60 to 120 requests a minute, by plan; `curl --retry` waits when it hits the limit. A command has 10 minutes: a site with thousands of files may need several runs, or a larger limit.
- **Its test** runs it against a fake Webflow on this machine, with no token: `node --test 'openfabriq/scripts/test/*-test.mjs'`.

## The old site is the published one

There is no Webflow to run locally. Agents read the published site at `LEGACY_SITE_URL`, its `webflow.io` address, which stays up while the domain still points to Webflow and keeps the agents' visits out of the real domain's analytics. They never open the Designer, never submit a form, never write to Webflow.

What Webflow does not export, the agents read on the pages, or ask a human for:

- **Interactions** (`webflow.js` and its jQuery): rebuilt in CSS or a small island, never carried over.
- **Forms**: Webflow handles their submissions; where they go after the switch is a decision.
- **301 redirects**: Webflow's API gives them to Enterprise sites only. A maintainer copies them from Site settings > Publishing into `migration/redirects.csv`: the plan lists it as still open, and the `seo` ticket waits for that file.
- **Other locales**: the export reads the default locale; each other one is its own ticket.

## Optional: editing in Keystatic after the switch

By default, the content lands as Markdown files in the repository, which a developer edits through pull requests. For editors who want a UI after the switch, ask for [Keystatic](https://keystatic.com) in the migration issue, or comment `@openfabriq use Keystatic for editing` on the plan's pull request: the planner writes it into the editing decision, and the tickets follow the `keystatic` skill. The content stays the same files, with an admin UI at `/keystatic` that commits them. What it costs: the host must run Node for that page, and at the switch a person creates Keystatic's GitHub App (or a Keystatic Cloud project) and copies its variables to the host.

## What needs a person

The factory runs on its own between the plan and the switch. A person acts in two places only:

1. **The plan**: read it and merge it. It is the one checkpoint, and the cheapest place to change course: comment on it to change a decision or a ticket.
2. **`needs-human`**, on whatever carries it. It always says why in a comment:
   - on the migration issue: something only a person can do, such as creating an account or a secret, or choosing the final domain. When the answer changes the plan, comment on the plan before merging it; after that, write it in `migration/decisions.md` yourself: a ticket waiting on it (`Blocked by: a person: …`) opens with that push;
   - on a pull request: the review asked for a person, or its rounds ran out. Read its *Internal review* section, then merge it, or comment `@openfabriq` and what to change;
   - on a ticket: the builder could not build it without inventing an answer, or it is the `switch`, the last step, which is yours. For the first, answer in a comment and add `ready-for-agent` again: the builder reads the ticket's comments.

`needs-human` is also the label the engine adds when it gives up on a run. Filter your issues and pull requests on it: that is your whole to-do list. One case carries no label: when several merges land within the same minute and unblock more than five tickets, the planner opens five, and the others wait. If the build stops while a ticket of `migration/tickets/` is not done and its blockers are, open an issue with its file's text and add `ready-for-agent`. Turn on GitHub's merge queue if several pull requests can merge at once.

The switch is never automated: the factory has no access to the DNS, the hosting or Webflow's settings. Keep the Webflow site published a few days, then cancel the plan: the content and its files are already in the repository.

Least privilege: the planner may open the plan's pull request and the tickets; the builder may open pull requests; the reviewer writes nothing on GitHub: it gives a verdict to the engine. Nothing merges without a person.

## Make it yours

1. Start the new site's repository with an Astro project that has `build` and `test` scripts and a lockfile (`pnpm create astro@latest --template minimal`, then Vitest), so `setup` and the checks work from the first run.
2. Copy the `openfabriq/` folder to its root.
3. In `factory.yaml`, replace `repository`, `maintainers`, `LEGACY_SITE_URL` (Site settings > Publishing, the `webflow.io` address) and `WEBFLOW_SITE_ID` (Site settings > General).
4. In Webflow, Site settings > Apps & integrations, create an API token with read scopes only, then `openfabriq secret set WEBFLOW_API_TOKEN`.
5. Install the browsers once on the engine's machine: `npm install -g agent-browser && npx playwright install chromium-headless-shell` for the agents (the engine's Docker image has them; elsewhere, the skill's `compatibility` says how to point agent-browser to that Chrome), and `pnpm exec playwright install chromium` for `pnpm parity`.
6. Run `openfabriq plan`: it lists the script, the secret and the commands as security changes, and the labels it will create (`migration:discover`, `ready-for-agent`, `ready-to-merge`, `risk:low`, `risk:medium`, `risk:high` and `needs-human`).
7. `openfabriq apply`, then `openfabriq start`, and open the migration issue.
