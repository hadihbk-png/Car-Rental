# Table list

These are the 22 tables DriveEasy (car rental) used. Rename them for your domain: vehicle becomes room, desk, court or practitioner; branch becomes hotel, site or clinic.

All tables use UUID primary keys, `timestamptz` (UTC) times and integer minor-unit money.

## Auth (shape required by Better Auth)
| Table | Purpose |
|---|---|
| `users` | Account, email (lower-case check), `role` enum (`customer`, `admin`) defaulting to customer |
| `sessions` | Login sessions; cascade on user delete |
| `accounts` | Credential and provider links, password hash; cascade on user delete |
| `verifications` | Email or reset tokens |

## Customers
| Table | Purpose |
|---|---|
| `driver_profiles` | One per user: legal name, phone, date of birth, licence number, country and expiry, private licence file key. Checks: minimum age, licence not expired. |

## Locations and inventory
| Table | Purpose |
|---|---|
| `branches` | Unique `code` and `slug`, address, IANA `timezone`, opening hours, `is_active` |
| `vehicle_categories` | Name, slug, default deposit, sort order |
| `vehicles` | Branch, category, make, model, year, unique plate, unique VIN (17 chars), transmission, fuel, seats, doors, luggage, mileage, `vehicle_status` enum, public photo keys |
| `vehicle_features` | Feature catalogue (GPS, Bluetooth, and so on) |
| `vehicle_feature_map` | Many-to-many vehicle ↔ feature; composite unique |
| `maintenance_blocks` | Vehicle, `starts_at`, `ends_at`, generated `period tstzrange '[)'`, reason. Exclusion constraint plus cross-table trigger. |

## Pricing
| Table | Purpose |
|---|---|
| `pricing_rules` | Daily rate for a category or one vehicle, optionally a branch, date season, min/max days, priority, active flag |
| `one_way_fees` | Fee from one branch to another (unique pair) |
| `extras` | Child seat, GPS, extra driver, full insurance: per-day or per-rental price, optional cap, max quantity |

## Bookings and money
| Table | Purpose |
|---|---|
| `reservations` | Human reference (unique), user, vehicle, pick-up and return branch, `pickup_at`, `return_at`, generated `period`, `reservation_status`, `hold_expires_at`, idempotency key (unique per user), price snapshot (daily rate, days, rental, extras, fee, VAT, total, deposit), paid, refunded and cancellation-fee amounts. Exclusion constraint on active statuses. |
| `reservation_extras` | Snapshot of each chosen extra: quantity, unit price, line total; cascade on reservation delete |
| `payments` | Reservation, purpose (`RENTAL`, `MODIFICATION`, `RETURN_CHARGES`), provider id, amount, refunded amount, `payment_status`, idempotency key (unique) |
| `deposits` | Reservation, provider hold id, amount, captured amount, `deposit_status`, expiry |
| `payment_webhook_events` | Provider event id (unique), type, payload, processed time. Makes duplicate webhooks harmless. |

## Operations
| Table | Purpose |
|---|---|
| `rental_agreements` | One per reservation: who checked out and in, mileage and fuel level (eighths) at pick-up and return, actual return time, late, fuel and damage charges |
| `damage_reports` | Vehicle, optional reservation, stage (pick-up, return, other), severity, location, description, estimated cost, private image keys, resolved flag |
| `audit_logs` | Actor (set null on user delete), action, entity type and id, before/after JSON, request id |
