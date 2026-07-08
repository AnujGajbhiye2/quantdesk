---
name: QuantDesk
description: Terminal-native strategy research and paper-trading dashboard
colors:
  bg-base: "#0a0e14"
  bg-panel: "#0d1117"
  bg-panel-header: "#161b22"
  text-primary: "#c9d1d9"
  text-muted: "#8b949e"
  signal-green: "#26a641"
  signal-red: "#f85149"
  signal-amber: "#e3b341"
  signal-pending: "#e6a817"
  border: "#30363d"
typography:
  body:
    fontFamily: "JetBrains Mono, SF Mono, Menlo, monospace"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "JetBrains Mono, SF Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0.08em"
  small:
    fontFamily: "JetBrains Mono, SF Mono, Menlo, monospace"
    fontSize: "14px"
    fontWeight: 400
rounded:
  none: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  panel:
    backgroundColor: "{colors.bg-panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.none}"
    padding: "12px"
  panel-header:
    backgroundColor: "{colors.bg-panel-header}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    padding: "4px 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.signal-amber}"
    rounded: "{rounded.none}"
    padding: "1px 6px"
---

# Design System: QuantDesk

## 1. Overview

**Creative North Star: "The Trading Terminal"**

QuantDesk reads like a broker's execution terminal, not a SaaS dashboard: dark, dense,
monospace, zero decoration. Every panel is bracketed like a console window (`[ TITLE ]`),
every pixel of border and color is load-bearing - nothing is there to look nice, only to
say something true. The aesthetic philosophy is precise, disciplined, quiet: the interface
gets out of the way of the data.

This system explicitly rejects the generic SaaS dashboard (gradient hero-metric cards,
glassmorphism, soft rounded cards-on-cards, uppercase tracked eyebrows) and the consumer
fintech app look (Robinhood-style playful color, celebratory micro-interactions, oversized
friendly type). This is a research tool, not a growth app.

**Key Characteristics:**
- Flat, dark, monospace-everywhere; body text and labels share one font family
- Zero border-radius; panels are rectangles with 1px borders, nothing rounded
- Color is reserved for signal (up/down/accent), never mood or decoration
- Bracket-and-caps labeling (`[ SCAN RESULTS ]`, `PAPER`, `JOURNAL`) instead of icons or imagery
- No shadows, no gradients, no card-on-card nesting

## 2. Colors

A near-black terminal palette where the only saturated colors are functional signals.

### Primary
- **Signal Amber** (#e3b341): the one accent color. Used for interactive/ghost-button
  text, active states, and highlighted values. Never used decoratively.

### Secondary
- **Signal Green** (#26a641): up-moves, positive P&L, bullish states.
- **Signal Red** (#f85149): down-moves, negative P&L, bearish states.
- **Signal Pending** (#e6a817): resting/unfilled limit orders - a distinct third state
  (not yet a position, not interactive chrome). Deliberately close to Signal Amber but
  not identical: keeps "pending" visually distinguishable from "active/interactive"
  without introducing an unrelated hue.

### Neutral
- **Terminal Black** (#0a0e14): page background (`--bg-base`).
- **Panel Black** (#0d1117): panel body background (`--bg-panel`), one step lighter than
  the page so panels read as distinct surfaces without a shadow.
- **Panel Header Gray** (#161b22): panel header strip background (`--bg-panel-header`).
- **Terminal Text** (#c9d1d9): primary text color, near-white but never pure white.
- **Muted Steel** (#8b949e): secondary text, labels, disabled/inactive states.
- **Hairline Border** (#30363d): the only structural divider - 1px, everywhere.

### Named Rules
**The Signal-Only Rule.** Green, red, and amber exist to carry meaning (direction, P&L
sign, interactivity). If a color doesn't map to one of those three meanings, it doesn't
belong on screen.

## 3. Typography

**Display Font:** none - there is no display/hero type role in this system.
**Body Font:** JetBrains Mono (fallback: SF Mono, Menlo, monospace)
**Label/Mono Font:** same as body - one font family, no pairing.

**Character:** A single monospace family carries every size in the system. The terminal
never switches fonts; hierarchy comes from size, letter-spacing, and case, not typeface.

### Hierarchy
- **Body** (400, 15px, 1.5 line-height): default reading size for tables, panel content, forms.
- **Small** (400, 14px): secondary UI text, form labels, compact table cells.
- **Label** (400, 12px, 0.08em letter-spacing): panel header titles, always shown in
  brackets and often uppercase (`[ SCAN RESULTS ]`); also used for nav links (`DASH`,
  `PAPER`, `JOURNAL`) in caps.

### Named Rules
**The One-Font Rule.** No second typeface, ever - not even for numerals or headings.
Monospace end to end is what makes this read as a terminal instead of a themed dashboard.

## 4. Elevation

Flat by default - no shadows anywhere in the system. Depth between page, panel, and panel
header is conveyed entirely through three near-black tonal steps (`--bg-base` →
`--bg-panel` → `--bg-panel-header`) plus a single 1px hairline border. There is no lifted
or floating state for any component; nothing hovers above the page.

### Named Rules
**The Flat-By-Default Rule.** No `box-shadow` on any component, ever. Tonal contrast and
1px borders are the only depth cues available. If a component needs to look "elevated,"
darken or lighten its background one step instead of adding a shadow.

## 5. Components

### Buttons
- **Shape:** square corners, no radius (0px) on every variant.
- **Ghost (default/only variant):** transparent background, 1px solid border
  (`var(--border)`), text in Signal Amber (#e3b341), padding `1px 6px`, monospace font at
  label size. This is the only button style in the system - there is no filled/primary
  button variant.
- **Hover / Focus:** border and text stay amber; disabled state switches cursor to `wait`
  or `not-allowed` rather than changing color, keeping the signal-only color rule intact.

### Panels (signature component)
- **Corner Style:** none - 0px radius throughout.
- **Background:** body `--bg-panel` (#0d1117), header strip `--bg-panel-header` (#161b22).
- **Shadow Strategy:** none; see Elevation.
- **Border:** 1px solid `--border` (#30363d) around the whole panel and under the header.
- **Header:** bracketed label in caps/label-case (`[ TITLE ]`), muted text color, optional
  `[?]` info tooltip and a right-aligned secondary label.
- **Internal Padding:** 12px body, 4px/12px header.
- **Empty state:** literal em-dash placeholder text (`— no data —`), never a blank void or
  illustration.

### Navigation
- **Style:** flat top strip, uppercase short labels (`DASH`, `PAPER`, `JOURNAL`, `RESEARCH`,
  `SESSION`, `SETTINGS`), monospace, no icons.
- **States:** active route distinguished by text color/weight, not by pill background or
  underline decoration.
- **Mobile:** collapses to a menu rather than reflowing labels; touch targets keep the
  same flat, bracket-driven visual language.

### Data cells / tables
- **Style:** dense fixed-width columns, right-aligned numerics, muted color for
  placeholder/zero values (`--`), Signal Green/Red only on values that are actually
  up/down.

## 6. Do's and Don'ts

### Do:
- **Do** keep every screen in JetBrains Mono - no second typeface, ever.
- **Do** use square corners (0px radius) on every surface and control.
- **Do** reserve Signal Green / Signal Red / Signal Amber strictly for direction, P&L
  sign, and interactivity - never for decoration or mood.
- **Do** convey depth with the three-step tonal ladder (base → panel → panel-header) and
  1px hairline borders only.
- **Do** label panels and empty states in the existing bracket/caps voice
  (`[ TITLE ]`, `— no data —`).
- **Do** keep the "research tool, not financial advice, results are hypothetical"
  disclaimer visible.

### Don't:
- **Don't** add gradient hero-metric cards, glassmorphism, or soft rounded cards-on-cards -
  named anti-references in PRODUCT.md.
- **Don't** build a consumer-fintech look (Robinhood-style playful color, celebration
  micro-interactions, oversized friendly type).
- **Don't** add `box-shadow` to any component - flat by default, no exceptions.
- **Don't** introduce a filled/primary button style; the ghost button is the only variant.
- **Don't** use color decoratively - if a hue doesn't map to up/down/accent, remove it.
- **Don't** add tiny uppercase tracked "eyebrow" labels or numbered section scaffolding
  (01/02/03) - not part of this system's vocabulary.
