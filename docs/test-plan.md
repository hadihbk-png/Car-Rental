# DriveEasy test plan

Owner: QA Agent. Sources: [requirements.md](requirements.md) (Agent 3 list, plus every testable rule in the other sections) and [architecture.md](architecture.md) (binding domain and platform decisions). Bugs go to [bugs.md](bugs.md).

## Layers, commands, environments

| Layer | Code | Runner | Command | Database / server |
|---|---|---|---|---|
| Unit | U | Vitest project `unit` | `pnpm test` | None. Every DB URL is replaced with an unreachable address (guarded by `tests/unit/no-database.test.ts`) |
| Integration | I | Vitest project `integration`, serial | `pnpm test:integration` | `QA_DATABASE_URL` (driveeasy_qa). Global setup drops all schemas, recreates `public` and applies every migration in `drizzle/` |
| End-to-end | E | Playwright | `pnpm test:e2e` | `next build` + `next start` on port 3100 with `DATABASE_URL=QA_DATABASE_URL`. driveeasy_qa is reset, migrated and seeded first (`e2e/support/prepare-db.mts`) |

Playwright projects: `desktop-chromium`, `desktop-firefox`, `desktop-webkit` (1440x900), `mobile-webkit` (iPhone 13, 390x844), `mobile-chromium` (Pixel 7, 412x915). Functional flows run on `desktop-chromium` and `mobile-webkit` at minimum. Layout cases (LAY-*) run on all five projects.

Fixed test clock: the pricing, hold and cancellation cases pass `now` explicitly to services (or use `vi.setSystemTime`). Branch time zone is `Asia/Dubai` (UTC+4, no DST) unless a case says otherwise.

Harness pieces:
- `tests/support/qa-db.ts`: safety check (database name must end in `_qa`), schema reset, migrator, truncate, seed hook.
- `tests/support/db.ts`: `connect`, `query`, `race` (N separate connections released through a barrier), `raceCalls`, `pgErrorCode`.
- `tests/support/webhooks.ts`: signed fake-provider webhooks (valid, tampered, missing, stale), duplicates (sequential or concurrent). It can deliver over HTTP or straight into a route handler.
- `e2e/support/fixtures.ts`: `customer`, `otherCustomer` and `admin` fixtures, each in its own browser context. They sign up through Better Auth's `/api/auth/sign-up/email`; the admin is promoted in driveeasy_qa. Also a per-worker reset hook.

Notation: "1 day" = 24h. "D" = day. Money is in fils (1 AED = 100 fils). VAT = 5%.

---

## 1. Migrations, schema and constraints (MIG, SCH)

| ID | Layer | Preconditions | Steps | Expected |
|---|---|---|---|---|
| MIG-01 | I | Empty driveeasy_qa: no schemas, no btree_gist | Integration global setup applies all migrations | All migrations apply without error; `drizzle.__drizzle_migrations` has one row per journal entry |
| MIG-02 | I | After MIG-01 | Run the migrator a second time | No-op, no error, no duplicate rows (idempotent re-run) |
| MIG-03 | I | Clean DB | `pnpm db:migrate` with `DATABASE_URL_UNPOOLED`/`DATABASE_URL` overridden to QA | Same result as MIG-01 (the deploy path works too) |
| MIG-04 | I | Clean DB | Migrations install btree_gist themselves | `pg_extension` has btree_gist after migrating; nothing was pre-installed |
| SCH-01 | I | Migrated | Query `information_schema.tables` | All 17 required tables exist: users, driver_profiles, branches, vehicle_categories, vehicles, vehicle_features, vehicle_feature_map, pricing_rules, extras, reservations, reservation_extras, payments, deposits, rental_agreements, damage_reports, maintenance_blocks, audit_logs. Better Auth's sessions, accounts and verifications also exist |
| SCH-02 | I | Migrated | Inspect primary-key column types | Every PK is `uuid` |
| SCH-03 | I | Migrated | Inspect every timestamp column | All are `timestamptz` |
| SCH-04 | I | Migrated | Inspect money columns (rates, fees, totals, deposits, amounts) | All are integer types; no `numeric`/`real`/`double` money columns |
| SCH-05 | I | Migrated | Read the enum values | `vehicle_status` = AVAILABLE, RESERVED, ON_RENT, MAINTENANCE, RETIRED; `reservation_status` = PENDING, CONFIRMED, PICKED_UP, RETURNED, CANCELLED, EXPIRED, REFUNDED; payment and deposit status are separate enums/columns |
| SCH-06 | I | Migrated | Insert duplicates of a plate number, a VIN and a branch code | Each insert fails with 23505 (unique violation) |
| SCH-07 | I | Migrated | Insert invalid values: negative money, return before pickup, empty period, mileage-in > mileage-out, fuel level outside range | Rejected by CHECK constraints (23514) |
| SCH-08 | I | Migrated | Insert rows with dangling foreign keys; delete a parent row | FK violations raised (23503); cascade/restrict behaves as designed (deleting a vehicle with reservations is refused; deleting a reservation cascades to reservation_extras) |
| SCH-09 | I | Migrated | Check `reservations.period` and `maintenance_blocks.period` | Type is `tstzrange`; stored bounds are `[)` |
| SCH-10 | I | Migrated | Check indexes | Indexes exist on FK columns used in lookups and GiST indexes exist on (vehicle_id, period) |
| SCH-11 | I | Migrated | rental_agreements columns | Has pick-up and return mileage and fuel level |

## 2. Overlap guarantee, boundaries and concurrency (OVL, CON)

| ID | Layer | Preconditions | Steps | Expected |
|---|---|---|---|---|
| OVL-01 | I | One vehicle V, a CONFIRMED reservation [D1 10:00, D3 10:00) | Insert a CONFIRMED reservation for V [D2 10:00, D4 10:00) via raw SQL | Rejected by the exclusion constraint (23P01) |
| OVL-02 | I | As OVL-01 | Insert [D3 10:00, D5 10:00) (starts exactly when the first ends) | Accepted (back-to-back, `[)`) |
| OVL-03 | I | As OVL-01 | Insert [D0 10:00, D1 10:00) (ends exactly when the first starts) | Accepted |
| OVL-04 | I | As OVL-01 | Insert [D1 10:01, D1 11:00) (inside); also one that fully contains it | Both rejected |
| OVL-05 | I | As OVL-01 | Same period for a different vehicle | Accepted |
| OVL-06 | I | Reservation for V with each inactive status (CANCELLED, EXPIRED, RETURNED, REFUNDED) | Insert an overlapping CONFIRMED reservation | Accepted: inactive statuses never block |
| OVL-07 | I | PENDING reservation with `hold_expires_at` in the future | Insert an overlapping reservation | Rejected |
| OVL-08 | I | Two maintenance blocks for V | Overlapping second block | Rejected; a back-to-back block is accepted |
| OVL-09 | I | CONFIRMED reservation for V | Insert an overlapping maintenance block (raw SQL) | Rejected by the database (cross-table rule), not only by app code |
| OVL-10 | I | Maintenance block for V | Insert an overlapping CONFIRMED reservation (raw SQL) | Rejected by the database |
| OVL-11 | I | CANCELLED reservation overlapping a new block | Insert the block | Accepted |
| OVL-12 | I | CONFIRMED reservation | UPDATE its status CANCELLED -> CONFIRMED while another active reservation now overlaps | Rejected (the constraint also covers status changes and period updates) |
| OVL-13 | I | Two reservations, CANCELLED and CONFIRMED, overlapping | UPDATE the cancelled one back to an active status | Rejected |
| CON-01 | I | Vehicle V free; two customers | `raceCalls` fires 2 reservation-service calls for V with overlapping periods at the same instant (separate pool connections) | Exactly 1 PENDING reservation created; the other gets a typed "vehicle unavailable" error (not a 500 or a raw constraint error); 1 row in DB |
| CON-02 | I | As CON-01 | `race()` with two raw connections. Each runs BEGIN; SELECT ... FOR UPDATE on V; overlap check; INSERT; pg_sleep(0.2); COMMIT | Exactly 1 commit; the other blocks on the lock, then sees the conflict or fails with 23P01 |
| CON-03 | I | As CON-01 | Race 5 attempts, all overlapping | Exactly 1 succeeds |
| CON-04 | I | As CON-01 | Race 2 attempts for adjacent periods [D1,D3) and [D3,D5) | Both succeed |
| CON-05 | I | Hold H for V expired 1 minute ago (still PENDING) | Race 2 new overlapping attempts | The stale hold is expired inside the transaction; exactly 1 new attempt succeeds |
| CON-06 | I | CONFIRMED reservation R | Race "modify R's dates" against a new booking for the overlapping new dates | Exactly one wins; the loser keeps its original state |
| CON-07 | I | Maintenance block being created by an admin | Race it against a customer booking for the overlapping period | Exactly one succeeds |
| CON-08 | E | Vehicle V free; `customer` and `otherCustomer` (two browser contexts) both on checkout for V with overlapping dates | Click "Confirm/Pay" in both pages concurrently (`Promise.all`) | One reaches the voucher; the other sees a clear "no longer available" message and is not charged; the DB holds 1 active reservation |
| CON-09 | E | Both contexts on the same vehicle with back-to-back dates | Book both | Both succeed |

## 3. Reservation transaction and holds (RES, HLD)

| ID | Layer | Preconditions | Steps | Expected |
|---|---|---|---|---|
| RES-01 | I | Seeded branch, vehicle, extras | Call the reservation service with valid input | PENDING reservation; `hold_expires_at` = now + 15 min; price breakdown is stored and computed on the server; a short reference matching `DE-XXXXXX`; audit_logs row |
| RES-02 | I | As RES-01 | Submit a client-supplied total/price | Ignored; the stored total equals the server calculation |
| RES-03 | I | Vehicle with status RETIRED or MAINTENANCE | Reserve | Rejected |
| RES-04 | I | Return before pickup / zero length / pickup in the past | Reserve | Validation error; nothing written |
| RES-05 | I | Pickup branch or category inactive / unknown ids | Reserve | Validation error |
| RES-06 | I | Reservation fails midway (forced error after insert) | Inspect DB | Transaction rolled back: no reservation, extras, payment or audit rows |
| RES-07 | I | PENDING R, payment succeeded and deposit held (verified webhook) | Confirm | R becomes CONFIRMED only now; payment and deposit statuses are stored separately |
| RES-08 | I | PENDING R, payment succeeded but deposit failed | Process | R not CONFIRMED; the payment is refunded/voided per design; the user can retry |
| RES-09 | I | PENDING R whose hold expired before payment success arrived | Process payment.succeeded | R not confirmed if the vehicle was taken (payment refunded); if still free, re-check then confirm or reject per the documented rule. No double booking either way |
| RES-10 | I | Reference codes | Create 200 reservations | All references unique |
| HLD-01 | I | PENDING R, hold expired | Run the release job | R becomes EXPIRED; its payment is voided/cancelled and its deposit released; audit row written |
| HLD-02 | I | After HLD-01 | Run the release job again (and twice concurrently) | No changes, no errors, no duplicate provider calls or audit rows (idempotent) |
| HLD-03 | I | PENDING R, hold not yet expired | Run the job | R untouched |
| HLD-04 | I | PENDING R expired but not yet released by the job | Another user books an overlapping period | Booking succeeds (expired holds stop blocking immediately); R ends EXPIRED |
| HLD-05 | I | Hold expiry boundary | `now` == `hold_expires_at` | Defined behaviour: treated as expired (`<=`), consistent between job and booking check |
| HLD-06 | I | CONFIRMED / PICKED_UP reservations | Run the job | Untouched |
| HLD-07 | I | Cron route | GET `/api/cron/release-expired-holds` without a header / with the wrong bearer / with the right bearer | 401 / 401 / 200 with a JSON result. GET is supported (Vercel Cron) |
| HLD-08 | I | Local job | `pnpm jobs:release-holds` against QA | Same effect as HLD-01 |
| HLD-09 | E | Customer starts checkout, then waits (test clock / DB nudge sets `hold_expires_at` in the past) | Try to pay | Told the hold expired; not charged; can restart |

## 4. Pricing (PRC)

Pricing is a pure server function (U), checked again against stored reservations (I) and against what the UI shows (E). Expected values are computed by hand in the test, never by calling the code under test.

| ID | Layer | Preconditions | Steps | Expected |
|---|---|---|---|---|
| PRC-01 | U | Daily rate 20000 | Pickup 10:00 D1, return 10:00 D2 | 1 day; rental 20000 |
| PRC-02 | U | Same | Return 10:00 D4 | 3 days |
| PRC-03 | U | Same | Duration 30 minutes | Minimum 1 day |
| PRC-04 | U | Same | Booked return 10:59 D4 (72h59m) | 4 days. Booked days are ceil(duration/24h); the 59-minute grace applies only to late returns (architecture.md) |
| PRC-05 | U | Same | Booked return 11:00 D4 (73h00m) | 4 days |
| PRC-06 | U | Same | Return 11:00:01 D4 | 4 days |
| PRC-07 | U | Booking 3 days; actual return after the grace | Late-return charge | Extra day(s) charged at the applicable rate (plus VAT); recorded as RETURN_CHARGES |
| PRC-08 | U | Actual return 10:59 after the booked 10:00 (59 min late) | Late charge | 0; 60 min late is 1 extra day |
| PRC-09 | U | Actual return 2 days late | Late charge | 2 extra days |
| PRC-10 | U | Pricing rules (seasonal/weekend/length-of-rental, per category or vehicle) | Rental spans a rule boundary | Rule application matches the documented rule (precedence, per-day vs whole rental) |
| PRC-11 | U | Extras: PER_DAY child seat 2500 x qty 2; PER_RENTAL GPS 5000 | 3 days | Extras = 2500x2x3 + 5000 = 20000 |
| PRC-12 | U | Additional driver, full insurance | Selected | Priced per their pricing type; quantity limits respected |
| PRC-13 | U | Pickup branch A, return B with a one-way fee 15000; reverse direction | Price | One-way fee 15000 for A->B; the B->A fee as configured; same branch = 0 |
| PRC-14 | U | Rental 60000, extras 20000, one-way 15000 | VAT | Tax = round_half_up(0.05 x 95000) = 4750 |
| PRC-15 | U | Taxable 33330 | VAT | 5% = 1666.5, so 1667 (half-up, applied once on the total) |
| PRC-16 | U | Taxable lines 10010 + 10010 (0.5 fils each line) | VAT | round(1001.0) = 1001. Not the 1002 that per-line rounding would give |
| PRC-17 | U | Deposit 150000 | Totals | Deposit not taxed; shown separately; total payable now = rental + extras + one-way + VAT |
| PRC-18 | U | Any input | Outputs | All amounts are integers; no floats in the breakdown |
| PRC-19 | U | VAT configurable | Set the rate to 0% / 7.5% | Totals change accordingly |
| PRC-20 | U | Rental crosses the Dubai midnight / 24h from a UTC instant | Day count | Based on elapsed 24h periods, not calendar days or time-zone dates |
| PRC-21 | I | Reservation created | Compare stored breakdown columns | Equal to the pricing service output for the same input; sum of parts = total |
| PRC-22 | E | Checkout page | Read the displayed daily rate, days, extras, one-way fee, VAT, deposit, total | Each matches the stored reservation and `formatMoney` (AED, 2 decimals) |
| PRC-23 | U | `formatMoney` | 0, 1, 99, 100, 123456, negative | "AED 0.00", "AED 0.01", ... formatted consistently |

## 5. Cancellation and date changes (CXL, MOD)

| ID | Layer | Preconditions | Steps | Expected |
|---|---|---|---|---|
| CXL-01 | I | CONFIRMED, pickup in 48h + 1 min | Cancel | CANCELLED; full refund; deposit released; vehicle freed |
| CXL-02 | I | Pickup in exactly 48h | Cancel | Documented boundary (free at >= 48h); asserted explicitly |
| CXL-03 | I | Pickup in 47h59m | Cancel | CANCELLED; one day's charge (incl. its VAT per design) kept; the rest refunded; deposit released |
| CXL-04 | I | PICKED_UP / RETURNED / CANCELLED / EXPIRED | Cancel | Refused |
| CXL-05 | I | PENDING (unpaid hold) | Cancel | Hold cancelled, nothing charged |
| CXL-06 | I | Cancellation retried (double click / two requests) | Cancel twice concurrently | One refund only; idempotent |
| CXL-07 | I | Refund amounts | After the partial refund | Payment status partially_refunded; amounts in fils match; reservation status CANCELLED, or REFUNDED per the documented rule |
| MOD-01 | I | CONFIRMED, pickup > 48h away | Change dates to a free period | Re-priced on the server; difference charged (MODIFICATION payment) or refunded; period updated atomically |
| MOD-02 | I | Pickup within 48h | Change dates | Refused |
| MOD-03 | I | New dates overlap another reservation or block | Change | Refused; original dates untouched |
| MOD-04 | I | New dates overlap only its own current period | Change (extend by 1 day) | Allowed (no self-conflict) |
| MOD-05 | E | My rentals | Modify and cancel buttons | Shown only for eligible reservations; the server still enforces the rules (direct POST for an ineligible one fails) |

## 6. Payments, deposits and webhooks (PAY, WHK)

| ID | Layer | Preconditions | Steps | Expected |
|---|---|---|---|---|
| PAY-01 | I/E | PENDING R | Pay with `fake_success` | payment succeeded, deposit held, R CONFIRMED, voucher available |
| PAY-02 | I/E | PENDING R | Pay with `fake_decline` | payment failed; R stays PENDING (can retry until hold expiry); friendly error; no voucher |
| PAY-03 | I | `fake_pending` payment | Cancel the payment / user abandons | payment canceled; R not confirmed; hold expires normally |
| PAY-04 | I/E | Decline then retry with success | Retry | One successful payment; R CONFIRMED once |
| PAY-05 | I | Same idempotency key | Submit "pay" twice (sequentially and concurrently) | One provider payment, one deposit hold, one reservation; the second call returns the first result |
| PAY-06 | I | Network retry of the reserve call with the same idempotency key | Repeat | No duplicate reservation |
| PAY-07 | I | Cancelled reservation | Refund | Refund recorded; provider amountRefunded matches; payment status refunded/partially_refunded |
| PAY-08 | I | Returned rental, no damage | Close agreement | Deposit released (deposit.released), status released |
| PAY-09 | I | Returned rental with damage/late charge | Capture part of the deposit | captured amount = charge; remainder released; amounts recorded |
| PAY-10 | I | Capture more than held / refund more than paid | Attempt | Refused with a clear error; no state change |
| PAY-11 | U | `src/lib/payments` | Existing fake-provider unit tests | Pass (regression) |
| PAY-12 | static | Browser bundle | grep `.next/static` for secret env names/values (PAYMENT_WEBHOOK_SECRET, DATABASE_URL, CRON_SECRET, QR_SIGNING_SECRET, BETTER_AUTH_SECRET) | None present |
| WHK-01 | I | Valid signed `payment.succeeded` for R | Deliver once | 2xx; event stored by id; R updated |
| WHK-02 | I | As WHK-01 | Deliver the same event 3 times sequentially | All 2xx; one stored event; side effects applied once (one confirmation, one audit row, one email/log) |
| WHK-03 | I | As WHK-01 | Deliver 3 copies concurrently | Same as WHK-02 (no race on the event-id unique key) |
| WHK-04 | I | Any event | Tampered / missing / stale signature | 400/401; nothing stored or applied |
| WHK-05 | I | Events out of order (deposit.held before payment.succeeded, refunded before succeeded) | Deliver | Final state is correct; no illegal transition |
| WHK-06 | I | Unknown event type / unknown payment id | Deliver | 2xx (acknowledged) or a documented 4xx; no crash; logged |
| WHK-07 | E | Server started with `E2E_WEBHOOK_DUPLICATES=2` | Full checkout | Single confirmation; payment rows not duplicated |
| WHK-08 | I | Provider resend (`resendEvent`) after a 500 on first delivery | Resend | Processed once |

## 7. Authentication and authorization (AUTH, AZ)

| ID | Layer | Preconditions | Steps | Expected |
|---|---|---|---|---|
| AUTH-01 | E | None | Register through the UI | Account created with role `customer`; signed in; redirected |
| AUTH-02 | E | Existing email | Register again | Clear error; no second user |
| AUTH-03 | E | Weak/short password, invalid email | Register | Validation errors |
| AUTH-04 | E | Registered user | Log in through the UI | Signed in; the header shows the account |
| AUTH-05 | E | Wrong password / unknown email | Log in | Generic error; no user enumeration |
| AUTH-06 | E | Signed in | Log out | Session cookie cleared; protected pages redirect to login; the old cookie no longer works |
| AUTH-07 | E | Signed out | Visit /my-rentals, /profile, /checkout, /admin | Redirected to login (with return URL) |
| AUTH-08 | I/E | Registration payload with `role: "admin"` | Sign up via the API | Role stays `customer` (no mass assignment) |
| AUTH-09 | static | Cookies | Inspect the session cookie | HttpOnly, SameSite=Lax, Secure in production |
| AZ-01 | E | Customer A's reservation R | Customer B opens A's reservation detail, voucher and modify/cancel URLs by id/reference | 404/403; no data leaked |
| AZ-02 | E | A uploaded a licence | B requests A's licence file URL; signed-out user requests it | 403/404 |
| AZ-03 | E | As AZ-02 | A and an admin request it | 200, correct bytes; `Cache-Control: private`/no-store |
| AZ-04 | E/static | Licence, damage images | Check any HTML/JSON returned to the browser | No raw storage path or blob URL; files not under `public/`; direct GET `/storage/...` and `/uploads/...` return 404 |
| AZ-05 | E | Damage-report image | Customer (even the renter) requests it | 403 (admin only) |
| AZ-06 | E | Customer | Visit each /admin page | Redirect/403 |
| AZ-07 | I/E | Customer session | Call every admin server action / route directly (create/edit vehicle, pricing rule, branch, extras, maintenance block, check-out, check-in, damage report, reservation status) | 403; no DB change; no audit row |
| AZ-08 | I/E | Customer B session | Call cancel/modify/pay actions with A's reservation id | Refused; A's reservation untouched |
| AZ-09 | E | Admin | Fleet CRUD (add vehicle with unique plate and VIN, edit, retire) | Works; audit rows; a duplicate plate/VIN shows a friendly error |
| AZ-10 | E | Admin | Pricing CRUD (rates, rules, extras, one-way fees) | Saved; new searches/quotes use it; existing reservations keep their stored price |
| AZ-11 | E | Admin | Branch CRUD with a unique code and time zone | Works |
| AZ-12 | E | Admin | Maintenance block over an existing booking | Refused with an explanation |
| AZ-13 | E | Admin | Reservations list: filter/search, view any customer's reservation and licence | Works |
| AZ-14 | I | Admin actions | After each admin mutation | audit_logs row with actor, action, entity, before/after |
| AZ-15 | E | Voucher QR | Tamper with the QR payload / use another reservation's | Signature check fails at check-out; the QR does not contain raw ids |

## 8. Search, branches, dates, filters, availability (SRCH, CAL)

| ID | Layer | Preconditions | Steps | Expected |
|---|---|---|---|---|
| SRCH-01 | E | Seed data | Home: choose pickup branch, return branch, dates and times; search | Results page lists only vehicles available for the whole period, with the price for that period |
| SRCH-02 | I | V booked [D2, D4) | Search [D1, D3) / [D4, D6) / [D0, D2) | V excluded / included / included |
| SRCH-03 | I | V under maintenance [D2, D3) | Search overlapping | V excluded |
| SRCH-04 | I | V RETIRED | Any search | Excluded |
| SRCH-05 | I | Expired PENDING hold on V | Search overlapping | V included |
| SRCH-06 | E | Results | Filter by category, transmission, seats, fuel type, price range (each alone and combined) | Every result matches; counts change; filters reflected in the URL and survive reload |
| SRCH-07 | E | Filters exclude everything | Apply | Empty state with a way to reset |
| SRCH-08 | E | Invalid dates (return before pickup, past dates) | Search | Validation message; no server error |
| SRCH-09 | E | Times shown | Pickup in an `Asia/Dubai` branch | Times displayed in branch local time; stored UTC instants are correct (check DB) |
| SRCH-10 | E | Branch page | Open a branch | Address, opening hours, time zone, vehicles at the branch |
| SRCH-11 | E | Sort by price | Sort | Ordered correctly |
| CAL-01 | E | V booked [D2, D4), block [D6, D7) | Vehicle details availability calendar | D2-D3 and D6 shown unavailable; others available |
| CAL-02 | E | Booking ending 10:00 D4 | Calendar on D4 | D4 shown partially or fully available per the documented rule; booking from 10:00 D4 succeeds |
| CAL-03 | E | Choose dates on the calendar that span a blocked day | Continue | Prevented with a message |

## 9. Full rental flow (FLOW)

| ID | Layer | Preconditions | Steps | Expected |
|---|---|---|---|---|
| FLOW-01 | E | Seed data; fresh customer | Search, vehicle details, choose dates, extras (child seat x1, GPS, insurance), checkout (driver details + licence upload), pay `fake_success` | Voucher page with reference `DE-XXXXXX` and a QR; reservation CONFIRMED in DB; payment succeeded; deposit held; licence stored privately |
| FLOW-02 | E | After FLOW-01 | My rentals | Reservation listed with status, dates in branch time and the total |
| FLOW-03 | E | After FLOW-01 | Admin check-out: scan/enter reference, record mileage and fuel | Reservation PICKED_UP; vehicle ON_RENT; rental_agreement has out-mileage and fuel; audit row |
| FLOW-04 | E | After FLOW-03 | Admin check-in on time with in-mileage and fuel; no damage | RETURNED; vehicle AVAILABLE; deposit released; no extra charge |
| FLOW-05 | E | After FLOW-03 | Check-in 2h late with a damage report and photo | Late charge (1 extra day + VAT) and damage capture from the deposit; damage report visible to admin only |
| FLOW-06 | E | Checkout without a licence upload / without driver details | Submit | Blocked with validation messages |
| FLOW-07 | E | Licence upload with a wrong type or too large | Upload | Rejected |
| FLOW-08 | E | Back-to-back: R1 [D1 10:00, D3 10:00) booked | Book [D3 10:00, D5 10:00) for the same vehicle | Succeeds |
| FLOW-09 | E | Voucher | Print view / mobile view | Reference and QR readable; QR decodes to a signed payload |

## 10. Builds, layouts, non-functional (BLD, LAY, NFR)

| ID | Layer | Preconditions | Steps | Expected |
|---|---|---|---|---|
| BLD-01 | build | Clean checkout | `pnpm typecheck`, `pnpm lint` | Pass |
| BLD-02 | build | `NODE_ENV=production` | `pnpm build` (production settings), then `next start` used by e2e | Builds with no errors; e2e passes against it |
| BLD-03 | build | Simulated Vercel preview: `VERCEL_ENV=preview`, `VERCEL=1` | `pnpm build` | Builds; no cloud calls; env-dependent code uses preview settings |
| BLD-04 | build | Simulated production: `VERCEL_ENV=production` with cloud adapter env names set to dummy values (`PAYMENT_PROVIDER=stripe`, `STORAGE_DRIVER=vercel-blob`) | `pnpm build` | Builds; adapters selected by settings alone; no secret inlined in client chunks (PAY-12) |
| BLD-05 | build | Build without DB access (DATABASE_URL unreachable) | `pnpm build` | Either succeeds (no DB at build time) or fails clearly; documented |
| BLD-06 | static | `vercel.json` | Inspect | Cron schedule for release-expired-holds; the migration step runs before build using the unpooled URL |
| LAY-01 | E | All 5 projects | Every public page (home, results, vehicle, branch, login) | No horizontal overflow at the viewport; primary action visible without zoom |
| LAY-02 | E | mobile-webkit 390x844 | Navigation, filters (drawer/sheet), date picker, checkout form, voucher | Usable with touch; no clipped controls; tap targets of at least 40px |
| LAY-03 | E | desktop 1440x900 | Same pages | Multi-column layouts as designed; no stretched content |
| LAY-04 | E | Admin pages on mobile and desktop | Open the tables | Readable (scrollable tables or stacked cards); no page-level horizontal scroll |
| NFR-01 | E | Slow network / server action pending | Search and pay | Loading states shown; buttons disabled while submitting (no double submit) |
| NFR-02 | E | Server error injected (unknown id) | Visit the page | Friendly error/404 page; no stack trace |
| NFR-03 | I | Any API failure | Inspect server logs | Structured JSON with level, msg and requestId; no secrets, card or licence data logged |
| NFR-04 | static | Pages | grep for mock arrays / TODO buttons | No permanent mock data or placeholder buttons |

## Case counts

| Area | U | I | E | Build/static | Total |
|---|---|---|---|---|---|
| Migrations and schema (MIG, SCH) | 0 | 15 | 0 | 0 | 15 |
| Overlap and concurrency (OVL, CON) | 0 | 20 | 2 | 0 | 22 |
| Reservation and holds (RES, HLD) | 0 | 18 | 1 | 0 | 19 |
| Pricing (PRC) | 21 | 1 | 1 | 0 | 23 |
| Cancellation and modify (CXL, MOD) | 0 | 11 | 1 | 0 | 12 |
| Payments and webhooks (PAY, WHK) | 1 | 17 | 1 | 1 | 20 |
| Auth and authorization (AUTH, AZ) | 0 | 4 | 19 | 1 | 24 |
| Search and availability (SRCH, CAL) | 0 | 4 | 10 | 0 | 14 |
| Full flow (FLOW) | 0 | 0 | 9 | 0 | 9 |
| Builds, layout, NFR (BLD, LAY, NFR) | 0 | 1 | 6 | 7 | 14 |
| **Total** | **22** | **91** | **50** | **9** | **172** |

Cases marked I/E are counted once, under I (PAY-01, 02, 04; AUTH-08; AZ-07, 08). Counting them under E as well would add 6 there. Each E case runs on at least 2 browser projects, so the number of executed browser tests is higher.

## Concurrency test design

- **Database level (CON-02, CON-03):** `race()` in `tests/support/db.ts` opens N dedicated `pg.Client` connections, so each is a separate Postgres backend; the test asserts the `pg_backend_pid` values differ. A promise barrier starts all attempts in the same event-loop tick. Each attempt runs the same transaction the service uses: lock the vehicle, check overlap, insert, then `pg_sleep` before COMMIT to widen the window. Assert exactly one fulfilled; the losers fail with a lock-then-conflict result or `23P01`. Then count active rows for the vehicle (= 1).
- **Service level (CON-01, 05, 06, 07):** `raceCalls()` fires the real reservation service N times through the barrier. The app pool (`pg.Pool`, default max 10) gives each call its own connection. Assert one success, a typed domain error for the rest, and no 500-style errors.
- **Browser level (CON-08):** two fixtures (`customer`, `otherCustomer`) have separate `BrowserContext`s, so their cookies and sessions are separate. Both pages go to the same checkout; the test clicks pay in both via `Promise.all`. Assert one voucher and one unavailable message, then check the DB.
- Every concurrency test is repeated 10 times in a loop to catch flaky winners. Any run with 2 winners is a P1 bug.

## Idempotency and webhook design

- The same idempotency key is sent twice, sequentially and concurrently. Assertions: one provider payment (check the fake store), one reservation, one payments row.
- `sendFakeWebhook(event, { times: 3, concurrent: true })` replays the identical body and event id. Assertions: one `payment_webhook_events` row, one status transition, one audit entry. In integration tests the helper calls the route handler directly (`send: POST`); in e2e it calls `http://localhost:3100/api/webhooks/payments`.

## Retest policy

Every bug in bugs.md gets a regression test with the bug ID in the test name (e.g. `BUG-007: ...`). A fix is marked Verified only after that test passes in the relevant layer and the full suite is green.

## Phase B: where each case lives

| Area | Files | Notes |
|---|---|---|
| Unit (U) | `tests/unit/pricing.test.ts`, `tests/unit/time.test.ts`, `tests/unit/webhooks-helper.test.ts`, `tests/unit/no-database.test.ts` | PRC-01..20, CXL/MOD policy boundaries, rate-rule selection, time-zone helpers |
| MIG/SCH | `tests/integration/migrations.test.ts`, `tests/integration/seed.test.ts` | MIG-01..04, SCH-01..11, SEED-01 (`db:seed` twice = idempotent) |
| OVL | `tests/integration/overlap.test.ts` | raw SQL against the exclusion constraints and cross-table triggers |
| CON | `tests/integration/concurrency.test.ts` | each race x10; CON-02b proves the constraint alone stops a second insert |
| RES/HLD | `tests/integration/reservations.test.ts` | incl. cron GET/POST auth, `pnpm jobs:release-holds` |
| PRC (DB), FLOW (service), AZ-15 | `tests/integration/pricing-operations.test.ts` | stored price = quote = hand calculation; check-out/in, deposit capture/release; vouchers |
| CXL/MOD | `tests/integration/cancellation.test.ts` | 48h boundaries with an explicit `now` |
| PAY/WHK | `tests/integration/payments.test.ts` | signed webhooks via the real route handler; duplicates sequential and concurrent |
| AUTH/AZ | `tests/integration/authorization.test.ts` | Better Auth handler, private file routes, every admin-only service |
| SRCH/CAL | `tests/integration/search.test.ts` | |
| EDGE (exploratory) | `tests/integration/edge-cases.test.ts` | BUG-004..008 regressions |
| E2E public | `e2e/public/*.spec.ts`, `e2e/auth.spec.ts`, `e2e/layout.spec.ts`, `e2e/smoke.spec.ts` | all 5 browser projects |
| E2E flows | `e2e/booking.spec.ts`, `e2e/rentals.spec.ts`, `e2e/admin.spec.ts` | desktop-chromium + mobile-webkit; test data via `e2e/support/scenario.mts` (real services against driveeasy_qa) |

Rule clarification applied in phase B: booked rental days have no grace period (72h01m = 4 days); the 59-minute grace applies only to late returns (PRC-04 corrected).
