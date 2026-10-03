import { Router } from "express";
import { db } from "@workspace/db";
import { appointmentsTable, customersTable, vehiclesTable, employeesTable } from "@workspace/db";
import { eq, sql, desc, gte, lte, and } from "drizzle-orm";
import { sendTemplatedEmail } from "../lib/email.js";
import { requirePermission } from "../lib/auth.js";

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
    appointment.assignedToId ? db.select({
      id: employeesTable.id,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
    }).from(employeesTable).where(eq(employeesTable.id, appointment.assignedToId)).then(r => r[0]) : Promise.resolve(null),
  ]);
  return { ...appointment, customer, vehicle, assignedTo };
}

async function validateAppointmentReferences(customerId: number, vehicleId: number | null, assignedToId: number | null) {
  if (!Number.isSafeInteger(customerId) || customerId <= 0) return "A valid customer is required";
  const [customer] = await db.select({ id: customersTable.id }).from(customersTable).where(eq(customersTable.id, customerId));
  if (!customer) return "Customer not found";
  if (vehicleId !== null) {
    if (!Number.isSafeInteger(vehicleId) || vehicleId <= 0) return "Vehicle is invalid";
    const [vehicle] = await db.select({ id: vehiclesTable.id, customerId: vehiclesTable.customerId })
      .from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
    if (!vehicle) return "Vehicle not found";
    if (vehicle.customerId !== customerId) return "Vehicle does not belong to the selected customer";
  }
  if (assignedToId !== null) {
    if (!Number.isSafeInteger(assignedToId) || assignedToId <= 0) return "Assigned employee is invalid";
    const [employee] = await db.select({ id: employeesTable.id, active: employeesTable.active })
      .from(employeesTable).where(eq(employeesTable.id, assignedToId));
    if (!employee?.active) return "Assigned employee not found or inactive";
  }
  return null;
}

router.get("/", requirePermission("appointments", "view"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const status = req.query.status as string | undefined;
  const date = req.query.date as string | undefined;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (status) conditions.push(eq(appointmentsTable.status, status));
  if (date) {
    const start = new Date(`${date}T00:00:00`);
    if (Number.isNaN(start.getTime())) return res.status(400).json({ error: "Invalid appointment date" });
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    conditions.push(gte(appointmentsTable.scheduledAt, start), lte(appointmentsTable.scheduledAt, end));
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const appointments = await db.select().from(appointmentsTable).where(where)
    .orderBy(appointmentsTable.scheduledAt).limit(limit).offset(offset);

  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(appointmentsTable).where(where);
  const enriched = await Promise.all(appointments.map(enrichAppointment));
  res.json({ data: enriched, total: Number(countResult.count), page, limit });
});

router.post("/", requirePermission("appointments", "create"), async (req, res) => {
  const { customerId: rawCustomerId, vehicleId: rawVehicleId, assignedToId: rawAssignedToId, serviceType, description, scheduledAt, estimatedDuration, notes } = req.body || {};
  const customerId = Number(rawCustomerId);
  const vehicleId = rawVehicleId == null || rawVehicleId === "" ? null : Number(rawVehicleId);
  const assignedToId = rawAssignedToId == null || rawAssignedToId === "" ? null : Number(rawAssignedToId);
  const scheduledDate = typeof scheduledAt === "string" || scheduledAt instanceof Date ? new Date(scheduledAt) : new Date(Number.NaN);
  const duration = estimatedDuration == null || estimatedDuration === "" ? 60 : Number(estimatedDuration);
  if (Number.isNaN(scheduledDate.getTime())) return res.status(400).json({ error: "A valid appointment date and time is required" });
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > 1440) return res.status(400).json({ error: "Duration must be between 1 and 1440 minutes" });
  const referenceError = await validateAppointmentReferences(customerId, vehicleId, assignedToId);
  if (referenceError) return res.status(400).json({ error: referenceError });
  const [appointment] = await db.insert(appointmentsTable).values({
    customerId, vehicleId, assignedToId, status: "scheduled", serviceType, description,
    scheduledAt: scheduledDate, estimatedDuration: duration, notes,
  }).returning();
  res.status(201).json(await enrichAppointment(appointment));
});

router.get("/:id", requirePermission("appointments", "view"), async (req, res) => {
  const [appointment] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, Number(req.params.id)));
  if (!appointment) return res.status(404).json({ error: "Appointment not found" });
  res.json(await enrichAppointment(appointment));
});

router.put("/:id", requirePermission("appointments", "edit"), async (req, res) => {
  const id = Number(req.params.id);
  const [prev] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!prev) return res.status(404).json({ error: "Appointment not found" });
  const body = req.body || {};
  const customerId = body.customerId === undefined ? prev.customerId : Number(body.customerId);
  const vehicleId = body.vehicleId === undefined ? prev.vehicleId : (body.vehicleId == null || body.vehicleId === "" ? null : Number(body.vehicleId));
  const assignedToId = body.assignedToId === undefined ? prev.assignedToId : (body.assignedToId == null || body.assignedToId === "" ? null : Number(body.assignedToId));
  const referenceError = await validateAppointmentReferences(customerId, vehicleId, assignedToId);
  if (referenceError) return res.status(400).json({ error: referenceError });
  const scheduledDate = body.scheduledAt === undefined ? undefined : new Date(body.scheduledAt);
  if (scheduledDate && Number.isNaN(scheduledDate.getTime())) return res.status(400).json({ error: "A valid appointment date and time is required" });
  const duration = body.estimatedDuration === undefined ? undefined : Number(body.estimatedDuration);
  if (duration !== undefined && (!Number.isSafeInteger(duration) || duration < 1 || duration > 1440)) {
    return res.status(400).json({ error: "Duration must be between 1 and 1440 minutes" });
  }
  const { status, serviceType, description, notes } = body;
  const [appointment] = await db.update(appointmentsTable).set({
    customerId, vehicleId, assignedToId, status, serviceType, description,
    scheduledAt: scheduledDate,
    estimatedDuration: duration, notes, updatedAt: new Date(),
  }).where(eq(appointmentsTable.id, id)).returning();
  const enriched = await enrichAppointment(appointment);
  await maybeSendConfirmation(prev.status, enriched, req);
  res.json(enriched);
});

router.delete("/:id", requirePermission("appointments", "delete"), async (req, res) => {
  await db.delete(appointmentsTable).where(eq(appointmentsTable.id, Number(req.params.id)));
  res.status(204).send();
});

export default router;
