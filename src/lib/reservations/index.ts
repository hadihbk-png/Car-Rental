// Reservation domain services. Every function takes the signed-in Actor first and checks
// authorization itself (owner or admin; admin-only where noted).
export { createReservation, getReservation, listMyReservations, generateReference } from "./booking";
export type { CreateReservationInput } from "./booking";
export { payReservation, payReturnBalance, processPaymentWebhook, tryConfirmReservation } from "./payment-flow";
export type { PayReservationInput, WebhookResult } from "./payment-flow";
export { cancelReservation, modifyReservationDates } from "./changes";
export { listReservations, checkOutReservation, checkInReservation, settleReturnedDeposit } from "./operations";
export type { CheckInResult } from "./operations";
export { getVoucher, verifyVoucherPayload } from "./voucher";
export type { Voucher } from "./voucher";
export {
  createDamageReport,
  addDamageImage,
  updateDamageReport,
  listDamageReports,
  getDamageReport,
  getDamageImage,
} from "./damage";
export type { DamageReportView } from "./damage";
export type { ReservationView, ReservationExtraLine } from "./view";
