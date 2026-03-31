import { Router, type IRouter } from "express";
import healthRouter from "./health";
import customersRouter from "./customers";
import vehiclesRouter from "./vehicles";
import employeesRouter from "./employees";
import repairOrdersRouter from "./repair_orders";
import estimatesRouter from "./estimates";
import invoicesRouter from "./invoices";
import paymentsRouter from "./payments";
import inventoryRouter from "./inventory";
import inspectionsRouter from "./inspections";
import appointmentsRouter from "./appointments";
import timeEntriesRouter from "./time_entries";
import expensesRouter from "./expenses";
import remindersRouter from "./reminders";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
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
