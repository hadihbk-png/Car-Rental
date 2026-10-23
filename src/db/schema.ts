// DriveEasy database schema (Drizzle). Generate SQL with `pnpm db:generate`.
//
// Conventions
// - UUID primary keys (gen_random_uuid()).
// - Every timestamp is timestamptz, stored in UTC. Branches carry an IANA time zone for display.
// - Money is integer minor units (fils, 1 AED = 100 fils). Never floats.
// - Rental / maintenance periods are stored as tstzrange '[)' (generated from start/end columns).
//   Overlap rules live in hand-written SQL (drizzle/0001_*.sql): btree_gist exclusion constraints
//   plus triggers for the reservation-vs-maintenance cross-table guarantee.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tstz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tstz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const pk = () => uuid("id").primaryKey().defaultRandom();

/** Read-only tstzrange column. The app reads the plain start/end columns instead. */
const tstzrange = customType<{ data: string; driverData: string }>({
  dataType: () => "tstzrange",
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const userRole = pgEnum("user_role", ["customer", "admin"]);
export const vehicleStatus = pgEnum("vehicle_status", [
  "AVAILABLE",
  "RESERVED",
  "ON_RENT",
  "MAINTENANCE",
  "RETIRED",
]);
export const reservationStatus = pgEnum("reservation_status", [
  "PENDING",
  "CONFIRMED",
  "PICKED_UP",
  "RETURNED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
]);
/** Mirrors PaymentStatus in src/lib/payments/types.ts. */
export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "succeeded",
  "failed",
  "canceled",
  "refunded",
  "partially_refunded",
]);
/** Mirrors DepositHoldStatus in src/lib/payments/types.ts, plus "pending" before the provider answers. */
export const depositStatus = pgEnum("deposit_status", ["pending", "held", "released", "captured", "failed"]);
export const paymentPurpose = pgEnum("payment_purpose", ["RENTAL", "MODIFICATION", "RETURN_CHARGES"]);
export const transmission = pgEnum("transmission", ["AUTOMATIC", "MANUAL"]);
export const fuelType = pgEnum("fuel_type", ["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]);
export const extraPricingType = pgEnum("extra_pricing_type", ["PER_DAY", "PER_RENTAL"]);
export const damageSeverity = pgEnum("damage_severity", ["MINOR", "MODERATE", "MAJOR"]);
export const damageStage = pgEnum("damage_stage", ["PICKUP", "RETURN", "OTHER"]);

export const ACTIVE_RESERVATION_STATUSES = ["PENDING", "CONFIRMED", "PICKED_UP"] as const;

// ---------------------------------------------------------------------------
// Better Auth tables (users / sessions / accounts / verifications)
// Property names are Better Auth's field names; columns are snake_case.
// ---------------------------------------------------------------------------
export const users = pgTable(
  "users",
  {
    id: pk(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: userRole("role").notNull().default("customer"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("users_email_lowercase", sql`${t.email} = lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: pk(),
    expiresAt: tstz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: pk(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tstz("access_token_expires_at"),
    refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("accounts_user_id_idx").on(t.userId),
    uniqueIndex("accounts_provider_account_uq").on(t.providerId, t.accountId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: pk(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export const driverProfiles = pgTable(
  "driver_profiles",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
    nationality: text("nationality").notNull(),
    licenceNumber: text("licence_number").notNull(),
    licenceCountry: text("licence_country").notNull(),
    licenceIssuedOn: date("licence_issued_on", { mode: "string" }),
    licenceExpiresOn: date("licence_expires_on", { mode: "string" }).notNull(),
    /** Private storage key. Never sent to the browser; served by /api/files/licences/[profileId]. */
    licenceFileKey: text("licence_file_key"),
    licenceFileContentType: text("licence_file_content_type"),
    licenceUploadedAt: tstz("licence_uploaded_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("driver_profiles_licence_dates", sql`${t.licenceExpiresOn} > ${t.dateOfBirth}`),
    check(
      "driver_profiles_licence_file_complete",
      sql`(${t.licenceFileKey} IS NULL) = (${t.licenceUploadedAt} IS NULL)`,
    ),
    check("driver_profiles_names_not_blank", sql`length(trim(${t.fullName})) > 0 AND length(trim(${t.licenceNumber})) > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Branches and fleet
// ---------------------------------------------------------------------------
export const branches = pgTable(
  "branches",
  {
    id: pk(),
    code: text("code").notNull().unique(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    address: text("address").notNull(),
    phone: text("phone"),
    email: text("email"),
    /** IANA time zone, e.g. Asia/Dubai. Times are shown in this zone. */
    timezone: text("timezone").notNull().default("Asia/Dubai"),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    openingHours: text("opening_hours"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("branches_code_format", sql`${t.code} ~ '^[A-Z0-9]{2,10}$'`),
    check("branches_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("branches_timezone_not_blank", sql`length(${t.timezone}) > 0`),
    check("branches_latitude_range", sql`${t.latitude} IS NULL OR ${t.latitude} BETWEEN -90 AND 90`),
    check("branches_longitude_range", sql`${t.longitude} IS NULL OR ${t.longitude} BETWEEN -180 AND 180`),
  ],
);

export const vehicleCategories = pgTable(
  "vehicle_categories",
  {
    id: pk(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    /** Refundable security deposit held for every rental in this category. */
    depositFils: integer("deposit_fils").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("vehicle_categories_deposit_nonneg", sql`${t.depositFils} >= 0`),
    check("vehicle_categories_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: pk(),
    /** Home branch: the vehicle is offered for pick-up here. */
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => vehicleCategories.id, { onDelete: "restrict" }),
    make: text("make").notNull(),
    model: text("model").notNull(),
    year: smallint("year").notNull(),
    plateNumber: text("plate_number").notNull().unique(),
    vin: text("vin").notNull().unique(),
    color: text("color"),
    transmission: transmission("transmission").notNull(),
    fuelType: fuelType("fuel_type").notNull(),
    seats: smallint("seats").notNull(),
    doors: smallint("doors").notNull().default(4),
    luggage: smallint("luggage").notNull().default(2),
    mileageKm: integer("mileage_km").notNull().default(0),
    status: vehicleStatus("status").notNull().default("AVAILABLE"),
    description: text("description"),
    /** Public storage keys of the vehicle photos, in display order. */
    photoKeys: text("photo_keys").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("vehicles_branch_idx").on(t.branchId),
    index("vehicles_category_idx").on(t.categoryId),
    index("vehicles_status_idx").on(t.status),
    check("vehicles_year_range", sql`${t.year} BETWEEN 1990 AND 2100`),
    check("vehicles_vin_format", sql`${t.vin} ~ '^[A-HJ-NPR-Z0-9]{17}$'`),
    check("vehicles_plate_not_blank", sql`length(trim(${t.plateNumber})) > 0`),
    check("vehicles_seats_range", sql`${t.seats} BETWEEN 1 AND 15`),
    check("vehicles_doors_range", sql`${t.doors} BETWEEN 2 AND 6`),
    check("vehicles_luggage_range", sql`${t.luggage} BETWEEN 0 AND 10`),
    check("vehicles_mileage_nonneg", sql`${t.mileageKm} >= 0`),
  ],
);

export const vehicleFeatures = pgTable("vehicle_features", {
  id: pk(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  icon: text("icon"),
  createdAt: createdAt(),
});

export const vehicleFeatureMap = pgTable(
  "vehicle_feature_map",
  {
    id: pk(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    featureId: uuid("feature_id")
      .notNull()
      .references(() => vehicleFeatures.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("vehicle_feature_map_uq").on(t.vehicleId, t.featureId),
    index("vehicle_feature_map_feature_idx").on(t.featureId),
  ],
);

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------
/**
 * Daily rate rules. The quote uses the most specific active rule that matches the vehicle,
 * pick-up branch, pick-up date and rental length (see src/lib/pricing/rules.ts).
 */
export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: pk(),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => vehicleCategories.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "cascade" }),
    dailyRateFils: integer("daily_rate_fils").notNull(),
    minDays: integer("min_days").notNull().default(1),
    maxDays: integer("max_days"),
    /** Inclusive local dates (branch time zone) of the pick-up day. Null = open-ended. */
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("pricing_rules_category_idx").on(t.categoryId),
    index("pricing_rules_vehicle_idx").on(t.vehicleId),
    check("pricing_rules_target", sql`num_nonnulls(${t.categoryId}, ${t.vehicleId}) >= 1`),
    check("pricing_rules_rate_positive", sql`${t.dailyRateFils} > 0`),
    check("pricing_rules_days", sql`${t.minDays} >= 1 AND (${t.maxDays} IS NULL OR ${t.maxDays} >= ${t.minDays})`),
    check(
      "pricing_rules_valid_dates",
      sql`${t.validFrom} IS NULL OR ${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`,
    ),
  ],
);

/** Fee for returning to a different branch than the pick-up branch (net of VAT). */
export const oneWayFees = pgTable(
  "one_way_fees",
  {
    id: pk(),
    fromBranchId: uuid("from_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    toBranchId: uuid("to_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    feeFils: integer("fee_fils").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("one_way_fees_route_uq").on(t.fromBranchId, t.toBranchId),
    check("one_way_fees_distinct", sql`${t.fromBranchId} <> ${t.toBranchId}`),
    check("one_way_fees_nonneg", sql`${t.feeFils} >= 0`),
  ],
);

export const extras = pgTable(
  "extras",
  {
    id: pk(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    pricingType: extraPricingType("pricing_type").notNull(),
    priceFils: integer("price_fils").notNull(),
    /** Optional cap for the whole rental (per unit), e.g. GPS max 10 days. */
    maxPriceFils: integer("max_price_fils"),
    maxQuantity: smallint("max_quantity").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("extras_code_format", sql`${t.code} ~ '^[A-Z0-9_]{2,40}$'`),
    check("extras_price_nonneg", sql`${t.priceFils} >= 0`),
    check("extras_max_price", sql`${t.maxPriceFils} IS NULL OR ${t.maxPriceFils} >= ${t.priceFils}`),
    check("extras_max_quantity", sql`${t.maxQuantity} BETWEEN 1 AND 10`),
  ],
);

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------
export const reservations = pgTable(
  "reservations",
  {
    id: pk(),
    /** Human reference shown on the voucher, e.g. DE-7K3M9Q. */
    reference: text("reference").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    pickupBranchId: uuid("pickup_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    returnBranchId: uuid("return_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    pickupAt: tstz("pickup_at").notNull(),
    returnAt: tstz("return_at").notNull(),
    /** [pickup_at, return_at) - the exclusion constraint works on this. */
    period: tstzrange("period")
      .notNull()
      .generatedAlwaysAs(sql`tstzrange(pickup_at, return_at, '[)')`),
    status: reservationStatus("status").notNull().default("PENDING"),
    /** When a PENDING hold stops blocking the vehicle. */
    holdExpiresAt: tstz("hold_expires_at"),
    /** Client-supplied key; a retried request returns the same reservation. */
    idempotencyKey: text("idempotency_key").notNull(),
    currency: text("currency").notNull().default("AED"),
    // Server-side price snapshot (fils).
    dailyRateFils: integer("daily_rate_fils").notNull(),
    rentalDays: integer("rental_days").notNull(),
    rentalFils: integer("rental_fils").notNull(),
    extrasFils: integer("extras_fils").notNull().default(0),
    oneWayFeeFils: integer("one_way_fee_fils").notNull().default(0),
    vatRateBps: integer("vat_rate_bps").notNull(),
    taxFils: integer("tax_fils").notNull(),
    totalFils: integer("total_fils").notNull(),
    depositFils: integer("deposit_fils").notNull(),
    confirmedAt: tstz("confirmed_at"),
    cancelledAt: tstz("cancelled_at"),
    cancellationFeeFils: integer("cancellation_fee_fils"),
    refundedFils: integer("refunded_fils").notNull().default(0),
    driverProfileId: uuid("driver_profile_id").references(() => driverProfiles.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("reservations_user_idempotency_uq").on(t.userId, t.idempotencyKey),
    index("reservations_user_idx").on(t.userId),
    index("reservations_vehicle_idx").on(t.vehicleId),
    index("reservations_status_idx").on(t.status),
    index("reservations_pickup_idx").on(t.pickupAt),
    index("reservations_hold_expiry_idx")
      .on(t.holdExpiresAt)
      .where(sql`status = 'PENDING'`),
    check("reservations_reference_format", sql`${t.reference} ~ '^DE-[A-Z0-9]{6}$'`),
    check("reservations_period_order", sql`${t.returnAt} > ${t.pickupAt}`),
    check("reservations_pending_has_hold", sql`${t.status} <> 'PENDING' OR ${t.holdExpiresAt} IS NOT NULL`),
    check("reservations_currency", sql`${t.currency} = 'AED'`),
    check(
      "reservations_amounts_nonneg",
      sql`${t.dailyRateFils} > 0 AND ${t.rentalDays} >= 1 AND ${t.rentalFils} >= 0 AND ${t.extrasFils} >= 0
        AND ${t.oneWayFeeFils} >= 0 AND ${t.taxFils} >= 0 AND ${t.depositFils} >= 0 AND ${t.refundedFils} >= 0
        AND ${t.vatRateBps} BETWEEN 0 AND 10000`,
    ),
    check(
      "reservations_total_matches",
      sql`${t.totalFils} = ${t.rentalFils} + ${t.extrasFils} + ${t.oneWayFeeFils} + ${t.taxFils}`,
    ),
    check("reservations_refund_le_total", sql`${t.refundedFils} <= ${t.totalFils}`),
  ],
);

export const reservationExtras = pgTable(
  "reservation_extras",
  {
    id: pk(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    extraId: uuid("extra_id")
      .notNull()
      .references(() => extras.id, { onDelete: "restrict" }),
    quantity: smallint("quantity").notNull().default(1),
    pricingType: extraPricingType("pricing_type").notNull(),
    unitPriceFils: integer("unit_price_fils").notNull(),
    totalFils: integer("total_fils").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("reservation_extras_uq").on(t.reservationId, t.extraId),
    check("reservation_extras_quantity", sql`${t.quantity} BETWEEN 1 AND 10`),
    check("reservation_extras_amounts", sql`${t.unitPriceFils} >= 0 AND ${t.totalFils} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Money movements (status kept separately from the reservation status)
// ---------------------------------------------------------------------------
export const payments = pgTable(
  "payments",
  {
    id: pk(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    purpose: paymentPurpose("purpose").notNull().default("RENTAL"),
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id").unique(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    amountFils: integer("amount_fils").notNull(),
    amountRefundedFils: integer("amount_refunded_fils").notNull().default(0),
    currency: text("currency").notNull().default("AED"),
    status: paymentStatus("status").notNull().default("pending"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payments_reservation_idx").on(t.reservationId),
    index("payments_status_idx").on(t.status),
    check("payments_amount_positive", sql`${t.amountFils} > 0`),
    check("payments_refund_range", sql`${t.amountRefundedFils} >= 0 AND ${t.amountRefundedFils} <= ${t.amountFils}`),
  ],
);

export const deposits = pgTable(
  "deposits",
  {
    id: pk(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerHoldId: text("provider_hold_id").unique(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    amountFils: integer("amount_fils").notNull(),
    amountCapturedFils: integer("amount_captured_fils").notNull().default(0),
    currency: text("currency").notNull().default("AED"),
    status: depositStatus("status").notNull().default("pending"),
    /** When the authorisation lapses at the provider. */
    expiresAt: tstz("expires_at").notNull(),
    releaseReason: text("release_reason"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("deposits_reservation_idx").on(t.reservationId),
    index("deposits_status_idx").on(t.status),
    uniqueIndex("deposits_one_live_per_reservation_uq")
      .on(t.reservationId)
      .where(sql`status IN ('pending', 'held')`),
    check("deposits_amount_positive", sql`${t.amountFils} > 0`),
    check("deposits_capture_range", sql`${t.amountCapturedFils} >= 0 AND ${t.amountCapturedFils} <= ${t.amountFils}`),
  ],
);

/** Every verified provider webhook, stored by event id so duplicates are processed once. */
export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: pk(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: tstz("received_at").notNull().defaultNow(),
    processedAt: tstz("processed_at"),
    deliveries: integer("deliveries").notNull().default(1),
  },
  (t) => [uniqueIndex("payment_webhook_events_uq").on(t.provider, t.eventId)],
);

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
export const rentalAgreements = pgTable(
  "rental_agreements",
  {
    id: pk(),
    reservationId: uuid("reservation_id")
      .notNull()
      .unique()
      .references(() => reservations.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    // Check-out (pick-up)
    checkedOutAt: tstz("checked_out_at").notNull(),
    checkedOutBy: uuid("checked_out_by").references(() => users.id, { onDelete: "set null" }),
    pickupMileageKm: integer("pickup_mileage_km").notNull(),
    /** Fuel / charge level in eighths: 0 = empty, 8 = full. */
    pickupFuelLevel: smallint("pickup_fuel_level").notNull(),
    pickupNotes: text("pickup_notes"),
    // Check-in (return)
    checkedInAt: tstz("checked_in_at"),
    checkedInBy: uuid("checked_in_by").references(() => users.id, { onDelete: "set null" }),
    returnBranchId: uuid("return_branch_id").references(() => branches.id, { onDelete: "restrict" }),
    returnMileageKm: integer("return_mileage_km"),
    returnFuelLevel: smallint("return_fuel_level"),
    returnNotes: text("return_notes"),
    // Return charges (fils)
    lateDays: integer("late_days").notNull().default(0),
    lateFeeFils: integer("late_fee_fils").notNull().default(0),
    fuelChargeFils: integer("fuel_charge_fils").notNull().default(0),
    damageChargeFils: integer("damage_charge_fils").notNull().default(0),
    chargesTaxFils: integer("charges_tax_fils").notNull().default(0),
    /** Taken from the deposit. */
    depositCapturedFils: integer("deposit_captured_fils").notNull().default(0),
    /** Charges above the deposit that are still owed. */
    amountDueFils: integer("amount_due_fils").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("rental_agreements_vehicle_idx").on(t.vehicleId),
    check("rental_agreements_pickup_fuel", sql`${t.pickupFuelLevel} BETWEEN 0 AND 8`),
    check("rental_agreements_return_fuel", sql`${t.returnFuelLevel} IS NULL OR ${t.returnFuelLevel} BETWEEN 0 AND 8`),
    check("rental_agreements_pickup_mileage", sql`${t.pickupMileageKm} >= 0`),
    check(
      "rental_agreements_return_mileage",
      sql`${t.returnMileageKm} IS NULL OR ${t.returnMileageKm} >= ${t.pickupMileageKm}`,
    ),
    check(
      "rental_agreements_return_complete",
      sql`(${t.checkedInAt} IS NULL) = (${t.returnMileageKm} IS NULL)
        AND (${t.checkedInAt} IS NULL) = (${t.returnFuelLevel} IS NULL)`,
    ),
    check("rental_agreements_return_after_pickup", sql`${t.checkedInAt} IS NULL OR ${t.checkedInAt} >= ${t.checkedOutAt}`),
    check(
      "rental_agreements_charges_nonneg",
      sql`${t.lateDays} >= 0 AND ${t.lateFeeFils} >= 0 AND ${t.fuelChargeFils} >= 0 AND ${t.damageChargeFils} >= 0
        AND ${t.chargesTaxFils} >= 0 AND ${t.depositCapturedFils} >= 0 AND ${t.amountDueFils} >= 0`,
    ),
  ],
);

export const damageReports = pgTable(
  "damage_reports",
  {
    id: pk(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    reservationId: uuid("reservation_id").references(() => reservations.id, { onDelete: "set null" }),
    rentalAgreementId: uuid("rental_agreement_id").references(() => rentalAgreements.id, {
      onDelete: "set null",
    }),
    reportedBy: uuid("reported_by").references(() => users.id, { onDelete: "set null" }),
    stage: damageStage("stage").notNull(),
    severity: damageSeverity("severity").notNull(),
    location: text("location").notNull(),
    description: text("description").notNull(),
    estimatedCostFils: integer("estimated_cost_fils").notNull().default(0),
    /** Private storage keys. Served only to admins through /api/files/damage/[reportId]/[index]. */
    imageKeys: text("image_keys").array().notNull().default(sql`'{}'::text[]`),
    resolvedAt: tstz("resolved_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("damage_reports_vehicle_idx").on(t.vehicleId),
    index("damage_reports_reservation_idx").on(t.reservationId),
    check("damage_reports_cost_nonneg", sql`${t.estimatedCostFils} >= 0`),
    check("damage_reports_images_max", sql`cardinality(${t.imageKeys}) <= 10`),
  ],
);

export const maintenanceBlocks = pgTable(
  "maintenance_blocks",
  {
    id: pk(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    period: tstzrange("period")
      .notNull()
      .generatedAlwaysAs(sql`tstzrange(starts_at, ends_at, '[)')`),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("maintenance_blocks_vehicle_idx").on(t.vehicleId),
    check("maintenance_blocks_period_order", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: pk(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    /** "system" for jobs/webhooks, otherwise the actor's role. */
    actorRole: text("actor_role").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    data: jsonb("data").notNull().default({}),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_actor_idx").on(t.actorId),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type VehicleCategory = typeof vehicleCategories.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type VehicleFeature = typeof vehicleFeatures.$inferSelect;
export type PricingRule = typeof pricingRules.$inferSelect;
export type OneWayFee = typeof oneWayFees.$inferSelect;
export type Extra = typeof extras.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;
export type ReservationExtra = typeof reservationExtras.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type DepositRow = typeof deposits.$inferSelect;
export type RentalAgreement = typeof rentalAgreements.$inferSelect;
export type DamageReport = typeof damageReports.$inferSelect;
export type MaintenanceBlock = typeof maintenanceBlocks.$inferSelect;
export type DriverProfile = typeof driverProfiles.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type ReservationStatus = (typeof reservationStatus.enumValues)[number];
export type VehicleStatus = (typeof vehicleStatus.enumValues)[number];
