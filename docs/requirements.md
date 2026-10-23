# DriveEasy requirements (from the product owner, verbatim)

Goal: Build a production-ready car rental web app and prepare it for deployment on Vercel.

## Technology
- Next.js with TypeScript and App Router
- Tailwind CSS
- Neon serverless PostgreSQL from Vercel Marketplace
- Drizzle ORM with migrations
- Secure authentication
- Vercel Functions for backend operations
- Vercel Blob for vehicle photos, driving-licence uploads and damage-report images
- Payment provider in test mode, supporting both charges and refundable security-deposit holds
- Never expose database or payment secrets in browser code

## Agent 1 - App Agent
- Build a polished responsive car-rental interface
- Create home, search results, vehicle details, branch, date selection, extras, checkout, pick-up voucher, my rentals, profile, login, and admin pages
- Let users search and filter vehicles by pick-up branch, return branch, dates and times, category, transmission, seats, fuel type, and price
- Show accurate vehicle availability for the chosen date range, with an availability calendar per vehicle
- Let users add extras such as child seat, GPS, additional driver, and full insurance cover
- Display daily rate, number of days, extras, one-way fee, taxes, security deposit, and final total before payment
- Collect driver details and driving-licence upload before confirming the rental
- Generate a digital pick-up voucher with reservation reference and QR code
- Allow users to view, modify dates, and cancel eligible reservations according to the cancellation policy
- Give admins screens to manage branches, fleet, pricing, reservations, check-out, check-in, and damage reports
- Connect every screen to the real database
- Do not use permanent mock data or placeholder buttons
- Optimize the application for desktop and mobile

## Agent 2 - Database Engine Agent
Use Neon PostgreSQL and create migrations for: users, driver_profiles, branches, vehicle_categories, vehicles, vehicle_features, vehicle_feature_map, pricing_rules, extras, reservations, reservation_extras, payments, deposits, rental_agreements, damage_reports, maintenance_blocks, audit_logs

### Database Rules
- Use UUID primary keys
- Store all timestamps in UTC; display them in the branch's local time zone
- Store money as integer minor units (fils for AED), never floating-point values
- Add foreign keys, validation constraints, indexes, and appropriate cascade rules
- Create unique constraints for vehicle plate numbers, VINs, and branch codes
- Store each rental period as a time range and use a PostgreSQL exclusion constraint so the same vehicle can never have two overlapping active reservations or maintenance blocks
- Store vehicle status as AVAILABLE, RESERVED, ON_RENT, MAINTENANCE, or RETIRED
- Store reservation status as PENDING, CONFIRMED, PICKED_UP, RETURNED, CANCELLED, EXPIRED, or REFUNDED
- Store payment status and deposit status separately from reservation status
- Record mileage and fuel level at pick-up and return in the rental agreement

### Reservation Transaction
1. Begin a database transaction
2. Lock the requested vehicle record
3. Confirm the vehicle has no overlapping reservation or maintenance block for the requested period
4. Create a temporary hold with an expiration time
5. Calculate the rental price, extras, fees, taxes, and deposit on the server
6. Create the pending reservation
7. Commit the transaction
8. Confirm the reservation only after verified payment and deposit authorisation
9. Use payment idempotency keys so retries cannot create duplicate reservations
10. Reject the reservation if the vehicle is no longer available for the selected period

Create a secure server-side endpoint for releasing expired holds. Make the operation idempotent so repeated runs are safe. If using Vercel Cron, protect the route with CRON_SECRET.

Add seed data containing sample branches, vehicle categories, vehicles, extras, pricing rules, and future reservations.

## Agent 3 - QA Agent
- Test registration, login, logout, and authorization
- Test vehicle search, branch selection, date ranges, filters, and availability calendars
- Test complete rentals from search through payment, pick-up voucher, check-out, and return
- Attempt to reserve the same vehicle for overlapping dates from two sessions at the same time; confirm only one reservation succeeds
- Test back-to-back rentals where one ends exactly when the next begins
- Test expired holds and automatic release
- Verify daily rates, extras, one-way fees, taxes, late-return charges, and deposit amounts
- Test payment success, failure, cancellation, retry, refund, deposit release, and duplicate webhook delivery
- Confirm users cannot access another user's reservations, vouchers, or licence uploads
- Test admin permissions for fleet, pricing, check-in, and damage reports
- Test database migrations on a clean database
- Test Vercel preview and production builds
- Test desktop and mobile layouts
- Report every bug to the responsible agent and retest each fix

## Deployment Requirements
- Deploy the Next.js application to Vercel
- Provision Neon PostgreSQL through Vercel Marketplace
- Use pooled DATABASE_URL for application requests
- Keep migration credentials and production secrets server-side
- Configure separate preview and production environments
- Run migrations safely during deployment
- Configure payment webhook secrets
- Protect scheduled cleanup endpoints
- Keep licence uploads private and serve them only to the owner and admins
- Add error handling, loading states, empty states, and structured server logs
- Create a README containing local setup, environment variables, migrations, testing, and Vercel deployment instructions

## Owner constraint (overrides the above for now)
Everything runs locally. Do not create or log in to any cloud account (Vercel, Neon, Stripe, Blob). Build and test against local PostgreSQL, the private local uploads folder and the fake payment provider. Write the cloud adapters (Neon via pooled URL, Vercel Blob, a real test-mode payment provider) so they switch on by settings alone, but do not deploy. The owner will supply cloud links later.
