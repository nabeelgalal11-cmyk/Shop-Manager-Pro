import { Router } from "express";
import {
  db,
  appointmentsTable,
  remindersTable,
  inventoryTable,
  customersTable,
  vehiclesTable,
} from "@workspace/db";
import { eq, and, lte, lt, sql, desc, inArray } from "drizzle-orm";

const router: Router = Router();

router.get("/", async (_req, res) => {
  const todayIso = new Date().toISOString().split("T")[0];

  const [pendingAppts, overdueReminders, lowStockItems] = await Promise.all([
    // Pending appointments (awaiting confirmation)
    db
      .select({
        id: appointmentsTable.id,
        scheduledAt: appointmentsTable.scheduledAt,
        serviceType: appointmentsTable.serviceType,
        customerId: appointmentsTable.customerId,
        vehicleId: appointmentsTable.vehicleId,
        status: appointmentsTable.status,
      })
      .from(appointmentsTable)
      .where(eq(appointmentsTable.status, "pending"))
      .orderBy(desc(appointmentsTable.createdAt))
      .limit(15),

    // Overdue (or due-today) unsent reminders
    db
      .select({
        id: remindersTable.id,
        serviceType: remindersTable.serviceType,
        dueDate: remindersTable.dueDate,
        customerId: remindersTable.customerId,
        vehicleId: remindersTable.vehicleId,
      })
      .from(remindersTable)
      .where(and(eq(remindersTable.sent, false), lte(remindersTable.dueDate, todayIso)))
      .orderBy(remindersTable.dueDate)
      .limit(15),

    // Low / out-of-stock items
    db
      .select({
        id: inventoryTable.id,
        name: inventoryTable.name,
        partNumber: inventoryTable.partNumber,
        quantity: inventoryTable.quantity,
        minQuantity: inventoryTable.minQuantity,
      })
      .from(inventoryTable)
      .where(lte(inventoryTable.quantity, inventoryTable.minQuantity))
      .orderBy(inventoryTable.quantity)
      .limit(15),
  ]);

  // Enrich appointments + reminders with customer / vehicle names in batch
  const customerIds = Array.from(
    new Set([...pendingAppts.map(a => a.customerId), ...overdueReminders.map(r => r.customerId)]),
  );
  const vehicleIds = Array.from(
    new Set(
      [...pendingAppts.map(a => a.vehicleId), ...overdueReminders.map(r => r.vehicleId)].filter(
        (v): v is number => v != null,
      ),
    ),
  );

  const [customers, vehicles] = await Promise.all([
    customerIds.length
      ? db
          .select({
            id: customersTable.id,
            firstName: customersTable.firstName,
            lastName: customersTable.lastName,
          })
          .from(customersTable)
          .where(inArray(customersTable.id, customerIds))
      : Promise.resolve([] as { id: number; firstName: string; lastName: string }[]),
    vehicleIds.length
      ? db
          .select({
            id: vehiclesTable.id,
            year: vehiclesTable.year,
            make: vehiclesTable.make,
            model: vehiclesTable.model,
            licensePlate: vehiclesTable.licensePlate,
          })
          .from(vehiclesTable)
          .where(inArray(vehiclesTable.id, vehicleIds))
      : Promise.resolve(
          [] as {
            id: number;
            year: number | null;
            make: string;
            model: string;
            licensePlate: string | null;
          }[],
        ),
  ]);

  const customerMap = new Map(customers.map(c => [c.id, `${c.firstName} ${c.lastName}`.trim()]));
  const vehicleMap = new Map(
    vehicles.map(v => [
      v.id,
      [v.year, v.make, v.model].filter(Boolean).join(" ") +
        (v.licensePlate ? ` (${v.licensePlate})` : ""),
    ]),
  );

  const appointments = pendingAppts.map(a => ({
    id: a.id,
    scheduledAt: a.scheduledAt,
    serviceType: a.serviceType,
    customerName: customerMap.get(a.customerId) || `Customer #${a.customerId}`,
    vehicleLabel: a.vehicleId ? vehicleMap.get(a.vehicleId) || null : null,
  }));

  const reminders = overdueReminders.map(r => {
    const due = new Date(r.dueDate);
    const today = new Date(todayIso);
    const daysOverdue = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000));
    return {
      id: r.id,
      serviceType: r.serviceType,
      dueDate: r.dueDate,
      daysOverdue,
      customerName: customerMap.get(r.customerId) || `Customer #${r.customerId}`,
      vehicleLabel: r.vehicleId ? vehicleMap.get(r.vehicleId) || null : null,
    };
  });

  const lowStock = lowStockItems.map(i => ({
    id: i.id,
    name: i.name,
    partNumber: i.partNumber,
    quantity: i.quantity,
    minQuantity: i.minQuantity,
    outOfStock: i.quantity <= 0,
  }));

  res.json({
    appointments,
    reminders,
    lowStock,
    counts: {
      appointments: appointments.length,
      reminders: reminders.length,
      lowStock: lowStock.length,
      total: appointments.length + reminders.length + lowStock.length,
    },
  });
});

export default router;
