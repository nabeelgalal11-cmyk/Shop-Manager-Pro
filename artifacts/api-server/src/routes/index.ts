import { Router, type IRouter } from "express";

import healthRouter from "./health.js";
import customersRouter from "./customers.js";
import vehiclesRouter from "./vehicles.js";
import employeesRouter from "./employees.js";
import repairOrdersRouter from "./repair_orders.js";
import estimatesRouter from "./estimates.js";
import invoicesRouter from "./invoices.js";
import paymentsRouter from "./payments.js";
import inventoryRouter from "./inventory.js";
import inspectionsRouter from "./inspections.js";
import appointmentsRouter from "./appointments.js";
import timeEntriesRouter from "./time_entries.js";
import expensesRouter from "./expenses.js";
import remindersRouter from "./reminders.js";
import dashboardRouter from "./dashboard.js";

const router: IRouter = Router();

// register routes
router.use("/health", healthRouter);
router.use("/customers", customersRouter);
router.use("/vehicles", vehiclesRouter);
router.use("/employees", employeesRouter);
router.use("/repair-orders", repairOrdersRouter);
router.use("/estimates", estimatesRouter);
router.use("/invoices", invoicesRouter);
router.use("/payments", paymentsRouter);
router.use("/inventory", inventoryRouter);
router.use("/inspections", inspectionsRouter);
router.use("/appointments", appointmentsRouter);
router.use("/time-entries", timeEntriesRouter);
router.use("/expenses", expensesRouter);
router.use("/reminders", remindersRouter);
router.use("/dashboard", dashboardRouter);

export default router;