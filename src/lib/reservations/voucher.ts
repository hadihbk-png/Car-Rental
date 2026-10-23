import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { db } from "@/db";
import type { Actor } from "@/lib/auth/types";
import { DomainError } from "@/lib/errors";
import { assertCanAccess, buildReservationView, loadReservationRow, type ReservationView } from "./view";

// Voucher QR payload: "DE1.<reference>.<signature>", where signature = base64url(HMAC-SHA256(
// QR_SIGNING_SECRET, "DE1.<reference>.<reservationId>")) truncated to 128 bits. The QR never
// contains raw ids; staff scan it and verifyVoucherPayload() resolves the reservation.

const VERSION = "DE1";

function secret(): string {
  const s = process.env.QR_SIGNING_SECRET;
  if (!s || s.length < 16) throw new Error("QR_SIGNING_SECRET is not set (min 16 chars)");
  return s;
}

function sign(reference: string, reservationId: string): string {
  return createHmac("sha256", secret()).update(`${VERSION}.${reference}.${reservationId}`).digest().subarray(0, 16).toString("base64url");
}

export function voucherPayload(reference: string, reservationId: string): string {
  return `${VERSION}.${reference}.${sign(reference, reservationId)}`;
}

export type Voucher = {
  reservation: ReservationView;
  reference: string;
  /** Signed string encoded in the QR code. */
  qrPayload: string;
  /** Inline SVG markup of the QR code (safe: generated server-side). */
  qrSvg: string;
  /** data:image/png;base64,... of the QR code. */
  qrDataUrl: string;
};

/** Pick-up voucher for a confirmed (or picked-up/returned) reservation. Owner or admin. */
export async function getVoucher(actor: Actor, reservationIdOrReference: string, now: Date = new Date()): Promise<Voucher> {
  const r = await loadReservationRow(db, reservationIdOrReference);
  assertCanAccess(actor, r);
  if (!["CONFIRMED", "PICKED_UP", "RETURNED"].includes(r.status)) {
    throw new DomainError("INVALID_STATE", "A voucher is available once the reservation is confirmed.");
  }
  const qrPayload = voucherPayload(r.reference, r.id);
  const [qrSvg, qrDataUrl] = await Promise.all([
    QRCode.toString(qrPayload, { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
    QRCode.toDataURL(qrPayload, { margin: 1, width: 320, errorCorrectionLevel: "M" }),
  ]);
  return { reservation: await buildReservationView(r, now), reference: r.reference, qrPayload, qrSvg, qrDataUrl };
}

/** Admin: resolve a scanned voucher QR payload. Throws VALIDATION for a forged/garbled code. */
export async function verifyVoucherPayload(actor: Actor, payload: string, now: Date = new Date()): Promise<ReservationView> {
  if (actor.role !== "admin") throw new DomainError("FORBIDDEN", "Administrator access required.");
  const m = /^DE1\.(DE-[A-Z0-9]{6})\.([A-Za-z0-9_-]{22})$/.exec(payload.trim());
  if (!m) throw new DomainError("VALIDATION", "This is not a DriveEasy voucher code.");
  let r;
  try {
    r = await loadReservationRow(db, m[1]);
  } catch {
    throw new DomainError("VALIDATION", "Invalid voucher code.");
  }
  const expected = Buffer.from(sign(r.reference, r.id));
  const given = Buffer.from(m[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new DomainError("VALIDATION", "Invalid voucher code.");
  }
  return buildReservationView(r, now);
}
