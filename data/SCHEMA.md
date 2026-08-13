# Input schema

The contract between a client's inventory export and PortfolioIQ.

Three tiers. **Required** is the minimum to produce any output. **Recommended** unlocks the risk,
contract and dependency engines. **Optional** sharpens scoring. Missing columns are defaulted and
reported — never rejected — because real inventory exports are always incomplete.

Column matching is alias-based and case-insensitive, so `Licenses in Use ( last 90 Days)`,
`active users 90d` and `Active Users` all resolve to the same field.

---

## Tier 1 — Required

| Column | Type | Notes |
|---|---|---|
| `Application Name` | text | Display name |
| `Total Annual Cost` | number | The figure being reduced |
| `Business Criticality` | text | `Mission Critical` / `High` / `Medium` / `Low` |

Three columns is enough to run. Redundancy, risk and dependency analysis will be shallow, and the
tool says so.

## Tier 2 — Recommended

| Column | Type | Unlocks |
|---|---|---|
| `Application ID` | text | Dependency edges. Auto-generated as `APP-nnn` if absent |
| `Vendor` | text | Vendor intelligence pack, concentration risk, survivor selection |
| `Category` | text | Redundancy grouping, compliance and data-classification inference, architecture layer |
| `Licenses Acquired` | number | Utilisation, idle-seat waste |
| `Licenses in Use` | number | Assignment rate |
| `Licenses in Use ( last 90 Days)` | number | Real adoption, abandonment signal |
| `Contract End Date` | date | Earliest action date, roadmap waves, deferred savings |
| `Notice Period Days` | number | Notice-window alerts. Defaults to 90 |
| `Capabilities Covered` | text | Semicolon-delimited. Capability overlap % rather than all-or-nothing |

## Tier 3 — Optional

| Column | Type | Unlocks |
|---|---|---|
| `Asset Type` | text | AI/agent population split, spend composition |
| `Business Owner` | text | Named accountability on each action |
| `Dept Owner` | text | Departmental spend view, dependency affinity |
| `Total Contract Value` | number | Committed-spend exposure |
| `Contract Duration in Years` | number | Fallback contract-end estimate |
| `Contract Start Date` | date | Contract display |
| `Auto Renew` | TRUE/FALSE | 90-day notice-deadline alerts |
| `Business Capability` | text | Fallback when `Capabilities Covered` is absent |

---

## Not accepted as input — inferred by the tool

These are deliberately **not** in the schema. Clients do not have them, and waiting for them is why
rationalization programmes stall. PortfolioIQ derives them at ingest; see
[`../docs/METHODOLOGY.md`](../docs/METHODOLOGY.md).

Risk score and its drivers · open security findings · data classification · regulatory scope ·
revenue-process flag · dependency graph · blast radius · disruption score · AI governance status ·
model provider · data-egress flag · capability fit · overlap group and survivor · disposition ·
gross and net savings · earliest action date.

---

## Bundled sample

`portfolio_enriched.csv` / `.xlsx` — 600 applications, 20 columns, $753,330,500 annual spend.

Derived from `Hackathon Mock Data - Copilot.xlsx` (600 rows × 13 columns) by
`tools/prepare_data.py`, which adds exactly four things:

1. `Application ID` — required to express dependency edges
2. `Asset Type` — SaaS Subscription 471, AI Tool 60, Platform 29, Custom Application 22, AI Agent 18
3. Contract timing — `Contract Start Date`, `Contract End Date`, `Auto Renew`, `Notice Period Days`
4. `Capabilities Covered` — a per-application subset of its category's capabilities

Item 4 needs justifying. In the source file every row within a category carried identical capability
tokens — every CRM row read `Lead Management;Pipeline;Customer 360`. That makes the column a
duplicate of `Category` and useless for overlap detection: 38 applications appear perfectly
interchangeable, so the survivor decision collapses onto price. Assigning each application the subset
it actually covers turns overlap into a percentage and makes consolidation defensible.

All 13 original columns are preserved unchanged.
