# AppWise Insights by Aberdeen Advisors

**An AI-powered application portfolio rationalization and optimization platform.**

A global company has 800 applications, dozens of SaaS subscriptions and a growing collection of AI
tools and agents with overlapping capabilities. The CIO must cut technology spend by 15% without
disrupting critical business operations. AppWise Insights takes the inventory export they already have,
infers what it doesn't contain, and produces a defensible action list.

Against the bundled sample: **$1.04B** of annual spend, a **15.0% reduction ($156.2M)** reached in 31 actions, **zero guardrail violations**.

---

## Run it

Open `index.html` in a browser. That's the whole instruction — no server, no install, no network.

To rebuild from source after changing the template or the data:

```bash
py tools/prepare_data.py && py tools/build_app.py && node tools/smoke_test.js
```

---

## The idea

Every portfolio tool on the market wants a rich inventory: cost, usage, risk ratings, dependency
maps, contract metadata, compliance scope. Nobody has one. The data-collection project becomes the
programme, and eighteen months later there are still no decisions.

AppWise Insights inverts that. It asks for the thin export you can actually produce — name, vendor,
category, cost, licences, criticality — and **infers the rest at ingest time**:

| Input (from your export) | Inferred by the engine |
|---|---|
| Application name, vendor, category | Risk score, with its component drivers |
| Annual cost, contract value | Open security findings |
| Licences acquired / assigned / active | Data classification and regulatory scope |
| Business criticality | Dependency graph and transitive blast radius |
| Contract dates | AI governance status, model provider, data egress |
| Capabilities covered | Capability overlap and the designated survivor |

Nothing inferred is presented as fact. Every derived number keeps the evidence that produced it, and
the asset drawer shows the full breakdown so a CIO can defend each line to a business owner.

---

## What it does

1. **Finds redundancy.** Groups applications by the capabilities they actually cover, designates one
   survivor per group on capability fit, adoption, risk and unit economics, then scores every other
   member on how much of its function the survivor already provides.
2. **Assesses cost, usage, risk and dependencies.** Four scored dimensions, each decomposed into
   named drivers rather than a black-box rating.
3. **Recommends Invest, Consolidate, Replace or Retire** for all 800 assets, with a rationale.
4. **Lands on the target without breaking anything.** The optimiser assesses the whole estate — all
   746 candidates, every time — ranks them on savings value, earliest action date and lowest
   disruption, then fills to the requested percentage rather than past it. Every integer target from
   5% to 35% lands within 0.00pp, subject to hard guardrails and to when each contract's notice
   window actually opens.
5. **Separates real savings from theoretical ones.** A saving you cannot reach until 2029 is
   reported as deferred, not counted toward this year's target.

### Guardrails

An asset is protected — and can never be auto-retired — if it is Mission Critical, supports a
revenue process, sits in SOX or GDPR scope with critical dependants, or has a blast radius of 12+
applications. 226 of the 800 assets are protected. The smoke test asserts zero violations across
every scenario in the sweep.

---

## Screens

| Group | Tab | Content |
|---|---|---|
| Overview | Executive summary | Five KPIs, an inline target stepper, top actions, clickable disposition mix |
| | Technology spend | Vendor search with per-vendor drill-down; a clickable idle-seat card that shows the applications behind the $480.8M |
| Analyze | Redundancy | Two-level capability filter, overlap groups, per-application reasoning |
| | AI & agents analysis | 99 AI assets split into tools and agents, duplicity scoring, capability comparison, inferred token usage |
| Act | Recommendations | Clickable disposition KPIs that filter the table; every asset with its rationale, saving and owner |
| | Savings scenarios | Live sliders for target, disruption tolerance and horizon |
| | Roadmap & renewals | Waves by quarter, notice deadlines inside 90 days |
| Data | Import | CSV/XLSX upload, scoring formulas, vendor intelligence pack |

Any row opens an asset drawer, which leads with risk and dependencies at a glance — risk score,
blast radius, disruption, guardrail status — then the full record, dependencies in both directions,
the value and risk breakdown bar by bar, and the recommendation with its reasoning.

---

## Bring your own data

Drag a `.csv` or `.xlsx` onto the Import tab. Columns are auto-mapped by alias, so
`Licenses in Use ( last 90 Days)`, `active users 90d` and `Active Users` all resolve to the same
field. Only three columns are genuinely required — application name, annual cost, business
criticality. Everything else is optional; missing fields are defaulted and reported rather than
rejected, because real inventory exports are always incomplete.

XLSX is parsed natively using `DecompressionStream('deflate-raw')` and `DOMParser` — no SheetJS, no
inlined 400 KB dependency, no network call. Files never leave the browser.

---

## Repository

```
index.html                     the built application - this is the deliverable
src/index.template.html        source template (engine + views)
src/fonts.css                  embedded Poppins faces, Aberdeen brand
data/portfolio_enriched.csv    800 assets, 20 columns
data/portfolio_enriched.xlsx   same, Excel-native
data/portfolio.json            packed payload inlined at build time
data/SCHEMA.md                 field dictionary and the input contract
tools/prepare_data.py          source workbook -> enriched dataset
tools/build_app.py             template + fonts + data -> index.html
tools/smoke_test.js            104 assertions over the engine and views, headless
docs/METHODOLOGY.md            scoring formulas, weights, guardrails
docs/PATH-TO-PILOT.md          what a real deployment requires
```

### Data provenance

The source workbook (`Hackathon Mock Data - Copilot.xlsx`, 600 rows × 13 columns) is used as
supplied. `tools/prepare_data.py` adds exactly three things agreed as in-scope — an application ID,
an asset type, and contract timing — plus per-application capability coverage, because in the source
every row inside a category carried identical capability tokens, which made the column a duplicate
of Category and useless for overlap detection. Risk and dependencies are deliberately **not** added
to the data; they are the tool's job.

The estate is then sized to **800** applications. The 600 source rows are carried through
unmodified — their subtotal, $753,330,500, is asserted by test — and the additional 200 are
synthesised by `extend_portfolio()` drawing on the source's own distributions: the category mix, the
vendors that genuinely appear in each category, the owner, department, criticality and contract-term
pools, and per-category cost and licence ranges. Additions invented from thin air would distort
every percentile the engine computes. Run `py tools/prepare_data.py --total 600` for the source
estate alone.

---

## Testing

`node tools/smoke_test.js` loads the built `index.html`, stubs a minimal DOM, and runs 104 assertions
against the engine — ingest integrity, score bounds, graph symmetry and **acyclicity**, guardrail
enforcement, optimiser constraint satisfaction, determinism across reruns — then sweeps six
scenarios checking the guardrails hold in each.

The acyclicity check is a regression guard. The first version of the dependency model let identity
depend on infrastructure and infrastructure depend on identity; every asset transitively reached
every other and blast radius degenerated to 600. Dependencies are now constrained to a strict
architecture layer ordering, giving a realistic long-tailed distribution (median 0, p90 4, max 380 —
a core identity platform genuinely does underpin most of the estate).

---

## Known limits

- Risk and dependency values are **inferences from heuristics plus a curated vendor pack**, not
  observed facts. They are good enough to rank and triage, not to sign a termination notice against.
  See `docs/PATH-TO-PILOT.md` for what replaces them.
- The vendor intelligence pack covers the 25 vendors in the sample and ships static.
- Token usage for AI assets is **inferred** from adoption and workload shape, not metered. Real
  figures come from vendor billing APIs; see `docs/PATH-TO-PILOT.md`.
- Savings ratios (86% recovery on consolidation, 28% on replacement, 60% of idle-seat cost) are
  planning assumptions, stated in `docs/METHODOLOGY.md` and adjustable in one place.
- No persistence, no accounts, no multi-tenancy — state lives in the page.
