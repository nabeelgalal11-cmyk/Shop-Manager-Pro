import type { Request } from "express";
import { db, activityEventsTable } from "@workspace/db";

export type ActivityEntityType =
  | "repair_order"
  | "invoice"
  | "estimate"
  | "customer"
  | "vehicle"
  | "inspection"
  | "appointment"
  | "supplier"
  | "payment"
  | "purchase";

export type ActivityEventType =
  | "created"
  | "updated"
  | "status_changed"
  | "note_added"
  | "assigned"
  | "email_sent"
  | "sms_sent"
  | "payment_received"
  | "payment_failed"
  | "attachment_uploaded"
  | "attachment_deleted"
  | "inspection_sent"
  | "inspection_approved"
  | "estimate_sent"
  | "estimate_approved"
  | "estimate_declined"
  | "estimate_converted"
  | "deleted";

export interface RecordActivityOpts {
  entityType: ActivityEntityType;
  entityId: number;
  eventType: ActivityEventType;
  meta?: Record<string, unknown>;
  actorId?: number | null;
  actorLabel?: string | null;
  /**
   * If set (and the primary entity is not "customer"), a mirrored event row
   * is written with entityType="customer" and entityId=customerId. This
   * powers the customer detail timeline so it sees activity from related
   * ROs, invoices, estimates, payments, inspections, and attachments
   * without requiring a join-heavy aggregation query.
   */
  customerId?: number | null;
  req?: Pick<Request, "session" | "log"> & { user?: { id?: number; username?: string } };
}

/**
 * Append-only activity log writer. Fire-and-forget: a logging failure is
 * caught and logged via req.log so it can never break the underlying
 * mutation that triggered it.
 */
export async function recordActivity(opts: RecordActivityOpts): Promise<void> {
  try {
    const actorId =
      opts.actorId !== undefined
        ? opts.actorId
        : opts.req?.user?.id ?? opts.req?.session?.userId ?? null;
    const actorLabel =
      opts.actorLabel !== undefined ? opts.actorLabel : opts.req?.user?.username ?? null;

    const baseMeta = opts.meta ?? {};
    const rows: Array<typeof activityEventsTable.$inferInsert> = [
      {
        entityType: opts.entityType,
        entityId: opts.entityId,
        eventType: opts.eventType,
        actorId: actorId ?? null,
        actorLabel: actorLabel ?? null,
        meta: baseMeta,
      },
    ];

    if (
      opts.customerId &&
      opts.entityType !== "customer" &&
      Number.isFinite(opts.customerId)
    ) {
      rows.push({
        entityType: "customer",
        entityId: opts.customerId,
        eventType: opts.eventType,
        actorId: actorId ?? null,
        actorLabel: actorLabel ?? null,
        meta: { ...baseMeta, mirrorOf: { entityType: opts.entityType, entityId: opts.entityId } },
      });
    }

    await db.insert(activityEventsTable).values(rows);
  } catch (err) {
    opts.req?.log?.warn(
      { err, entityType: opts.entityType, entityId: opts.entityId, eventType: opts.eventType },
      "recordActivity failed",
    );
  }
}
