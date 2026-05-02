import { Router } from "express";
import { db } from "@workspace/db";
import { appointmentsTable, customersTable, vehiclesTable, employeesTable } from "@workspace/db";
import { eq, sql, desc, gte, lte, and } from "drizzle-orm";
import { sendTemplatedEmail } from "../lib/email.js";

const router: Router = Router();

const CONFIRMED_STATUSES = new Set(["scheduled", "confirmed"]);

async function maybeSendConfirmation(prevStatus: string, appointment: any, req: any) {
  try {
    if (prevStatus !== "pending") return;
    if (!CONFIRMED_STATUSES.has(appointment.status)) return;
    const customer = appointment.customer;
    if (!customer?.email) {
      req.log?.info({ id: appointment.id }, "No customer email; skipping confirmation");
      return;
    }
    const vehicle = appointment.vehicle;
    const vehicleInfo = vehicle
      ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") +
        (vehicle.licensePlate ? ` (${vehicle.licensePlate})` : "")
      : "Not specified";
    const result = await sendTemplatedEmail("appointment_confirmed", customer.email, {
      customerName: `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || "Customer",
      customerEmail: customer.email,
      shopName: process.env.SHOP_NAME || "Our Shop",
      appointmentDateTime: appointment.scheduledAt
        ? new Date(appointment.scheduledAt).toLocaleString()
        : "TBD",
      serviceType: appointment.serviceType || "Service",
      vehicleInfo,
      notes: appointment.notes || "",
    });
    if (!result.ok) {
      req.log?.warn({ err: result.error, id: appointment.id }, "Confirmation email failed");
    }
  } catch (err) {
    req.log?.error({ err }, "maybeSendConfirmation crashed");
  }
}
async function enrichAppointment(appointment: any) {
  const [customer, vehicle, assignedTo] = await Promise.all([
    db.select().from(customersTable).where(eq(customersTable.id, appointment.customerId)).then(r => r[0]),
    appointment.vehicleId ? db.select().from(vehiclesTable).where(eq(vehiclesTable.id, appointment.vehicleId)).then(r => r[0]) : Promise.resolve(null),
    appointment.assignedToId ? db.select().from(employeesTable).where(eq(employeesTable.id, appointment.assignedToId)).then(r => r[0]) : Promise.resolve(null),
  ]);
  return { ...appointment, customer, vehicle, assignedTo };
}

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const status = req.query.status as string | undefined;
  const date = req.query.date as string | undefined;
  const offset = (page - 1) * limit;

  let appointments;
  if (status) {
    appointments = await db.select().from(appointmentsTable).where(eq(appointmentsTable.status, status)).orderBy(appointmentsTable.scheduledAt).limit(limit).offset(offset);
  } else if (date) {
    const start = new Date(date);
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    appointments = await db.select().from(appointmentsTable).where(and(gte(appointmentsTable.scheduledAt, start), lte(appointmentsTable.scheduledAt, end))).orderBy(appointmentsTable.scheduledAt).limit(limit).offset(offset);
  } else {
    appointments = await db.select().from(appointmentsTable).orderBy(appointmentsTable.scheduledAt).limit(limit).offset(offset);
  }

  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(appointmentsTable);
  const enriched = await Promise.all(appointments.map(enrichAppointment));
  res.json({ data: enriched, total: Number(countResult.count), page, limit });
});

router.post("/", async (req, res) => {
  const { customerId, vehicleId, assignedToId, status, serviceType, description, scheduledAt, estimatedDuration, notes } = req.body;
  const [appointment] = await db.insert(appointmentsTable).values({
    customerId, vehicleId, assignedToId, status: status || "scheduled", serviceType, description,
    scheduledAt: new Date(scheduledAt), estimatedDuration, notes,
  }).returning();
  res.status(201).json(await enrichAppointment(appointment));
});

router.get("/:id", async (req, res) => {
  const [appointment] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, Number(req.params.id)));
  if (!appointment) return res.status(404).json({ error: "Appointment not found" });
  res.json(await enrichAppointment(appointment));
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [prev] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!prev) return res.status(404).json({ error: "Appointment not found" });
  const { customerId, vehicleId, assignedToId, status, serviceType, description, scheduledAt, estimatedDuration, notes } = req.body;
  const [appointment] = await db.update(appointmentsTable).set({
    customerId, vehicleId, assignedToId, status, serviceType, description,
    scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
    estimatedDuration, notes, updatedAt: new Date(),
  }).where(eq(appointmentsTable.id, id)).returning();
  const enriched = await enrichAppointment(appointment);
  await maybeSendConfirmation(prev.status, enriched, req);
  res.json(enriched);
});

router.delete("/:id", async (req, res) => {
  await db.delete(appointmentsTable).where(eq(appointmentsTable.id, Number(req.params.id)));
  res.status(204).send();
});

export default router;
