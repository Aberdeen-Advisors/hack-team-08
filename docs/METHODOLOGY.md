# Methodology

Every number PortfolioIQ shows is reproducible from the formulas below. Nothing is a black box, and
nothing inferred is presented as observed. This document is the reference a CIO's team would
challenge line by line before acting.

---

## 1. Primitives

Computed directly from the inventory, no inference.

| Measure | Formula |
|---|---|
| `util` | active in 90 days ÷ licences acquired, clamped 0–1 |
| `assignUtil` | licences assigned ÷ licences acquired |
| `decay` | (assigned − active 90d) ÷ assigned — the abandonment signal |
| `unitCost` | annual cost ÷ licences acquired |
| `idleSeats` | max(0, acquired − active 90d) |
| `idleCost` | unitCost × idleSeats |
| `cpau` | annual cost ÷ active users (cost per active user) |

`decay` deserves a note: it separates "never deployed" from "deployed then abandoned". A product with
high assignment and low 90-day activity was rolled out and rejected by users — a different, and more
actionable, problem than one that was never provisioned.

---

## 2. Inference

The source inventory contains no risk, dependency, compliance or governance data. All of it is
derived here.

### 2.1 Vendor intelligence pack

Curated lifecycle and capability knowledge for the vendors present in the estate: lifecycle status
(Growth / Stable / Declining / At Risk / Key-Person Risk), a baseline security posture, the
categories where the vendor is a recognised leader, and the underlying model provider for AI
products. This is what lets the engine judge *which* product should survive an overlap group rather
than picking the cheapest. It ships static; a pilot refreshes it from vendor and analyst sources.

### 2.2 Compliance and data classification

Derived from category. Finance and ERP fall in SOX scope and carry Restricted data; HR, Legal, CRM
and Marketing fall in GDPR scope; Engineering, IT Operations and Collaboration are Internal. An
application is treated as revenue-bearing if its category supports a revenue process **and** its
criticality is High or above.

### 2.3 Open security findings

`vendor security posture + (Restricted data ? 1 : 0) + (decay > 0.5 ? 1 : 0) ± seeded variance`

Neglected applications accumulate findings — unpatched, unreviewed, unowned. The seeded variance is
deterministic per asset ID, so the result is stable across reruns.

### 2.4 AI governance

An AI asset is flagged **Shadow / Unsanctioned** if it sits outside the AI & Automation category
(procured by a department, never through architecture) or shows near-zero measured adoption. Data
egress is flagged where a non-Internal data classification meets a non-Approved governance status.

45 of the 78 AI assets in the sample are unsanctioned.

### 2.5 Dependency graph

Applications are assigned an architecture layer:

```
0 Cybersecurity   1 IT Operations   2 Data Platform
3 Collaboration, Engineering        4 ERP
5 AI & Automation, Analytics & BI
6 Finance, HR & Talent, Legal & Compliance, Industry Operations
7 CRM             8 Customer Service, Marketing, Sales Enablement
```

An application may only depend on a **strictly lower** layer. This guarantees the graph is acyclic
and encodes the real shape of an enterprise estate — identity and infrastructure at the bottom,
customer-facing systems at the edge.

Within the permitted upstream categories, the engine prefers platform-grade, well-adopted assets
owned by the same department, plus occasional same-vendor coupling. Selection is seeded per asset ID
and therefore deterministic.

**Blast radius** is the transitive count of applications that break if an asset is withdrawn. The
resulting distribution is long-tailed — median 0, p90 4, p99 252, max 380 — which is correct: most
applications are leaves, and a handful of identity platforms genuinely underpin the estate.

> An earlier version allowed identity to depend on infrastructure and infrastructure to depend on
> identity. Every asset then transitively reached every other and blast radius degenerated to 600 for
> all of them, silently disabling the guardrail that keys on it. `tools/smoke_test.js` now asserts
> acyclicity on every run.

---

## 3. Scores

### Value (0–100)

| Component | Max | Basis |
|---|---|---|
| Adoption | 26 | utilisation × 26 |
| User scale | 16 | log-normalised active users |
| Criticality | 28 | Mission Critical 28 / High 20 / Medium 11 / Low 4 |
| Dependency centrality | 18 | blast ÷ max blast × 18 |
| Vendor capability fit | 8 | vendor is a recognised leader in this category |
| Revenue-bearing | 6 | supports a revenue process |

### Risk (0–100)

| Component | Max | Basis |
|---|---|---|
| Vendor lifecycle | 34 | At Risk 34 / Key-Person 28 / Declining 24 / Stable 6 / Growth 0 |
| Open findings | 22 | 6 per finding, capped |
| Data sensitivity | 21 | Restricted 12 / Confidential 7 / Internal 3, ×1.7 on AI egress |
| AI governance | 22 | Shadow 22 / Under Review 10 / Pilot 5 / Approved 0 |
| Abandonment | 14 | decay × 14 |
| Vendor concentration | 6 | vendor holds >7% of total spend |

### Disruption (0–100)

Criticality (4–38) + blast radius (×28) + critical dependants (×3) + user scale (×18) + regulated (9)
+ revenue-bearing (6). This is the denominator the optimiser divides savings by.

---

## 4. Redundancy

Applications are grouped by capability coverage. Within each group the **survivor** maximises:

```
value × 0.9 − risk × 0.7 + (vendor capability fit ? 22 : 0)
      + capabilities covered × 3 − (cost per active user > $4,000 ? 8 : 0)
```

Capability fit is weighted heavily on purpose. A cheaper, better-adopted product that is not a
credible platform for the capability is not a survivor — it is the next migration.

Every other member's **overlap** is the share of its own capabilities the survivor already provides.
At 60%+ it becomes a consolidation candidate.

---

## 5. Disposition

Evaluated in order:

1. `risk ≥ 45 AND value ≥ 42` → **Replace** — the capability is needed, this product is not safe
2. duplicate (overlap ≥ 60%, not survivor) AND `value < 68` → **Consolidate**
3. `value < 34 AND util < 35%` AND not protected → **Retire**
4. duplicate → **Consolidate**
5. otherwise → **Invest** (retain and fund)

A protected asset that lands on Retire is promoted to Replace if its risk is high, otherwise Invest.
This is a hard rule, not a preference.

Sample result: Consolidate 333, Invest 147, Retire 71, Replace 49.

### Guardrails

Protected — never auto-retired:

- Mission Critical
- supports a revenue process
- in SOX/GDPR scope **and** has mission-critical dependants
- blast radius ≥ 12 applications

176 of 600 assets are protected in the sample.

---

## 6. Savings

| Disposition | Gross | Net |
|---|---|---|
| Retire | full annual cost | gross − exit cost |
| Consolidate | 86% of annual cost | gross − exit cost − migration cost |
| Replace | 28% of annual cost | gross − half migration cost |
| Invest | 60% of idle-seat cost | same (reclaimed at renewal, no migration) |

Consolidation recovers 86% rather than 100% because the surviving platform absorbs migrated seats.
Exit cost is 18% of annual cost for High/Mission Critical assets and 10% otherwise. Migration cost is
`active users × $95 + 4% of annual cost`.

**These four ratios are planning assumptions, not measurements.** They are the first thing to
calibrate against a client's actual migration history, and they live in one place in the source.

---

## 7. Optimiser

Greedy and explainable, not optimal. Candidates are ranked by `net saving ÷ max(6, disruption)` and
taken in order until the target is met, subject to:

- guardrails (when enforcement is on)
- disruption score ≤ tolerance
- the contract notice window opening inside the horizon

Anything whose window falls outside the horizon is reported as **deferred** — real savings,
contractually out of reach — rather than silently dropped. Anything blocked by a guardrail or the
tolerance is reported as **excluded**, with the reason.

A knapsack solver would find a marginally better set. It would also be impossible to defend in a
steering committee, which is the wrong trade for this decision.

### Verified behaviour

| Target | Horizon | Tolerance | Achieved | Savings | Actions | Guardrails |
|---|---|---|---|---|---|---|
| 10% | 12mo | 50 | 10.5% | $79.0M | 13 | held |
| 15% | 24mo | 62 | 15.0% | $113.1M | 20 | held |
| 20% | 24mo | 62 | 20.1% | $151.5M | 30 | held |
| 15% | 48mo | 62 | 15.1% | $113.5M | 18 | held |
| 25% | 48mo | 85 | 25.4% | $191.2M | 41 | held |
| 30% | 12mo | 40 | 30.0% | $226.1M | 90 | held |

Note the shape of the last row: a 30% target under a tight 12-month horizon and low disruption
tolerance is still reachable, but it takes 90 actions instead of 20 — the plan fragments into many
small, safe moves rather than a few large ones. That is the trade-off the sliders exist to expose.
