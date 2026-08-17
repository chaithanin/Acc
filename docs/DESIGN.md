# Design notes

An executive financial dashboard: quiet chrome, generous spacing, and the
numbers carrying the emphasis. Desktop-first, responsive, and deliberately
light on animation.

## Tokens

Colours are declared once as roles in `src/app/globals.css` and consumed by
name, so light and dark swap in one place and no component holds a hex value.

Dark mode is a *selected* palette, not an inverted one: its steps were chosen
for the dark surface. It is defined under both `prefers-color-scheme: dark` and
`[data-theme="dark"]`, so the OS setting and the in-app toggle both work, and
the toggle wins in either direction.

## Financial dashboard accents

The brief asks for teal on income, coral on expense and gold on the cash line.
Those are roles, not slots, and they sit on white cards over a pale grey plane
with a dark sidebar.

| Role | Light | Dark |
|---|---|---|
| Income / positive | `#0d9488` | `#12a897` |
| Expense / negative | `#e5484d` | `#e5535a` |
| Cash line | `#b07c0a` | `#bd8a18` |

Validated against the surfaces actually used (`#ffffff` light, `#1e1e1d` dark)
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
surfaces actually used (`#fcfcfb` light, `#1a1a19` dark):

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
