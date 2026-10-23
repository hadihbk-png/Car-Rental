-- Hand-written: overlap guarantees that drizzle-kit cannot express.
--
-- 1. Same-table: btree_gist exclusion constraints on (vehicle_id, period) so one vehicle can never
--    have two overlapping active reservations, or two overlapping maintenance blocks.
--    Periods are '[)' ranges, so a rental ending at 10:00 does not overlap one starting at 10:00.
-- 2. Cross-table (reservation vs maintenance block): BEFORE triggers that lock the vehicle row
--    (serialising concurrent writers for that vehicle) and then reject an overlap with
--    SQLSTATE 23P01 (exclusion_violation), the same error class as the exclusion constraints.
--
-- "Active" reservation statuses: PENDING (hold), CONFIRMED, PICKED_UP. Expired PENDING holds are
-- still counted here; the booking transaction marks overlapping stale holds EXPIRED first.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_no_overlap"
  EXCLUDE USING gist ("vehicle_id" WITH =, "period" WITH &&)
  WHERE ("status" IN ('PENDING', 'CONFIRMED', 'PICKED_UP'));
--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_no_overlap"
  EXCLUDE USING gist ("vehicle_id" WITH =, "period" WITH &&);
--> statement-breakpoint
CREATE FUNCTION "reservations_check_maintenance_overlap"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('PENDING', 'CONFIRMED', 'PICKED_UP') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('PENDING', 'CONFIRMED', 'PICKED_UP')
     AND NEW.vehicle_id = OLD.vehicle_id
     AND NEW.pickup_at = OLD.pickup_at
     AND NEW.return_at = OLD.return_at THEN
    RETURN NEW;
  END IF;
  -- Serialise with concurrent maintenance-block writers for the same vehicle.
  PERFORM 1 FROM "vehicles" WHERE "id" = NEW.vehicle_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM "maintenance_blocks" m
    WHERE m.vehicle_id = NEW.vehicle_id
      AND m.period && tstzrange(NEW.pickup_at, NEW.return_at, '[)')
  ) THEN
    RAISE EXCEPTION 'vehicle % has a maintenance block overlapping [%, %)', NEW.vehicle_id, NEW.pickup_at, NEW.return_at
      USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'reservations_no_maintenance_overlap',
            TABLE = 'reservations';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "reservations_no_maintenance_overlap"
  BEFORE INSERT OR UPDATE ON "reservations"
  FOR EACH ROW EXECUTE FUNCTION "reservations_check_maintenance_overlap"();
--> statement-breakpoint
CREATE FUNCTION "maintenance_blocks_check_reservation_overlap"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.vehicle_id = OLD.vehicle_id
     AND NEW.starts_at = OLD.starts_at
     AND NEW.ends_at = OLD.ends_at THEN
    RETURN NEW;
  END IF;
  -- Serialise with concurrent reservation writers for the same vehicle.
  PERFORM 1 FROM "vehicles" WHERE "id" = NEW.vehicle_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM "reservations" r
    WHERE r.vehicle_id = NEW.vehicle_id
      AND r.status IN ('PENDING', 'CONFIRMED', 'PICKED_UP')
      AND r.period && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  ) THEN
    RAISE EXCEPTION 'vehicle % has an active reservation overlapping [%, %)', NEW.vehicle_id, NEW.starts_at, NEW.ends_at
      USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'maintenance_blocks_no_reservation_overlap',
            TABLE = 'maintenance_blocks';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "maintenance_blocks_no_reservation_overlap"
  BEFORE INSERT OR UPDATE ON "maintenance_blocks"
  FOR EACH ROW EXECUTE FUNCTION "maintenance_blocks_check_reservation_overlap"();
