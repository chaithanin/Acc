# Design notes

An executive financial dashboard: the numbers carry the emphasis, and the
chrome recedes. Desktop-first, responsive, and deliberately light on animation.

## Direction: frosted glass on an aurora

The visual system follows the **Room Management** app's (`chaithanin/Room-management`,
`DESIGN.md`), itself modelled on the Cirrel admin template: translucent sheets
float over a soft field of colour instead of boxing the data in with borders.

* **The aurora** — four blurred pools of colour (blue, cyan, teal, amber), fixed
  behind the whole app (`.aurora` in `globals.css`, mounted once in the root
  layout so the sign-in page has it too).
* **Sheets** — a bright 1px top edge, a hairline rim and a soft drop shadow do
  the separating a border used to. Corners are generous: cards 22px, controls
  12px, pills full.
* **Floating sidebar** — a glass sheet inset 16px from the edges (256px, or an
  84px icon rail; the choice is remembered, desktop only), and a floating glass
  top bar. Below 1024px the sidebar is a drawer.
* **Sibling pages as pills** — Data and Settings are each ONE entry in the
  sidebar, and their pages are a strip of pills above whichever is open.
  Twenty sidebar entries do not fit in a laptop-height sheet; eleven do.
  Dashboards stay individual entries: they are the destinations.
* **One interactive colour**, blue. Teal means *income* and nothing else; it
  used to double as the active-navigation colour, which broke its own rule.
* Type: **Urbanist** for the UI, **Noto Sans Thai** behind it, **JetBrains Mono**
  for formulas and codes, all self-hosted through npm (nothing is fetched from
  Google at build time or by a visitor). Digits come from a different face, see
  below.

### Where this departs from the reference, and why

**The sheets are far more opaque.** The reference's data cards are 62% white.
Here they are 90% (light) and 86% (dark). The reference's own rule is that
legibility beats effect; its cards hold room statuses, these hold chart marks
whose contrast was validated against a plain surface, and the glass changes the
surface behind them from place to place. Measured against the worst point of
the aurora (both top pools overlapping), a 62% sheet takes five of the eight
mark colours below 3:1 and the muted text to exactly 4.50. The tiers are:

| Tier | Class | Light | Dark | Holds |
|---|---|---|---|---|
| Data | `.glass` | 90% white | 86% `26,29,36` | cards, tiles, tables |
| Chrome | `.glass-bar` | 64% | 60% | sidebar, top bar, pill strip: navigation only |
| Overlay | `.glass-pop` | 97% | 97% | menus, tooltips, dialogs, the open drawer |

The aurora itself is 60% (light) and 40% (dark) of the reference's strength.

**Digits are a different face.** Urbanist has no tabular figures. The file that
ships carries no `tnum` feature (measured: `1111111111` is 90px wide and
`0000000000` is 187px, with `font-variant-numeric: tabular-nums` on), so a
column of amounts does not line up. The reference's DESIGN.md says "Urbanist
with tabular numerals"; that does not hold for the shipped file. Digits and the
separators `, . % + - −` come from a 3 kB subset of **Manrope** (SIL OFL,
`src/app/fonts/OFL-Manrope.txt`) declared with a `unicode-range`, so it is first
in the stack and everything else falls through to Urbanist. Every figure is
tabular by default (`body`), and `.pnum` opts a hero figure out.

Re-cut it with fontTools if the face ever changes:
`pyftsubset manrope-latin-wght-normal.woff2 --unicodes='U+0030-0039,U+002C,U+002E,U+0025,U+002B,U+002D,U+2212' --layout-features='tnum,pnum,lnum' --flavor=woff2`

### Contrast on glass

Computed, not eyeballed: each foreground composited against the sheet over the
worst point of the aurora (the two top pools overlapping), light and dark.

```
data tier   light  every text colour >= 4.5   worst: muted 5.82, accent 5.44
                   marks >= 3, except series-3   2.66  (was 2.74 on plain; see below)
            dark   every text colour >= 4.5   worst: delta-up 4.88
                   every mark >= 3            worst: critical 3.41
```

The rule that follows: **text with no sheet behind it (the page heading and its
description sit straight on the aurora) is ink or ink-secondary, never muted or
accent.** On bare aurora, light mode, muted is 3.34 and accent 3.13. Anything
tinted that can float on the page — badges, banners, selected states — is laid
over a near-white base (`.tint` over `bg-field`) rather than being a see-through
wash of its own colour.

The status colours have **text-weight** twins, `--good-ink`, `--warning-ink`,
`--critical-ink` (4.5:1 on the worst point). The mark-weight colours were being
used for words, which gave pale amber on a pale amber tint.

## Tokens

Colours are declared once as roles in `src/app/globals.css` and consumed by
name, so light and dark swap in one place and no component holds a hex value.

Dark mode is a *selected* palette, not an inverted one: its steps were chosen
for the dark surface. It is defined under both `prefers-color-scheme: dark` and
`[data-theme="dark"]`, so the OS setting and the in-app toggle both work, and
the toggle wins in either direction.

## Financial dashboard accents

The brief asks for teal on income, coral on expense and gold on the cash line.
Those are roles, not slots, and they sit on glass cards over the aurora. (The
original brief also asked for a dark sidebar; the Room Management direction
replaced it with a floating glass one, and with it the teal that used to mark
the active navigation entry, so teal now means income and only income.)

| Role | Light | Dark |
|---|---|---|
| Income / positive | `#0d9488` | `#12a897` |
| Expense / negative | `#e5484d` | `#e5535a` |
| Cash line | `#b07c0a` | `#bd8a18` |

Validated against the plain surfaces these colours were chosen on (`#ffffff` light,
`#1e1e1d` dark); the same pairs checked against the glass are in "Contrast on
glass" above
on the pairs that genuinely co-occur — teal and coral share the income/expense
chart, while gold is the lone series on the cash chart:

```
teal + coral  light  CVD ΔE 11.6 · normal ΔE 29.5 · contrast ≥ 3:1   ALL PASS
teal + coral  dark   CVD ΔE  9.3 · normal ΔE 29.3 · contrast ≥ 3:1   ALL PASS
gold alone    light  in band · contrast ≥ 3:1                        ALL PASS
gold alone    dark   in band · contrast ≥ 3:1                        ALL PASS
```

Gold and coral fail an all-pairs run together, which is why they are kept on
separate charts rather than re-stepped: the constraint is real, so the layout
respects it instead of overriding the check.

The net-profit line on the combo chart is drawn in ink rather than a fourth
hue, because it is derived from the two bars rather than a peer of them.
Movement on a KPI tile carries an arrow as well as a colour, so direction never
rests on hue alone.

## Chart palette

Three categorical slots are enough — no chart in the product carries more than
two series, and colour never encodes rank.

| Slot | Light | Dark |
|---|---|---|
| 1 | `#2a78d6` | `#3987e5` |
| 2 | `#eb6834` | `#d95926` |
| 3 | `#1baf7a` | `#199e70` |

Status colours are reserved and never reused as a series:
good `#0ca30c`, warning `#fab219`, serious `#ec835a`, critical `#d03b3b`.

### Validation record

Checked with the data-viz validator rather than by eye, all pairs, against the
plain surfaces (`#fcfcfb` light, `#1a1a19` dark). The colours are unchanged by
the glass redesign, so the pairwise results below stand; only the *contrast to
the surface* moved, and that is re-measured above:

```
light  lightness band PASS · chroma floor PASS
       CVD separation PASS  worst all-pairs ΔE 9.2 (deutan)
       normal-vision  PASS  worst all-pairs ΔE 24.0
       contrast       WARN  #1baf7a at 2.74:1

dark   lightness band PASS · chroma floor PASS
       CVD separation PASS  worst all-pairs ΔE 9.4 (deutan)
       normal-vision  PASS  worst all-pairs ΔE 20.9
       contrast       PASS  all ≥ 3:1
```

The light-mode contrast warning on slot 3 obligates relief. Every chart in the
product is paired with the same figures as a data table — required by
requirement 22 independently — so that obligation is met on every page.

## Rules the charts follow

* **No dual axes.** Two measures of different scale get two charts. Where two
  series share one chart they are both amounts in baht, on one scale.
* **Colour follows the entity, not its rank.** Filtering never repaints the
  survivors.
* **One measure across nominal categories gets one colour.** Colouring bars by
  magnitude would double-encode what the bar length already says.
* **Thin marks, hairline grids.** Solid, never dashed — a dashed grid reads as
  a threshold.
* **A legend for two or more series, none for one** (the title names it), and
  direct labels used selectively rather than a number on every point.
* **Status never travels by colour alone.** Every shortfall, warning and pass
  badge carries an icon and a word.

The one two-segment donut — received against outstanding — earns its place
because the centre figure is the actual reading: it is a collection-rate gauge,
not a comparison of two categories.

## Numbers

`฿12,450,000` in full, `฿337.61M` in millions, `฿12.5K` in thousands, and
negatives in accounting parentheses: `(฿12.50M)`. A missing value renders as an
em dash, never as zero — "no data" and "zero" are different facts. Table columns
use tabular figures so they align; standalone hero numbers do not.
