# Team contract template (`docs/architecture.md`)

Copy this into the new project and fill in the blanks before starting the agents. Every agent reads it first, and nobody silently diverges from it.

## Ground rules
- Read the framework's bundled docs before writing framework code (versions change).
- Add packages only with the package manager. Report blocked build scripts to the lead instead of approving them yourself.
- Agents do not commit; the lead commits at phase boundaries.
- Stay in your owned paths. Need a change elsewhere? Ask through the lead.
- No cloud accounts and no deploys until the owner says so. No secrets in browser code; server modules import `server-only`.
- Never print `.env.local` values. Every new variable goes in `.env.example` with no value.

## Ports and databases
| Who | Port | Database |
|---|---|---|
| Lead (shared dev server) | 3000 | `<app>_dev` |
| Database Engine (tests) | none | `<app>_test` |
| QA (browser runs: build + start) | 3100 | `<app>_qa` (reset freely) |

## Ownership
| Area | Owner |
|---|---|
| Schema, migrations, seed, db scripts | Database Engine |
| Domain services `src/lib/<domain>/**`, errors, logging, audit | Database Engine |
| `src/app/api/**` (auth, webhooks, cron, private files), `vercel.json` | Database Engine |
| Pages and layouts (not `api/`), components, server actions, UI helpers | App |
| `tests/**`, `e2e/**`, test configs, `docs/test-plan.md`, `docs/bugs.md` | QA |
| README, this file, framework config, commits | Lead |

The App calls services only; it never writes SQL or calls payment or storage SDKs. Pages never compute prices.

## Domain decisions (fill in)
- Currency and minor unit:
- Tax rate and where it applies (usually not on deposits); round once, on the tax total:
- Time zone source (per location):
- Billing unit (days, nights, hours) and rounding; late-return grace:
- Hold length (for example, 15 minutes):
- Active statuses that block a resource:
- Cancellation policy and date-change window:
- Late, fuel or cleaning charges; who pays a balance above the deposit:
- Booking reference format; QR payload is signed:

## Platform decisions
- Database driver that supports interactive transactions and row locks
- Migrations: generated SQL plus hand-written constraints and triggers; deploy migrates with the unpooled URL
- Auth: email and password, role column, server helpers `getSession` / `requireUser` / `requireAdmin`; every service checks authorization itself
- Payments: interface plus fake provider plus a real test-mode adapter, chosen by a setting
- Files: interface plus local private folder plus cloud adapter; private files only through authorized routes
- Cron: GET with a Bearer secret; a local CLI runs the same job
- Logs: structured JSON; never log secrets or document numbers

## Milestones the engine reports
- (a) Schema migrated, seed runs, auth helpers usable, with import paths
- (b) All services done, with the full API written to `docs/service-api.md`
