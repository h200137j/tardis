---
version: 1.0
name: Time Vortex
description: Deep-space navy, TARDIS blue, amber console lamps. A time machine for databases.
colors:
  light:
    bg: "#EDF2FA"
    bg-deep: "#E3EAF6"
    surface: "#FFFFFF"
    surface2: "#F2F6FC"
    surface3: "#E4EBF7"
    accent: "#1D6FE0"
    accent-hot: "#3D8BFF"
    amber: "#C77800"
    danger: "#D8434E"
    success: "#1FA05E"
    text: "#10203E"
    text-muted: "#5A6B8C"
    on-accent: "#FFFFFF"
  dark:
    bg: "#050A18"
    bg-deep: "#030712"
    surface: "#0B1228"
    surface2: "#111A38"
    surface3: "#1A2548"
    accent: "#5B9DFF"
    accent-hot: "#82B6FF"
    amber: "#FFB454"
    danger: "#FF6B7A"
    success: "#3DDC97"
    text: "#E8EEFB"
    text-muted: "#8FA0C4"
    on-accent: "#05122B"
  phases:
    dumping: "rgb(255, 170, 70)"
    downloading: "rgb(91, 157, 255)"
    importing: "rgb(61, 220, 151)"
typography:
  display:
    fontFamily: Unbounded
    fontWeight: 700
    letterSpacing: "0.02em"
  body:
    fontFamily: Sora
    fontSize: 14px
    lineHeight: 1.55
  mono:
    fontFamily: JetBrains Mono
  label:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: 500
    letterSpacing: "0.12em"
    textTransform: uppercase
rounded:
  sm: 8px
  md: 14px
  lg: 22px
  pill: 99px
spacing:
  sm: 8px
  md: 14px
  lg: 28px
motion:
  ease-out: "cubic-bezier(0.22, 1, 0.36, 1)"
  ease-spring: "cubic-bezier(0.34, 1.56, 0.64, 1)"
components:
  cta-time-rotor:
    background: "linear-gradient(135deg, {colors.accent-hot} → {colors.accent} → deep navy)"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.lg}"
    padding: 19px 28px
    effects: breathing glow, hover shine sweep, bobbing arrow
  card:
    background: "{colors.surface} at 88% + backdrop blur"
    border: 1px hairline, tints toward accent on hover
    rounded: "{rounded.lg}"
  nav:
    style: floating glass pill, centered top
    active: solid accent chip
---
## Overview

TARDIS is a time machine for databases, and the interface should feel like its
console room: dark space outside the window, glowing instruments inside, one
big lever you pull. Two themes — **dark** is deep space, **light** is a
blueprint. Dark is the flagship.

## Colors

- **Accent (TARDIS blue):** The one loud action per screen — the primary CTA,
  active nav chip, focus rings, links. Everything else stays quiet.
- **Amber (console lamp):** Attention and activity. Running status dots, the
  elapsed timer, the update banner, the breathing lamp after the wordmark.
  Never used for actions.
- **Phase colors:** Long-running syncs shift hue by phase — amber while the
  server dumps, TARDIS blue while downloading, green while importing. The
  vortex animation, status text, and progress ring all follow it.
- **Semantic:** danger = red (also marks the *production* environment lamp),
  success = green (local), amber = test.

## Typography

- **Unbounded** — display only: the wordmark and view titles. It is loud;
  use it with restraint.
- **Sora** — all UI body copy, buttons, labels.
- **JetBrains Mono** — anything instrument-like: logs, timers, byte counts,
  taglines, hints, pills, uppercase micro-labels (0.12em tracking).

## Motion

- Sections rise in with a ~50ms stagger on view load; views crossfade.
- Hover lifts (−1/−2px translateY) with a glow; active presses back down.
  Springy easing (`ease-spring`) for playful elements, `ease-out` for entrances.
- Progress bars shimmer; running status dots pulse; the CTA glow breathes.
- All of it collapses under `prefers-reduced-motion`.

## Signature elements

- **Starfield:** ambient canvas behind the whole app — twinkling drift, rare
  shooting star. Subtle in light theme, atmospheric in dark.
- **Console lamp:** the amber dot breathing after the TARDIS wordmark.
- **Time vortex:** the single progress animation — warp-tunnel star streaks
  around a glowing core with a progress ring; color eases between phases.

## Do's and Don'ts

- **Do** reserve TARDIS blue for exactly one primary action per screen.
- **Do** keep amber for status, never for buttons.
- **Do** use stroke SVG icons (2px weight). No emoji in UI chrome.
- **Don't** add a second gradient — the time-rotor CTA is the only one.
- **Don't** stack animations on one element; one idea per element, orchestrated
  at page level.
