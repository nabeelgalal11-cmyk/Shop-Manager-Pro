import { Router } from "express";
import { db } from "@workspace/db";
import { remindersTable, customersTable, vehiclesTable } from "@workspace/db";
import { eq, sql, desc, and } from "drizzle-orm";

const router: Router = Router();

async function enrichReminder(reminder: any) {
  const [customer, vehicle] = await Promise.all([
    db.select().from(customersTable).where(eq(customersTable.id, reminder.customerId)).then(r => r[0]),
    reminder.vehicleId ? db.select().from(vehiclesTable).where(eq(vehiclesTable.id, reminder.vehicleId)).then(r => r[0]) : Promise.resolve(null),
  ]);
  return { ...reminder, customer, vehicle };
}

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const sent = req.query.sent !== undefined ? req.query.sent === "true" : undefined;
  const overdue = req.query.overdue === "true";
  const offset = (page - 1) * limit;

  let reminders = await (sent !== undefined
    ? db.select().from(remindersTable).where(eq(remindersTable.sent, sent)).orderBy(remindersTable.dueDate).limit(limit).offset(offset)
    : db.select().from(remindersTable).orderBy(remindersTable.dueDate).limit(limit).offset(offset));

  if (overdue) {
    const today = new Date().toISOString().split("T")[0];
    reminders = reminders.filter(r => r.dueDate < today && !r.sent);
  }

  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(remindersTable);
  const enriched = await Promise.all(reminders.map(enrichReminder));
  res.json({ data: enriched, total: Number(countResult.count), page, limit });
});

router.post("/", async (req, res) => {
  const { customerId, vehicleId, serviceType, dueDate, dueMileage, notes } = req.body;
  const [reminder] = await db.insert(remindersTable).values({
    customerId, vehicleId, serviceType, dueDate, dueMileage, notes, sent: false,
  }).returning();
  res.status(201).json(await enrichReminder(reminder));
});

router.get("/:id", async (req, res) => {
  const [reminder] = await db.select().from(remindersTable).where(eq(remindersTable.id, Number(req.params.id)));
  if (!reminder) return res.status(404).json({ error: "Reminder not found" });
  res.json(await enrichReminder(reminder));
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { customerId, vehicleId, serviceType, dueDate, dueMileage, notes, sent } = req.body;
  const [reminder] = await db.update(remindersTable).set({
    customerId, vehicleId, serviceType, dueDate, dueMileage, notes,
    sent: sent ?? false,
    sentAt: sent ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(remindersTable.id, id)).returning();
  if (!reminder) return res.status(404).json({ error: "Reminder not found" });
  res.json(await enrichReminder(reminder));
});

router.delete("/:id", async (req, res) => {
  await db.delete(remindersTable).where(eq(remindersTable.id, Number(req.params.id)));
  res.status(204).send();
});

export default router;
