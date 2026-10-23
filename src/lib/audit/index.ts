import "server-only";
import { db, type DbOrTx } from "@/db";
import { auditLogs } from "@/db/schema";

export type AuditActor = { id: string; role: string } | "system";

export type AuditEntry = {
  actor: AuditActor;
  /** e.g. "reservation.confirmed", "vehicle.updated" */
  action: string;
  entityType: string;
  entityId?: string | null;
  data?: Record<string, unknown>;
  requestId?: string;
};

/** Writes an audit_logs row. Pass the transaction so the entry commits with the change. */
export async function audit(entry: AuditEntry, tx: DbOrTx = db): Promise<void> {
  const actor = entry.actor === "system" ? null : entry.actor;
  await tx.insert(auditLogs).values({
    actorId: actor?.id ?? null,
    actorRole: actor?.role ?? "system",
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    data: entry.data ?? {},
    requestId: entry.requestId ?? null,
  });
}
