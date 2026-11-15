---
name: SHMS (Space Health Management System)
description: One health hub per astronaut, lit like the cupola window, in daylight and at night.
colors:
  cloud-ground: "#F4F7FA"
  card-white: "#FFFFFF"
  soft-tile: "#F1F5F9"
  well: "#E6EDF4"
  hairline: "#D5E0EB"
  hairline-strong: "#B9C9D9"
  ocean-ink: "#0E2A47"
  ink-secondary: "#4A6582"
  ink-tertiary: "#56708C"
  ink-faint: "#7B90A6"
  atmosphere-blue: "#2F7FD8"
  atmosphere-blue-soft: "#E8F2FC"
  limb-blue: "#7FC4F5"
  sun-amber: "#E8A33D"
  state-ok: "#17834F"
  state-warn: "#B45F00"
  state-warn-soft: "#FFF8EE"
  state-bad: "#C62F45"
  state-bad-soft: "#FFF3F4"
  danger-fill: "#C62F45"
  energy-ochre: "#A36A12"
  ground-navy: "#2C5A8A"
  night-ground: "#07111F"
  night-card: "#0E1D32"
  night-soft-tile: "#13253E"
  night-well: "#192E4C"
  night-hairline: "#243C5E"
  night-hairline-strong: "#38547A"
  night-ink: "#E8F0F8"
  night-ink-secondary: "#9AB1CA"
  night-ink-tertiary: "#869EBA"
  night-atmosphere-blue: "#549CEC"
  night-atmosphere-blue-soft: "#142D4E"
  night-state-ok: "#40C482"
  night-state-warn: "#ECA848"
  night-state-warn-soft: "#2E2212"
  night-state-bad: "#EE5A6E"
  night-state-bad-soft: "#341620"
  night-energy-ochre: "#E2A450"
  night-ground-navy: "#80AADE"
typography:
  display:
    fontFamily: "Public Sans, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "60px"
    fontWeight: 800
    lineHeight: 1.04
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Public Sans, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Public Sans, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.015em"
  numeral:
    fontFamily: "Public Sans, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "36px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.025em"
    fontFeature: "tnum"
  body:
    fontFamily: "Public Sans, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "Public Sans, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.33
rounded:
  tag: "4px"
  control: "12px"
  crew-card: "14px"
  tile: "18px"
  card: "24px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.atmosphere-blue}"
    textColor: "{colors.card-white}"
    rounded: "{rounded.pill}"
    padding: "8px 24px"
    height: "48px"
  button-ghost:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ocean-ink}"
    rounded: "{rounded.pill}"
    padding: "8px 24px"
    height: "48px"
  button-ghost-hover:
    backgroundColor: "{colors.soft-tile}"
  button-danger:
    backgroundColor: "{colors.danger-fill}"
    textColor: "{colors.card-white}"
    rounded: "{rounded.pill}"
    padding: "8px 24px"
    height: "48px"
  card:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ocean-ink}"
    rounded: "{rounded.card}"
    padding: "24px"
  alert-tile-warn:
    backgroundColor: "{colors.state-warn-soft}"
    textColor: "{colors.ocean-ink}"
    rounded: "{rounded.tile}"
    padding: "20px"
  alert-tile-bad:
    backgroundColor: "{colors.state-bad-soft}"
    textColor: "{colors.ocean-ink}"
    rounded: "{rounded.tile}"
    padding: "20px"
  nav-item:
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "46px"
  nav-item-active:
    backgroundColor: "{colors.atmosphere-blue-soft}"
    textColor: "{colors.atmosphere-blue}"
  seg-option-selected:
    backgroundColor: "{colors.ocean-ink}"
    textColor: "{colors.cloud-ground}"
    rounded: "{rounded.pill}"
    height: "44px"
  status-pill-warn:
    textColor: "{colors.state-warn}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
---

# Design System: SHMS (Space Health Management System)

## Overview

**Creative North Star: "The Cupola Window"**

The app is lit like the ISS cupola looking down at Earth. In daylight (Cupola Daylight, the default light theme) that means a cloud-white ground, pure white cards and ocean-navy ink. At night (Cupola Night, the dark theme) it is the station over Earth's night side: deep ocean navy ground, cards one step lighter, pale ink. Both themes are one system. Every colour is a CSS variable holding `R G B`, defined once per theme, and every component reads the same semantic names, so a screen built for one theme is correct in the other without edits. The theme follows the operating system until the person picks one with the round switch in the header. The choice is stored and applied before first paint.

One thing holds the world together: the **atmosphere limb line**, a thin pale-blue glow (3px) along the bottom edge of every header. A bright white point travels along it from launch to landing, so the line doubles as mission progress. On the login screen the same line becomes the full curved Earth limb, and the crew card is read on it.

Density is calm but data-rich. Structure comes from 1px hairlines and quiet tonal steps, not boxes inside boxes. One family, Public Sans, carries both display and data, always with tabular numerals. Every health state is readable without colour: it always has a shape and a word as well.

**Key Characteristics:**
- Two themes, one token set: Cupola Daylight (light) and Cupola Night (dark), switched by `data-theme` on the root.
- A single atmosphere blue for the primary action, selection and focus. Its rarity is the point.
- The limb line under every header, doubling as mission progress.
- Hairline metric cells instead of boxed tiles. Generous 24px card corners, pill-shaped controls.
- States as shape + word + colour: circle = normal, triangle = watch, diamond = act now.
- Soft, navy-tinted (light) or black (dark) ambient shadows. Nothing hard-edged.

## Colors

A cool sky-and-ocean palette: blue-tinted neutrals, one saturated atmosphere blue, a warm sun amber used sparingly, and state colours tuned separately for each theme so they keep contrast. Light values are listed in the frontmatter by role name; their Cupola Night counterparts carry the `night-` prefix.

### Primary
- **Atmosphere Blue** (light `atmosphere-blue`, dark `night-atmosphere-blue`): the one primary action per view, the active nav item, focus rings, caret, selection in segmented controls and links. Its soft ground (`atmosphere-blue-soft`) backs active nav pills and the ground-copy note.

### Secondary
- **Limb Blue** (`limb-blue`, the same in both themes): the atmosphere line, the Earth's glow, reading rings on the login, the ground-note border and text selection (at 45%). It is light, not ink: never used for text.

### Tertiary
- **Sun Amber** (`sun-amber`, the same in both themes): the crew card's chip and rare highlights. Never a state colour; warn has its own deeper amber.

### Neutral
- **Cloud Ground / Night Ground** (`cloud-ground`, `night-ground`): the page.
- **Card White / Night Card** (`card-white`, `night-card`): cards, header, side rail, bottom bar, ghost buttons, menus.
- **Soft Tile** (`soft-tile`, `night-soft-tile`): segmented-control track, hover state on white controls, clock and phase chips.
- **Well** (`well`, `night-well`): progress-bar tracks, chart grid, unselected rating buttons.
- **Hairline** (`hairline`, `night-hairline`): every 1px border, card dividers, metric-cell top rules. **Hairline Strong** is the hover border on lifted cards and the scrollbar thumb.
- **Ocean Ink / Night Ink** (`ocean-ink`, `night-ink`): headings, values, primary text.
- **Ink Secondary** (`ink-secondary`, `night-ink-secondary`): subtitles, labels, units, inactive nav. **Ink Tertiary** for chart axes and fine print; **Ink Faint** for the faintest captions only.

### State
- **OK / Warn / Bad** (`state-ok`, `state-warn`, `state-bad` and their `night-` versions): health status. In light they are darkened to hold contrast on white; in dark they are brightened to hold on navy. Warn and bad have soft grounds (`state-warn-soft`, `state-bad-soft`) for alert tiles, the alerts button and the simulated-data badge.
- **Danger Fill** (`danger-fill`, the same in both themes): solid background of the destructive button, so white text keeps contrast in dark mode, where `night-state-bad` is too light to carry it.
- **Energy Ochre** and **Ground Navy** (`energy-ochre`, `ground-navy`): data-series colours for energy and for rest/telemetry, and Ground Navy also marks the lab-team (ground) badge.

### Named Rules
**The One Atmosphere Rule.** Atmosphere Blue marks the single primary action, the current location and focus. Nothing decorative is blue-filled.

**The Never-Colour-Alone Rule.** A state colour is always paired with a shape (circle / triangle / diamond) and a word ("Normal", "Watch", "Act now"). A metric cell on watch or act-now also thickens its top hairline to 2px in the state colour.

**The Same-Names Rule.** Components use the semantic tokens (ground, card, soft tile, well, hairline, ink, state), never a literal hex. Charts and SVG, which cannot read CSS variables, read the theme's current values through the `C` getters and `themePalette()` in `lib/theme.tsx`, which hold exactly the hexes above for each theme. The one place literal colour is allowed is the login's Earth and anything drawn on it, which stays the same in both themes because Earth is always ocean.

## Typography

**Display Font:** Public Sans (with system-ui, -apple-system, Segoe UI, Roboto, sans-serif)
**Body Font:** Public Sans
**Label/Mono Font:** Public Sans; monospace appears only for raw card IDs in the demo-card menu.

**Character:** A plain, public-service grotesque used for everything. Hierarchy comes from weight (400 to 900) and size, with tight negative tracking at the top of the scale. Public Sans is bundled as a variable font (weights 400-800) because the Android app runs offline; it is never fetched.

### Hierarchy
- **Display** (800, 34px phone / 52px tablet / 60px desktop, line-height 1.04, -0.03em): the login headline only.
- **Headline** (800, 28px phone / 34px desktop, -0.02em): the page title, set above a hairline with its subtitle in Ink Secondary at 15-16px.
- **Title** (700, 16px phone / 18px desktop, tight tracking): card titles, above the card's own hairline divider.
- **Numeral** (800-900, 30-36px, tight tracking, tabular): metric values. The unit sits beside it at 14-16px, weight 500, Ink Secondary.
- **Body** (400, 16px, 1.5): running text and meanings, in Ink Secondary-to-ink. Subtitles cap at about 48rem.
- **Label** (600, 12px): metric labels, captions, baseline lines. Fine print drops to 11px. Sentence case; no uppercase, no letter-spaced kickers.

### Named Rules
**The One Family Rule.** Public Sans only. No second display face, no system fallback chosen as a look.

**The Tabular Rule.** Numerals are tabular everywhere (set on `body` and on tables), so values in a column and a ticking mission clock never jitter.

## Layout

The app shell is a sticky header (white or night card, 95% opaque) closed by the limb line; below it, a 240px side rail on tablets and up (from 768px) and the content column. On phones the rail becomes a floating pill-shaped bottom bar, inset 12px from the edges, with icon-over-label items at least 54px tall, and the content gets 112px of bottom padding to clear it. Content padding is 16px on phones and 24px from 640px up.

Spacing runs on a 4px base. Small gaps of 8px and 12px dominate inside components; 16-20px separates cells; cards pad 20px on phones and 24px on wider screens; sections stack with 20px gaps. Wide pages cap at 72-80rem. Touch targets are at least 44px everywhere (48px for buttons), because the crew uses a tablet in microgravity.

The login is its own composition: a top bar (mark left; mission day, link status, language and theme right), a centred headline block, and the lower half given to the Earth limb with the card on it and the manual sign-in row at the bottom.

## Elevation & Depth

A hybrid: depth comes first from tonal steps (ground, then card, then soft tile, then well), and cards add one soft ambient shadow. In light the shadows are navy-tinted and low; in dark they are black and deeper so cards still separate from the navy ground. Interactive cards lift 2px on hover (pointer devices only) and swap to the stronger shadow and border.

### Shadow Vocabulary
- **Card** (light `0 1px 2px rgba(14,42,71,0.05), 0 10px 28px -18px rgba(14,42,71,0.28)`; dark `0 1px 2px rgba(0,0,0,0.3), 0 12px 30px -18px rgba(0,0,0,0.7)`): every card and alert tile at rest.
- **Lift** (light `0 2px 4px rgba(14,42,71,0.06), 0 18px 36px -18px rgba(14,42,71,0.34)`; dark `0 2px 4px rgba(0,0,0,0.35), 0 18px 36px -16px rgba(0,0,0,0.8)`): hovered cards, the bottom bar, popover menus.
- **Tinted glow** (`0 6px 16px -8px rgb(accent / 0.55)` and state equivalents): only under a solid primary button or a solid state badge, in its own colour.
- **Atmosphere glow** (`0 1px 8px rgba(127,196,245,0.55)` on the limb line; layered limb-blue glows above the Earth): the world's signature light, not a general-purpose shadow.

### Named Rules
**The Soft-Light Rule.** Every shadow is diffuse and offset downward with a negative spread. No hard offset shadows, no inner shadows.

## Shapes

Generous, friendly curves at the container level and full pills for anything you press. Cards use 24px corners, alert tiles and popovers 18px, rating buttons and menu rows 12px, the crew card 14px, and small source tags (verified / unverified) 4px. Buttons, nav items, chips, segmented controls, the crew switcher and the bottom bar are all fully rounded pills. Borders are always 1px hairlines; the only 2px strokes are the state top-rule on a metric cell, the reading rings and the focus outline. The "unverified" tag is the one dashed border, and it means exactly that.

## Components

### Buttons
Confident, pill-shaped and big enough for a gloved thumb.
- **Shape:** full pill (9999px), at least 48px tall, 24px horizontal padding, 16px semibold label.
- **Primary:** Atmosphere Blue with white text and its tinted glow.
- **Ghost:** card background, 1px hairline, ink text; hover moves to Soft Tile.
- **Danger / OK:** Danger Fill or OK with white text.
- **Hover / Focus / Active:** hover brightens 10% (solid kinds); focus is a 2px Atmosphere Blue outline at 2px offset; press scales to 0.97. Disabled drops to 40% opacity.

### Chips and pills
- **Status pill:** state colour at 15% for ground, 40% for border, state colour for text, with the status shape at 10px and the word.
- **Info chips** (mission clock, phase, landing countdown): Soft Tile ground, 14px text, no border.
- **Simulated-data badge:** warn-soft ground, warn text and border; always visible in the header.
- **Source tags:** 11px semibold with 4px corners; verified in OK, unverified dashed in Warn.

### Cards / Containers
- **Corner Style:** 24px.
- **Background:** Card White / Night Card.
- **Shadow Strategy:** Card shadow at rest; Lift on hover when the card is a link.
- **Border:** 1px hairline. The title row has its own hairline divider below it.
- **Internal Padding:** 20px on phones, 24px from 640px.

### Metric cells
The hairline replaces the box. A metric is a top hairline, a 12px label, a large tabular numeral with its unit, the status shape on the right, a baseline line ("Your normal: ..."), an optional sparkline, and one sentence of meaning. On watch or act-now the top rule becomes 2px in the state colour.

### Alerts
Alert tiles use 18px corners and 20px padding. Watch alerts sit on warn-soft with a warn border at 45%; act-now alerts on bad-soft with a bad border at 55%. The title leads with the status shape, then a "Why:" sentence, then recommendations with a chevron icon in Atmosphere Blue.

### Navigation
- **Side rail:** 240px, card background, hairline right border. Items are 46px pills with a 2px-stroke icon and a 15px semibold label; inactive in Ink Secondary, hover on Soft Tile, active on atmosphere-blue-soft with Atmosphere Blue text.
- **Bottom bar (phones):** a floating pill with the Lift shadow; items stack icon over an 11px label, same active treatment.
- **Header controls:** alerts count (pill coloured by the worst active state), language, the round 44px theme switch showing what it switches to (moon or sun), and sign-out.

### Segmented control and crew switcher
A Soft Tile pill track with a hairline border and 4px inset. The selected option inverts to an ink pill with ground-coloured text and bold weight; the others stay Ink Secondary and darken on hover.

### Icons
One authored set on a 24-unit grid with 2px round strokes in `currentColor`, at 16-20px. No icon fonts, no emoji as icons.

### The Limb Line (signature)
A 3px horizontal gradient of Limb Blue, fading out at both ends, with a soft blue glow, placed as the bottom edge of every header. A 9px white point ringed in Atmosphere Blue marks mission progress from launch to landing and glides to a new position over 900ms. On the login it becomes the full Earth: a huge circle of deepening ocean blues with faint cloud bands and a layered atmosphere glow along its edge. The crew card sits on the limb inside three breathing reading rings; on success the card settles and a check pops; on an unknown card it nudges sideways twice.

### Motion
Short and eased with `cubic-bezier(0.16, 1, 0.3, 1)`: 200ms for hover lift, 360-520ms for confirmations, 700-900ms for progress arcs and the limb point. With reduced motion requested, transitions and animations stop and the reading rings hold still at half opacity.

## Do's and Don'ts

### Do:
- **Do** build every surface from the semantic tokens (ground, card, soft tile, well, hairline, ink, state) so it is correct in both Cupola Daylight and Cupola Night.
- **Do** give every SVG or chart colour through `C` / `themePalette()`, never a hardcoded hex.
- **Do** close every header with the limb line and keep its progress point.
- **Do** pair every state colour with its shape (circle, triangle, diamond) and a word.
- **Do** separate metrics with hairlines (1px top rule) inside a card rather than nesting boxed tiles.
- **Do** keep touch targets at least 44px and buttons at least 48px tall.
- **Do** use tabular numerals for every value and clock.

### Don't:
- **Don't** use a dark starfield, neon glow or sci-fi dashboard look. The night theme is a calm navy ocean, not space.
- **Don't** add a second accent colour or fill decorative elements with Atmosphere Blue.
- **Don't** use Sun Amber or Limb Blue for text or as a status colour.
- **Don't** use hard offset shadows, inner shadows or black outlines.
- **Don't** add uppercase eyebrows or letter-spaced kickers above headings.
- **Don't** use emoji or icon fonts as icons; use the authored 2px-stroke set.
- **Don't** fetch fonts from the network; Public Sans is bundled.
