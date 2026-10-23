# DriveEasy service API (from the Database Engine Agent)

All services are server-only. The first argument is the `Actor` from `requireUser()` / `requireAdmin()` (`@/lib/auth`). Inputs are Zod-validated: times accept a Date or an ISO string, and money is integer fils. Errors are `DomainError` from `@/lib/errors` (codes: UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, VALIDATION, CONFLICT, VEHICLE_UNAVAILABLE, INVALID_STATE, POLICY_VIOLATION, PAYMENT_FAILED, NO_PRICE). "admin" means the service throws FORBIDDEN for non-admins. Reads restricted to owner-or-admin return NOT_FOUND to other users. The source code is authoritative where it differs from this summary.

## Auth — `@/lib/auth`, `@/lib/auth/client`, `@/lib/auth/types`
- `getSession(): Promise<Actor|null>`, `requireUser()`, `requireAdmin()`, `requireUserOrRedirect(nextPath, role?)`.
- Client: `authClient`, `signIn.email({email,password})`, `signUp.email({name,email,password})`, `signOut()`, `useSession()`. Passwords must be at least 8 characters. The role cannot be set at sign-up.
- `Actor {id, email, name, role: "customer"|"admin"}`, `isAdmin(actor)`.

## Catalog and search (public, no actor)
- `@/lib/fleet/catalog`: `listBranches({includeInactive?})`, `getBranch(idOrSlugOrCode)`, `listCategories()`, `listFeatures()`, `listExtras({includeInactive?})`, `getVehicle(vehicleId)` → VehicleCard (photoUrls, depositFils).
- `@/lib/availability`:
  - `searchVehicles({pickupBranchId, returnBranchId?, pickupAt?, returnAt?, categoryId?|categorySlug?, transmission?, fuelType?, minSeats?, minDailyRateFils?, maxDailyRateFils?, sort?: "price_asc"|"price_desc"|"name"})` → `{vehicles (+dailyRateFils, rentalDays, rentalFils, estimatedTotalFils), rentalDays, oneWayFeeFils, timezone, datesApplied, priceRange}`.
  - `getAvailabilityCalendar({vehicleId, from?, days?: 1..180})` → `{timezone, from, to, busy[{start,end,kind}], days[{date, status: available|partial|unavailable}]}`.
  - `zonedTimeToUtc`, `localDate`. A client-safe copy is in `@/lib/availability/time`.
- `@/lib/pricing/quote`: `getQuote({vehicleId, pickupBranchId, returnBranchId?, pickupAt, returnAt, extras:[{extraId, quantity}]})` → `{dailyRateFils, rentalDays, rentalFils, extras[], extrasFils, oneWayFeeFils, subtotalFils, vatRateBps, taxFils, totalFils, depositFils, timezone, available}`. Pages display this; they never compute prices.

## Reservations — `@/lib/reservations`
- `createReservation(actor, {vehicleId, pickupBranchId, returnBranchId?, pickupAt, returnAt, extras:[{extraId, quantity}], idempotencyKey})` → ReservationView (PENDING, holdExpiresAt = +15 min).
  - Generate the idempotencyKey once per checkout and resend it on retry.
  - Throws VEHICLE_UNAVAILABLE when the vehicle is taken.
- `payReservation(actor, {reservationId, paymentMethod, idempotencyKey})` → ReservationView.
  - Holds the deposit, then charges. The reservation becomes CONFIRMED only when the payment succeeded and the deposit is held.
  - Requires a complete driver profile (POLICY_VIOLATION otherwise).
  - A decline throws PAYMENT_FAILED and the hold stays PENDING; retry with a NEW idempotencyKey.
  - Fake payment methods: `FAKE_PAYMENT_METHODS` from `@/lib/payments` (`fake_success` | `fake_decline` | `fake_pending`). With `fake_pending` the reservation stays PENDING and the webhook confirms it later.
- `getReservation(actor, idOrReference)` (owner/admin), `listMyReservations(actor)`.
- `cancelReservation(actor, {reservationId, reason?})`: free at least 48h before pick-up; within 48h, 1 day's rate + VAT is kept; never after pick-up. Ends CANCELLED or REFUNDED and releases the deposit. Show `view.cancellationPreview` before confirming.
- `modifyReservationDates(actor, {reservationId, pickupAt, returnAt, paymentMethod?, idempotencyKey})`: allowed until 48h before pick-up. A higher price needs a paymentMethod; a lower price is refunded automatically. Preview the new price with getQuote first.
- `getVoucher(actor, idOrReference)` → `{reservation, reference, qrPayload, qrSvg, qrDataUrl}` (CONFIRMED / PICKED_UP / RETURNED only).
- Admin:
  - `listReservations(actor, {status?, branchId?, vehicleId?, pickupFrom?, pickupTo?, q?, sort?, limit?, offset?})` → `{total, items}`.
  - `verifyVoucherPayload(actor, scanned)`.
  - `checkOutReservation(actor, {reservationId (id or reference), mileageKm, fuelLevel 0..8 eighths, notes?})` → PICKED_UP.
  - `checkInReservation(actor, {reservationId, mileageKm, fuelLevel, returnedAt?, returnBranchId?, notes?, damageChargeFils?, vehicleStatus?})` → view & `charges {lateDays, lateFeeFils, fuelEighthsShort, fuelChargeFils, damageChargeFils, taxFils, totalFils, depositCaptureFils, amountDueFils}`.
  - `settleReturnedDeposit(actor, reservationId)`.
- Damage (admin):
  - `createDamageReport(actor, {vehicleId, reservationId?, stage, severity, location, description, estimatedCostFils?})`.
  - `addDamageImage(actor, reportId, {data, contentType})`: jpeg/png/webp, 8MB or less.
  - `updateDamageReport`, `listDamageReports(actor, {vehicleId?, reservationId?, openOnly?})`, `getDamageReport` → imageUrls `/api/files/damage/<id>/<i>`.
- ReservationView fields:
  - Identity and status: `id`, `reference`, `status`, `paymentStatus`, `depositStatus`, `holdExpiresAt`.
  - Trip: `pickupAt`, `returnAt`, `timezone`, `vehicle`, `pickupBranch`, `returnBranch`.
  - `price {dailyRateFils, rentalDays, rentalFils, extras[], extrasFils, oneWayFeeFils, vatRateBps, taxFils, totalFils, depositFils}`.
  - Money: `paidFils`, `cancellationFeeFils`, `refundedFils`.
  - Timestamps: `confirmedAt`, `cancelledAt`, `createdAt`.
  - `can {pay, cancel, modifyDates, viewVoucher}`, `cancellationPreview`, `customer {id,name,email}`, `agreement|null`.

## Driver — `@/lib/drivers`
- `getMyDriverProfile(actor)`.
- `upsertDriverProfile(actor, {fullName, phone, dateOfBirth, nationality, licenceNumber, licenceCountry, licenceIssuedOn?, licenceExpiresOn})`: the driver must be 21 or older and the licence must not be expired.
- `uploadLicence(actor, {data, contentType})`: jpeg/png/webp/pdf, 5MB or less, content sniffed.
- `getDriverProfileForUser(actor, userId)` (admin or self).
- The view has `licenceFileUrl` (`/api/files/licences/<profileId>`, owner/admin only) and `complete`.

## Admin fleet — `@/lib/fleet/admin` (admin)
- Branches: `createBranch`, `updateBranch(actor, id, partial)`, `deleteBranch`. Deleting a branch in use throws CONFLICT; prefer `isActive: false`.
- `createCategory` / `updateCategory`, `createFeature`.
- Vehicles:
  - `listFleet(actor, {branchId?, categoryId?, status?, q?})`, `getFleetVehicle`.
  - `createVehicle` / `updateVehicle` (plate and VIN unique; status AVAILABLE|RESERVED|ON_RENT|MAINTENANCE|RETIRED).
  - `addVehiclePhoto` / `removeVehiclePhoto`.
- `createExtra` / `updateExtra`.
- Maintenance: `listMaintenanceBlocks`, `createMaintenanceBlock` (throws VEHICLE_UNAVAILABLE if it overlaps a booking; enforced by the database), `deleteMaintenanceBlock`.

## Admin pricing — `@/lib/pricing/admin` (admin)
- `listPricingRules`, `createPricingRule`, `updatePricingRule`, `deletePricingRule`.
- `listOneWayFees`, `upsertOneWayFee`, `deleteOneWayFee`.
- Rate selection picks the most specific matching rule, in this order: vehicle over category, branch-specific, dated season, priority, larger minDays.

## Routes (Database Engine)
- `/api/auth/*`.
- `POST /api/webhooks/payments`.
- `GET|POST /api/cron/release-expired-holds` (Bearer CRON_SECRET).
- `/api/files/public/<key>`, `/api/files/licences/[profileId]` (owner/admin), `/api/files/damage/[reportId]/[index]` (admin).
- Server actions that receive files pass `new Uint8Array(await file.arrayBuffer())` and `file.type`.
