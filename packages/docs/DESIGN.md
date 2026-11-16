---
name: openfabriq site
description: The landing and templates catalog, drawn in the studio's own world.
colors:
  studio-blue: "oklch(0.5 0.19 262)"
  studio-blue-soft: "oklch(0.54 0.19 262 / 0.08)"
  studio-blue-line: "oklch(0.54 0.19 262 / 0.3)"
  done-green: "oklch(0.55 0.13 152)"
  done-green-soft: "oklch(0.55 0.13 152 / 0.1)"
  needs-you-amber: "oklch(0.51 0.12 66)"
  needs-you-amber-soft: "oklch(0.7 0.14 80 / 0.14)"
  failed-red: "oklch(0.55 0.2 27)"
  failed-red-soft: "oklch(0.55 0.2 27 / 0.09)"
  ground: "oklch(0.984 0.0015 264)"
  panel: "oklch(1 0 0)"
  sunken: "oklch(0.966 0.003 264)"
  hairline: "oklch(0.919 0.004 264)"
  ink: "hsl(0, 0%, 3.9%)"
  ink-muted: "hsl(0, 0%, 38%)"
  diagram-ground: "#f3f4f6"
typography:
  display:
    fontFamily: "Geist (next/font), ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.9rem, 7vw, 5.5rem)"
    fontWeight: 600
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Geist (next/font), ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Geist (next/font), ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.375
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Geist (next/font), ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.625
  body-small:
    fontFamily: "Geist (next/font), ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
  mono:
    fontFamily: "Geist Mono (next/font), ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "Geist Mono (next/font), ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  tag: "6px"
  control: "8px"
  field: "12px"
  surface: "16px"
  pill: "9999px"
spacing:
  inline: "6px"
  gap: "8px"
  card: "20px"
  gutter: "24px"
  section: "96px"
  section-wide: "128px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    rounded: "{rounded.field}"
    padding: "0 20px"
    height: "44px"
  copy-command:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.field}"
    height: "44px"
  copy-command-quiet:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.field}"
  window:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.surface}"
  template-card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.surface}"
    padding: "20px"
  segmented-tab:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.control}"
    height: "36px"
  segmented-tab-active:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
  status-pill-working:
    backgroundColor: "{colors.studio-blue-soft}"
    textColor: "{colors.studio-blue}"
    rounded: "{rounded.pill}"
  status-pill-done:
    backgroundColor: "{colors.done-green-soft}"
    textColor: "{colors.done-green}"
    rounded: "{rounded.pill}"
  trigger-tag:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
---

# Design System: openfabriq site

## Overview

**Creative North Star: "The Studio, Seen From Outside"**

The landing (`/`) and the templates catalog (`/templates/`) are drawn in the product's own studio: the same faces, grounds, accent, state hues and window frames the visitor will meet after install. Proof comes from real artifacts (files, a plan, a board, a run log) set in window frames; the page persuades through craft, not decoration. The docs pages keep Fumadocs' own styles and share only the accent, the faces and the focus ring.

Density is calm: near-white panels on a cool grey ground, wide air between sections, hierarchy carried by scale contrast alone. Motion is the studio's: values arrive, work breathes, cards travel. Everything moving can be paused and stops under reduced motion.

**Key Characteristics:**
- One accent (studio blue); state hues only for states.
- Geist for prose and headings, Geist Mono for paths, commands, triggers and file content.
- Hairline borders, 12–16px radii, layered soft shadows.
- Files, terminals and studio views always sit in a window frame.
- Tabular numerals for every clock, cost and count.
- Dark theme mirrors the studio's dark, token for token.

## Colors

Cool near-neutrals (hue 264, chroma ≤ 0.007) with one blue and four state hues. Every value has a dark twin in `.dark` (see the sidecar).

### Primary
- **Studio Blue** (`studio-blue`): links, the active file in the tree, the working dot, focus rings, selection tint, the margin glosses on files. Its soft fill and line (`studio-blue-soft`, `studio-blue-line`) mark the "working" state and the current row.

### Tertiary (state hues)
- **Done Green** (`done-green`): applied, succeeded, copied, the `+` of an added file or a plan line.
- **Needs-You Amber** (`needs-you-amber`): a card or plan line waiting for a person.
- **Failed Red** (`failed-red`): a failed or refused step.
Each has a soft fill for pills and result cards.

### Neutral
- **Ground** (`ground`): the page under the landing and catalog.
- **Panel** (`panel`): windows, cards, raised controls.
- **Sunken** (`sunken`): window title bars (at 60%), board columns, quiet commands, tag chips, the segmented control's track.
- **Hairline** (`hairline`): every border and divider.
- **Ink** (`ink`) and **Muted Ink** (`ink-muted`): Fumadocs' neutral foreground; muted is overridden to 38% grey so it clears 4.5:1 on panels.
- **Diagram Ground** (`diagram-ground`): the fixed light ground behind workflow PNGs; never themed directly (see Shapes).

### Named Rules
**The One Hue Per State Rule.** Blue means working, amber means needs you, green means done or applied, red means failed or refused. A state hue never decorates; a decoration never borrows a state hue.

**The Agent Swatch Exception.** An agent's identity is an 8px square at `oklch(0.64 0.13 <hue>)`, the studio's agent mark. It is the only place a free hue appears.

## Typography

**Display Font:** Geist Variable (with ui-sans-serif, system-ui)
**Body Font:** Geist Variable
**Label/Mono Font:** Geist Mono Variable (with ui-monospace, SF Mono, Menlo)

**Character:** One sans at two weights (400 prose, 500–600 controls and headings), with mono reserved for what a user would type or read in a file.

### Hierarchy
- **Display** (600, 2.9rem → 4.5rem → 5.5rem, 0.98, -0.04em, balanced): the one hero sentence per page; catalog and detail heroes use the same voice at 3–4.5rem.
- **Headline** (600, 1.875rem → 2.25–2.6rem, -0.03em, balanced): section titles.
- **Title** (600, 17–20px, tight tracking): card titles, run titles.
- **Body** (400, 1.125–1.25rem lead, 0.875–0.9375rem in panels, relaxed leading, pretty wrap): the lead under a headline caps at 42rem.
- **Mono** (13px in commands and code, 12.5px in the file tree, 12px in title bars): paths, commands, file content.
- **Label** (11–12px, sans or mono, sentence case): counts, chips, "Example data".

### Named Rules
**The Scale-Only Hierarchy Rule.** Hierarchy comes from size and weight contrast, never from colored, uppercase or tracked-out labels above headings.

**The Tabular Rule.** Every clock, cost, duration and count uses tabular numerals; a changing value animates digit by digit (`of-digit`).

## Layout

A 1280px column (`max-w-7xl`) with 16px gutters, 24px from `sm`. The landing opens on a tabbed window: four tabs, an explanation strip, then a 17.5rem file tree beside the file from `md` (stacked, the tree capped in height, below it). Section bands use 96px vertical padding, 128px from `sm`. Content grids pair a text column with a visual, either `1fr 1fr` or a fixed 17–22rem side column. Heroes fill the first viewport minus the nav. Board columns scroll horizontally with snap on small screens.

## Elevation & Depth

Layered and ambient: shadows are soft, cool-tinted, and stacked (a long low blur plus a tight contact shadow). Elevation tells a surface's role, not its state alone.

### Shadow Vocabulary
- **Rest** (`shadow-of-1`): cards, commands, tags laid on a panel.
- **Raised** (`shadow-of-2`): the primary button, the active tab, a cause card.
- **Window** (`shadow-of-3`): window frames, a template card on hover, a card travelling on the board.

### Named Rules
**The Lift On Intent Rule.** A card rises one step on hover (rest → window, 2px up, border tinted with blue at 30%) and nothing else changes.

## Shapes

Gently rounded: 6px on tags, 8px on small controls, 12px on fields, buttons and board cards, 16px on windows, cards and large panels, full round on pills, dots and counters. Every surface has a 1px hairline border. Window frames carry a 40px title bar with three muted dots and the file path in mono.

**The One Surface Diagram Rule.** Workflow diagrams are light PNGs on the fixed light diagram ground; in dark mode the image and its ground are inverted together (`invert(0.92) hue-rotate(180deg) saturate(1.4)`), so they stay one surface and keep their hues.

## Components

### Buttons
- **Primary:** ink fill, panel text, 44px tall, 12px radius, 20px horizontal padding, 15px medium, raised shadow; hover drops to 90% opacity and the trailing arrow slides 2px.
- **Ghost control:** 28px, 6px radius, muted text, accent-grey fill on hover (Pause/Play, copy).
- **Film call:** the hero's third action, after the install command: a 44px ink disc with a play mark, rings that leave it in a steady wave, one every 1.1s (`of-beckon`, still under reduced motion), and two lines, "Watch the film" (15px semibold) over "85 seconds" (13px muted). Hover raises a soft pill behind disc and words (sunken in light, panel in dark), nothing else moves. The film opens in a modal at 30% volume.

### Copy Command
- A 44px mono field with a muted `$`, the command, and an icon button that turns into a green check (arriving via `of-digit`) and announces "Copied". The panel tone sits on the ground; the quiet (sunken) tone sits inside cards and may wrap, always keeping its last word whole.

### Chips
- **Trigger tag:** sunken fill, 11px mono, muted, 6px radius.
- **Status pill:** full round, soft state fill, state-colored text with a dot; the working dot pulses.
- **Gloss:** a blue-lined pill in the margin of a file line, explaining a key; hidden under 40rem.

### Cards / Containers
- **Window:** panel, 16px radius, hairline, window shadow, title bar on sunken at 60%; "Example data" pill when content is simulated.
- **Template card:** panel, 16px radius, rest shadow; the 16:9 workflow preview on the diagram ground, a mono family tag, title, description, up to three trigger tags, agent/automation counts, and a quiet copy command. The whole card is the link.

### Inputs / Fields
- **Search:** 12px radius, hairline, panel, rest shadow; focus tints the border blue at 50% with a 4px blue ring at 10%.
- **Focus (global):** 2px studio-blue outline, 2px offset.

### Navigation
- **Segmented tabs:** a sunken track with 4px padding; the active tab is a raised panel in ink, others muted.
- **File tree:** inside the landing's tabbed window, an accordion explorer: it starts closed (only the top folders), a folder opens on click, closes the other branches and shows the file it leads to (one it holds directly, or through a single subfolder), a file opens on click and stops the tour, a tab leaves open only the folders that hold its file. The current file is a blue-soft row in blue.

### Board and Run demos (signature)
The board loops cards between columns with FLIP travel; the run streams its log line by line (`of-enter`) while clock and cost tick. Both start only in view, pause off-screen, carry Pause/Play controls, and render static under reduced motion.

## Do's and Don'ts

### Do:
- **Do** take every color from the `of-*` and `fd-*` tokens so the dark theme follows.
- **Do** frame files, terminals and studio views in a window with their real path.
- **Do** use the easing `cubic-bezier(0.16, 1, 0.3, 1)` for every transition and keyframe.
- **Do** give every looping demo a pause control and an in-view start.
- **Do** filter a workflow image and its ground together in dark mode.

### Don't:
- **Don't** introduce a second accent or use a state hue for decoration.
- **Don't** put uppercase or tracked eyebrow labels above headings.
- **Don't** use hard offset shadows or flat borderless cards; depth is hairline plus soft layered shadow.
- **Don't** animate anything that keeps moving under `prefers-reduced-motion`.
- **Don't** show invented numbers, logos or quotes as proof; mark simulated content "Example data".
