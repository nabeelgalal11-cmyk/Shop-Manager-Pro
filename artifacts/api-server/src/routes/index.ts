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
import aiEstimateRouter from "./ai-estimate.js";
import customerCategoriesRouter from "./customer-categories.js";
import usedCarsRouter from "./used-cars.js";
import reportsRouter from "./reports.js";
import storageRouter from "./storage.js";
import purchasesRouter from "./purchases.js";
import njmvcRouter from "./njmvc.js";
import authRouter from "./auth.js";
import usersRouter from "./users.js";
import permissionsRouter from "./permissions.js";
import { requireAuth } from "../lib/auth.js";
import publicRouter from "./public.js";
import emailTemplatesRouter from "./email_templates.js";
import notificationsRouter from "./notifications.js";
import searchRouter from "./search.js";

const router: IRouter = Router();

// PUBLIC routes (no auth required)
router.use("/health", healthRouter);
router.use("/auth", authRouter);
router.use("/public", publicRouter);

// All routes below this point require authentication
router.use(requireAuth);

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
router.use("/ai-estimate", aiEstimateRouter);
router.use("/customer-categories", customerCategoriesRouter);
router.use("/used-cars", usedCarsRouter);
router.use("/reports", reportsRouter);
router.use(storageRouter);
router.use("/purchases", purchasesRouter);
router.use("/njmvc", njmvcRouter);
router.use("/users", usersRouter);
router.use("/permissions", permissionsRouter);
router.use("/email-templates", emailTemplatesRouter);
router.use("/notifications", notificationsRouter);
router.use("/search", searchRouter);

export default router;