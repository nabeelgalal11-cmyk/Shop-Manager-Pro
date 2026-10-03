import { Router } from "express";
import { db, ownerFundingEntriesTable, ownerFundingTypes } from "@workspace/db";
import { DeleteOwnerFundingEntryParams } from "@workspace/api-zod";
import { desc, eq, sql } from "drizzle-orm";
import { getUser, requirePermission } from "../lib/auth.js";
import { canRepayOwnerLoan, summarizeOwnerFunding } from "../lib/owner-funding.js";

const router: Router = Router();
const OWNER_FUNDING_LOCK_ID = 91520261;

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function presentEntry(entry: typeof ownerFundingEntriesTable.$inferSelect) {
  return { ...entry, amount: Number(entry.amount) };
}

router.get("/", requirePermission("reports", "view"), async (_req, res): Promise<void> => {
  const rows = await db.select().from(ownerFundingEntriesTable)
    .orderBy(desc(ownerFundingEntriesTable.entryDate), desc(ownerFundingEntriesTable.id));
  res.json({
    entries: rows.map(presentEntry),
    summary: summarizeOwnerFunding(rows),
  });
});

router.post("/", requirePermission("expenses", "create"), async (req, res): Promise<void> => {
  const type = req.body?.type;
  const rawAmount = Number(req.body?.amount);
  const amount = Math.round(rawAmount * 100) / 100;
  const entryDate = req.body?.entryDate;
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";

  if (!ownerFundingTypes.includes(type)) {
    res.status(400).json({ error: "Choose a loan, owner contribution, or loan repayment." });
    return;
  }
  if (!Number.isFinite(rawAmount) || rawAmount <= 0 || Math.abs(rawAmount - amount) > 0.000001) {
    res.status(400).json({ error: "Amount must be greater than zero and use no more than two decimal places." });
    return;
  }
  if (!isIsoDate(entryDate)) {
    res.status(400).json({ error: "Entry date must be a valid YYYY-MM-DD date." });
    return;
  }
  if (!description || description.length > 200 || notes.length > 1000) {
    res.status(400).json({ error: "Add a description up to 200 characters; notes may be up to 1,000 characters." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${OWNER_FUNDING_LOCK_ID})`);
    if (type === "repayment") {
      const existing = await tx.select({
        type: ownerFundingEntriesTable.type,
        amount: ownerFundingEntriesTable.amount,
      }).from(ownerFundingEntriesTable);
      const outstanding = summarizeOwnerFunding(existing).outstandingLoan;
      if (!canRepayOwnerLoan(outstanding, amount)) {
        return { kind: "overpayment" as const, outstanding };
      }
    }

    const [entry] = await tx.insert(ownerFundingEntriesTable).values({
      type,
      amount: amount.toFixed(2),
      entryDate,
      description,
      notes: notes || null,
      createdById: getUser(req)?.id ?? null,
    }).returning();
    return { kind: "created" as const, entry };
  });

  if (result.kind === "overpayment") {
    res.status(409).json({
      error: `Repayment cannot exceed the outstanding owner loan of $${result.outstanding.toFixed(2)}.`,
    });
    return;
  }
  res.status(201).json(presentEntry(result.entry));
});

router.delete("/:id", requirePermission("expenses", "delete"), async (req, res): Promise<void> => {
  const params = DeleteOwnerFundingEntryParams.safeParse(req.params);
  if (!params.success || !Number.isSafeInteger(params.data?.id)) {
    res.status(400).json({ error: params.success ? "Entry id must be an integer." : params.error.message });
    return;
  }

  const deleted = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${OWNER_FUNDING_LOCK_ID})`);
    const [entry] = await tx.delete(ownerFundingEntriesTable)
      .where(eq(ownerFundingEntriesTable.id, params.data.id))
      .returning({ id: ownerFundingEntriesTable.id });
    return entry;
  });

  if (!deleted) {
    res.status(404).json({ error: "Owner funding entry not found." });
    return;
  }
  res.sendStatus(204);
});

export default router;