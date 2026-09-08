# Design System

TRACE should look like **premium European enterprise software** — credible to a CFO,
pleasant for a sustainability analyst. Sophisticated, calm, technical, trustworthy,
data-dense but readable. Environmentally conscious **without** looking like a green
marketing site.

## Anti-patterns (do not do)

- Generic SaaS purple; heavy gradients; gimmicky "AI" aesthetics (glows, sparkles).
- Cluttered dashboards; wall-to-wall cards; meaningless charts.
- Tiny text; low-contrast greys; dense tables with no hierarchy.
- Fake "AI is analysing…" theatre.

## Foundations

### Typography

- **Sans**: a precise grotesque — `Inter` as the safe default; evaluate `Söhne` /
  `Neue Haas Grotesk` / `ABC Diatype` for licensed distinctiveness later.
- **Mono**: `IBM Plex Mono` / `JetBrains Mono` for figures, IDs, factor values, hashes.
- Type scale (rem): 0.75 / 0.8125 / 0.875 / 1 / 1.125 / 1.375 / 1.75 / 2.25. Body 0.875–1.
- Tabular numerals everywhere numbers are compared. Generous line-height for data tables.

### Color

Restrained, meaningful, theme-aware (light + dark). Semantic tokens, not raw hex, in
components.

| Token | Role |
| --- | --- |
| `--surface`, `--surface-raised`, `--surface-sunken` | Backgrounds; off-white / near-black grounds. |
| `--border-subtle`, `--border` | Hairline separators; structure over shadow. |
| `--text-primary`, `--text-secondary`, `--text-muted` | Hierarchy. |
| `--accent` | One confident accent (deep teal / slate-blue), used sparingly for primary action + active nav. |
| `--positive`, `--attention`, `--critical`, `--info` | Status only — never decoration. |
| Provenance palette | `measured` / `supplier_reported` / `calculated` / `estimated` / `modeled` / `inferred` each get a fixed, muted swatch used consistently in Evidence DNA, tables and badges. |
| Trust bands | 0–49 / 50–74 / 75–89 / 90–100 map to `critical` / `attention` / `info` / `positive`. |

Green is used **only** for genuine positive status, not as a brand wash.

### Space & layout

- 4px base grid; container max ~1440; comfortable 24–32px gutters.
- Whitespace is a feature. Prefer sectioning with space + hairline borders over boxes and
  shadows.
- Restrained motion: 120–200ms ease for state changes; no parallax, no bounce.

### Iconography

- One line-icon set (Lucide/Phosphor), 1.5px stroke, used consistently.

## Components (`@trace/ui`)

Built on Tailwind v4 + Radix primitives. Initial set: `Button`, `Input`, `Select`,
`Combobox`, `Checkbox`, `RadioGroup`, `Switch`, `Textarea`, `DatePicker` (EU format),
`Table` (sortable, sticky header, tabular nums, density toggle), `DataGrid`, `Badge`,
`StatusPill`, `ProvenanceTag`, `TrustScoreMeter`, `Card` (used sparingly), `Tabs`,
`Drawer`, `Dialog`, `Tooltip`, `Popover`, `Toast`, `EmptyState`, `Breadcrumbs`,
`PageHeader`, `Kbd`, `CodeInline`, `DefinitionList`, `Timeline`, `Stepper`,
`FileDropzone`, `SignedImage`.

Domain components: `EvidenceDnaPanel`, `LineageGraph` (React Flow), `TrustScoreBreakdown`,
`ScopeBreakdownBar`, `GapList`, `AuditReadinessGauge`, `SupplierPassportCard`,
`CandidateReview` (document + spans + form), `CarbonMap`, `ProcurementSimulator`.

## Signature UX patterns

### Evidence DNA

A panel invocable from any material number. Vertical lineage, top to bottom:

```
Scope 3 Category 1 — 2,206.76 tCO2e
 ├── Supplier:          XYZ GmbH
 ├── Activity:          1,283 t steel
 ├── Emission factor:   1.72 tCO2e / t   (source, version)
 ├── Method:            Supplier-specific
 ├── Evidence:          Supplier emissions report  [view]
 ├── Reporting period:  FY2026
 ├── Confidence:        94
 └── Verification:      Verified
```

Each row links to its record. The number is never shown without a path to this panel.

### TRACE Trust Score

`TrustScoreMeter` (0–100, banded color) + `TrustScoreBreakdown` (itemised additive
contributions + model version). Always explainable; never a bare number.

### Audit Simulation

Readiness gauge + three grouped lists (critical / warning / verified counts), every item a
link to the underlying object.

### Provenance, always visible

`ProvenanceTag` accompanies every material value in tables, detail views and exports. An
estimate is never styled the same as measured data.

## Dashboard (Command Center) UX

Answers four questions immediately, in this order:

1. **Where are we?** — overall readiness (one number + band).
2. **What's wrong?** — evidence / data-quality gaps (count + top items).
3. **What's important?** — emissions / risk hotspots (e.g. "18 suppliers = 41% of Scope 3").
4. **What should I do?** — a short, prioritised action list, each action a real task.

No metric on the Command Center is fabricated — every figure resolves to model data
(Principle 43, Phase 9).

## Accessibility

WCAG 2.2 AA: contrast, focus-visible rings, full keyboard paths, semantic landmarks, ARIA
on custom widgets, respects `prefers-reduced-motion`, no color-only status (icon/label
too).

## Localisation readiness

All copy through an i18n layer from Phase 1 (English first). EUR + `€` formatting, metric
units, `dd.MM.yyyy` dates, `1.234,56` number format configurable per org/locale.
