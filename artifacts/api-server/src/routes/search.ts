import { Router } from "express";
import {
  db,
  customersTable,
  vehiclesTable,
  repairOrdersTable,
  invoicesTable,
  estimatesTable,
  appointmentsTable,
} from "@workspace/db";
import { or, ilike, sql, eq, desc } from "drizzle-orm";

const router: Router = Router();

router.get("/", async (req, res) => {
  const qRaw = String(req.query.q || "").trim();
  if (qRaw.length < 1) {
    return res.json({ customers: [], vehicles: [], repairOrders: [], invoices: [], estimates: [], appointments: [] });
  }
  const q = `%${qRaw.replace(/[%_]/g, m => "\\" + m)}%`;
  const numeric = /^\d+$/.test(qRaw) ? Number(qRaw) : null;
  const LIMIT = 6;

  const [customers, vehicles, repairOrders, invoices, estimates, appointments] = await Promise.all([
    db
      .select({
        id: customersTable.id,
        firstName: customersTable.firstName,
        lastName: customersTable.lastName,
        email: customersTable.email,
        phone: customersTable.phone,
      })
      .from(customersTable)
      .where(
        or(
          ilike(customersTable.firstName, q),
          ilike(customersTable.lastName, q),
          ilike(sql`${customersTable.firstName} || ' ' || ${customersTable.lastName}`, q),
          ilike(customersTable.email, q),
          ilike(customersTable.phone, q),
        ),
      )
      .limit(LIMIT),

    db
      .select({
        id: vehiclesTable.id,
        year: vehiclesTable.year,
        make: vehiclesTable.make,
        model: vehiclesTable.model,
        licensePlate: vehiclesTable.licensePlate,
        vin: vehiclesTable.vin,
        fleetNumber: vehiclesTable.fleetNumber,
        customerId: vehiclesTable.customerId,
      })
      .from(vehiclesTable)
      .where(
        or(
          ilike(vehiclesTable.licensePlate, q),
          ilike(vehiclesTable.vin, q),
          ilike(vehiclesTable.fleetNumber, q),
          ilike(vehiclesTable.make, q),
          ilike(vehiclesTable.model, q),
        ),
      )
      .limit(LIMIT),

    db
      .select({
        id: repairOrdersTable.id,
        orderNumber: repairOrdersTable.orderNumber,
        status: repairOrdersTable.status,
        complaint: repairOrdersTable.complaint,
        customerId: repairOrdersTable.customerId,
        vehicleId: repairOrdersTable.vehicleId,
      })
      .from(repairOrdersTable)
      .where(
        or(
          ilike(repairOrdersTable.orderNumber, q),
          ilike(repairOrdersTable.complaint, q),
          ilike(repairOrdersTable.diagnosis, q),
          ilike(repairOrdersTable.notes, q),
        ),
      )
      .orderBy(desc(repairOrdersTable.createdAt))
      .limit(LIMIT),

    db
      .select({
        id: invoicesTable.id,
        invoiceNumber: invoicesTable.invoiceNumber,
        status: invoicesTable.status,
        total: invoicesTable.total,
      })
      .from(invoicesTable)
      .where(
        or(
          ilike(invoicesTable.invoiceNumber, q),
          ilike(invoicesTable.notes, q),
          ...(numeric != null ? [eq(invoicesTable.id, numeric)] : []),
        ),
      )
      .orderBy(desc(invoicesTable.createdAt))
      .limit(LIMIT),

    db
      .select({
        id: estimatesTable.id,
        estimateNumber: estimatesTable.estimateNumber,
        status: estimatesTable.status,
        total: estimatesTable.total,
      })
      .from(estimatesTable)
      .where(
        or(
          ilike(estimatesTable.estimateNumber, q),
          ilike(estimatesTable.notes, q),
          ...(numeric != null ? [eq(estimatesTable.id, numeric)] : []),
        ),
      )
      .orderBy(desc(estimatesTable.createdAt))
      .limit(LIMIT),

    db
      .select({
        id: appointmentsTable.id,
        serviceType: appointmentsTable.serviceType,
        scheduledAt: appointmentsTable.scheduledAt,
        status: appointmentsTable.status,
        customerId: appointmentsTable.customerId,
      })
      .from(appointmentsTable)
      .where(
        or(
          ilike(appointmentsTable.serviceType, q),
          ilike(appointmentsTable.description, q),
          ilike(appointmentsTable.notes, q),
        ),
      )
      .orderBy(desc(appointmentsTable.scheduledAt))
      .limit(LIMIT),
  ]);

  res.json({ customers, vehicles, repairOrders, invoices, estimates, appointments });
});

export default router;
