-- Sample hand-written migration: make double-booking impossible in the database.
-- Generic names: rename resources/bookings/blocks to your domain (vehicles, rooms, desks...).
-- Assumes bookings and blocks each have start/end timestamptz columns and a generated period:
--   period tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED
-- '[)' bounds: a booking ending at 10:00 does not overlap one starting at 10:00.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Same table: no two active bookings for one resource may overlap.
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (resource_id WITH =, period WITH &&)
  WHERE (status IN ('PENDING', 'CONFIRMED', 'PICKED_UP'));

-- 2. Same table: no two maintenance/closure blocks for one resource may overlap.
ALTER TABLE blocks ADD CONSTRAINT blocks_no_overlap
  EXCLUDE USING gist (resource_id WITH =, period WITH &&);

-- 3. Cross table: an exclusion constraint cannot span two tables, so use triggers.
--    Each trigger locks the resource row first, which serialises concurrent writers for
--    that resource, then raises the same error class as an exclusion constraint.
CREATE FUNCTION bookings_check_block_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('PENDING', 'CONFIRMED', 'PICKED_UP') THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM resources WHERE id = NEW.resource_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM blocks b
    WHERE b.resource_id = NEW.resource_id
      AND b.period && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  ) THEN
    RAISE EXCEPTION 'resource % is blocked during [%, %)', NEW.resource_id, NEW.starts_at, NEW.ends_at
      USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'bookings_no_block_overlap';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_no_block_overlap
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_check_block_overlap();

CREATE FUNCTION blocks_check_booking_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM resources WHERE id = NEW.resource_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM bookings k
    WHERE k.resource_id = NEW.resource_id
      AND k.status IN ('PENDING', 'CONFIRMED', 'PICKED_UP')
      AND k.period && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  ) THEN
    RAISE EXCEPTION 'resource % has an active booking during [%, %)', NEW.resource_id, NEW.starts_at, NEW.ends_at
      USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'blocks_no_booking_overlap';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER blocks_no_booking_overlap
  BEFORE INSERT OR UPDATE ON blocks
  FOR EACH ROW EXECUTE FUNCTION blocks_check_booking_overlap();

-- Note: expired PENDING holds still count here. The booking transaction marks overlapping
-- stale holds EXPIRED (inside the same locked transaction) before inserting the new booking.
-- In app code, map SQLSTATE 23P01 (and 23505 on the idempotency key) to a friendly
-- "no longer available" / "already booked" response.
