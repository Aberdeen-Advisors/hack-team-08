# Path to pilot

What it takes to run AppWise Insights against a real client estate rather than a sample.

---

## Target user and workflow

Not "the CIO" in the abstract. The buyer is the CIO; the **user** is the IT Portfolio or Vendor
Management lead who owns the **quarterly application portfolio review**.

Today that workflow is: pull exports from ServiceNow APM, the SAM tool and the SaaS management
platform → hand-merge in Excel → email business owners chasing criticality ratings → argue in a
steering committee about what is safe to cut → six to ten weeks to a list that is already stale and
that nobody can fully defend.

AppWise Insights compresses the analysis to an afternoon and makes the output auditable: every
recommendation carries its inputs, so the conversation moves from "why is my system on this list" to
"here is the evidence, and here is what would change it".

---

## Pilot scope

One business unit or one capability domain, 60–120 applications, 8 weeks.

Narrow beats broad. A capability domain (say, all of Collaboration and Customer Service) produces a
real consolidation decision inside the pilot window. A thin slice across all 800 produces
observations nobody acts on.

| Week | Activity |
|---|---|
| 1–2 | Source system access, first export, column mapping, data quality baseline |
| 3 | Calibrate the vendor pack and the four savings ratios against the client's own migration history |
| 4–5 | Replace inferred dependencies with observed integration data |
| 6 | Business owner validation of criticality and capability coverage on the top 30 by spend |
| 7 | Steering committee: recommendations, scenario modelling live in the room |
| 8 | Executed decision on one consolidation group; measure against baseline |

---

## Data requirements

### Minimum to run

Application name, annual cost, business criticality. The tool runs on three columns and reports
degraded confidence, which is the point — it produces a result on day one instead of after a
six-month data-collection project.

### To make the output decision-grade

| Source system | What it provides | Replaces |
|---|---|---|
| ServiceNow APM / CMDB | Application register, ownership, criticality, CI relationships | Inferred dependency graph |
| Flexera / Snow / SAM tool | Entitlements, installs, true-up exposure | Licence counts |
| Okta / Entra ID | SSO grants and last-login per application per user | `active_users_90d`, and shadow discovery |
| SaaS management (Zylo, Productiv) | Subscription inventory, departmental spend | SaaS population, shadow IT |
| Procurement / CLM (Ironclad, Coupa) | Contract dates, notice periods, termination terms | Contract timing |
| API gateway / iPaaS logs | Observed integration traffic | Inferred dependency graph |
| GRC / vulnerability management | Actual open findings, actual compliance scope | Inferred risk components |
| CASB / proxy logs | Unsanctioned AI and SaaS usage | Inferred shadow AI |

The order matters. **SSO last-login and contract dates are the two highest-value additions** — the
first converts adoption from an estimate to a measurement, the second converts savings from
theoretical to bankable.

---

## Risks

| Risk | Why it bites | Mitigation |
|---|---|---|
| **Inferred dependencies are wrong in a way that matters** | A retirement recommendation for an application that quietly feeds month-end close | Guardrails already block high-blast-radius retirement. Replace inference with CMDB and gateway data before any decision is executed. Nothing is executed on inference alone. |
| **Business owners dispute criticality** | Every owner rates their system Mission Critical; the guardrail then protects everything | Calibrate criticality against observed usage and dependency centrality, not self-assessment. Show owners the evidence for the rating. |
| **Savings ratios don't hold** | 86% consolidation recovery is an assumption; if real recovery is 60%, the plan misses | Calibrate in week 3 against the client's last three migrations. Report the sensitivity explicitly. |
| **Contract data is incomplete or wrong** | Savings land in the wrong quarter; a notice window is missed | Treat CLM extract as a week 1–2 blocker, not a nice-to-have. The 90-day notice alert is the highest-value early output regardless of the rest. |
| **Consolidation stalls in politics** | The survivor belongs to a business unit that didn't fund it | Sequence the roadmap so wave one is licence reclamation and zero-usage retirement — no migration, no owner negotiation, fast credibility. |
| **The 15% is hit on paper and missed in cash** | Licences reclaimed but the contract still bills | Track realised vs. identified separately from the first month. Only reduced invoices count. |

---

## Success measures

| Measure | Baseline | Pilot target |
|---|---|---|
| Time to a defensible rationalization list | 6–10 weeks | < 5 days |
| Run-rate spend removed in the pilot domain | — | ≥ 12% |
| Realised vs. identified savings | not tracked | ≥ 70% within two quarters |
| Critical incidents caused by a rationalization action | — | **zero** (the binding constraint) |
| Applications with an accountable named owner | typically 60–70% | > 95% |
| Auto-renewals missed | typically several per year | zero |
| Shadow AI brought under governance | unknown | 100% identified, ≥ 50% resolved |

The fourth row is the one that matters. Cost reduction is easy to claim and easy to reverse; a
programme that causes an outage loses the mandate permanently.

---

## Aberdeen Labs reusability

- **The engine is client-agnostic.** Three required columns, alias-based column mapping, everything
  else optional and defaulted. It runs against any client's export on day one.
- **The vendor intelligence pack is the compounding asset.** Every engagement extends it, and it is
  the part a client cannot build themselves.
- **The calibrated ratios are the second compounding asset.** After several engagements, Aberdeen
  holds real migration-recovery benchmarks by capability and vendor — which is a defensible reason to
  be in the room.
- **Delivery model.** Runs as an accelerator inside a cost-optimisation or post-merger integration
  engagement, where the estate has just doubled and the overlap question is urgent and unavoidable.
- **Single file, no infrastructure.** No client security review of a hosted platform, no data leaving
  the client environment, no procurement cycle. It opens in a browser in a workshop.
