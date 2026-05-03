import { Router } from "express";
import archiver from "archiver";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requirePermission } from "../lib/auth.js";
import { csvRow, moneyCell, dateCell } from "../lib/csv.js";

const router: Router = Router();

router.use(requirePermission("reports", "view"));

interface DateRange {
  from: string | null;
  to: string | null;
}

function parseRange(req: any): DateRange {
  const from = (req.query.from as string | undefined) || null;
  const to = (req.query.to as string | undefined) || null;
  const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  return {
    from: from && isIso(from) ? from : null,
    to: to && isIso(to) ? to : null,
  };
}

function tsRange(range: DateRange) {
  return {
    fromTs: range.from ? new Date(range.from + "T00:00:00Z") : null,
    toTs: range.to ? new Date(range.to + "T23:59:59Z") : null,
  };
}

function rangeSuffix(range: DateRange): string {
  if (range.from && range.to) return `_${range.from}_to_${range.to}`;
  if (range.from) return `_from_${range.from}`;
  if (range.to) return `_to_${range.to}`;
  return "_all";
}

async function fetchInvoices(range: DateRange) {
  const { fromTs, toTs } = tsRange(range);
  const where = sql`
    WHERE status <> 'draft'
    ${fromTs ? sql`AND i.created_at >= ${fromTs}` : sql``}
    ${toTs ? sql`AND i.created_at <= ${toTs}` : sql``}
  `;
  const result = await db.execute(sql`
    SELECT
      i.invoice_number,
      i.created_at,
      i.due_date,
      i.status,
      i.subtotal,
      i.tax_amount,
      i.discount_amount,
      i.total,
      i.amount_paid,
      i.balance,
      c.first_name,
      c.last_name,
      c.email
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    ${where}
    ORDER BY i.created_at ASC
  `);
  return result.rows as any[];
}

async function fetchPayments(range: DateRange) {
  const { fromTs, toTs } = tsRange(range);
  const where = sql`
    WHERE p.status = 'succeeded'
    ${fromTs ? sql`AND p.paid_at >= ${fromTs}` : sql``}
    ${toTs ? sql`AND p.paid_at <= ${toTs}` : sql``}
  `;
  const result = await db.execute(sql`
    SELECT
      p.id,
      p.paid_at,
      p.amount,
      p.method,
      p.reference_number,
      p.stripe_payment_intent_id,
      i.invoice_number,
      c.first_name,
      c.last_name
    FROM payments p
    LEFT JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN customers c ON c.id = i.customer_id
    ${where}
    ORDER BY p.paid_at ASC
  `);
  return result.rows as any[];
}

async function fetchExpenses(range: DateRange) {
  const where = sql`
    WHERE 1=1
    ${range.from ? sql`AND expense_date >= ${range.from}` : sql``}
    ${range.to ? sql`AND expense_date <= ${range.to}` : sql``}
  `;
  const result = await db.execute(sql`
    SELECT
      expense_date,
      category,
      vendor,
      description,
      receipt_number,
      amount,
      notes
    FROM expenses
    ${where}
    ORDER BY expense_date ASC, id ASC
  `);
  return result.rows as any[];
}

async function fetchCogsJournal(range: DateRange) {
  const { fromTs, toTs } = tsRange(range);
  const where = sql`
    WHERE reason IN ('ro_consumed','invoice_consumed','ro_unconsumed','invoice_unconsumed')
    ${fromTs ? sql`AND created_at >= ${fromTs}` : sql``}
    ${toTs ? sql`AND created_at <= ${toTs}` : sql``}
  `;
  const result = await db.execute(sql`
    SELECT
      DATE(created_at) AS journal_date,
      COALESCE(SUM((-delta) * COALESCE(unit_cost, 0)), 0)::numeric AS cogs_amount,
      COUNT(*)::int AS movement_count
    FROM stock_movements
    ${where}
    GROUP BY DATE(created_at)
    HAVING COALESCE(SUM((-delta) * COALESCE(unit_cost, 0)), 0) <> 0
    ORDER BY journal_date ASC
  `);
  return result.rows as any[];
}

const INVOICE_HEADERS = [
  "InvoiceNo",
  "Customer",
  "InvoiceDate",
  "DueDate",
  "Status",
  "Subtotal",
  "Tax",
  "Discount",
  "Total",
  "AmountPaid",
  "Balance",
  "Email",
];

function customerName(row: any): string {
  return `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
}

function invoiceCsvRows(rows: any[]): string[] {
  return rows.map((r) => csvRow([
    r.invoice_number,
    customerName(r),
    dateCell(r.created_at),
    dateCell(r.due_date),
    r.status,
    moneyCell(r.subtotal),
    moneyCell(r.tax_amount),
    moneyCell(r.discount_amount),
    moneyCell(r.total),
    moneyCell(r.amount_paid),
    moneyCell(r.balance),
    r.email ?? "",
  ]));
}

const PAYMENT_HEADERS = [
  "PaymentId",
  "PaymentDate",
  "Customer",
  "InvoiceNo",
  "Amount",
  "Method",
  "Reference",
  "StripePaymentIntent",
];

function paymentCsvRows(rows: any[]): string[] {
  return rows.map((r) => csvRow([
    r.id,
    dateCell(r.paid_at),
    customerName(r),
    r.invoice_number ?? "",
    moneyCell(r.amount),
    r.method ?? "",
    r.reference_number ?? "",
    r.stripe_payment_intent_id ?? "",
  ]));
}

const EXPENSE_HEADERS = [
  "Date",
  "Category",
  "Vendor",
  "Description",
  "ReferenceNo",
  "Amount",
  "Memo",
];

function expenseCsvRows(rows: any[]): string[] {
  return rows.map((r) => csvRow([
    dateCell(r.expense_date),
    r.category ?? "",
    r.vendor ?? "",
    r.description ?? "",
    r.receipt_number ?? "",
    moneyCell(r.amount),
    r.notes ?? "",
  ]));
}

const COGS_HEADERS = [
  "Date",
  "Account",
  "Debit",
  "Credit",
  "Memo",
];

function cogsCsvRows(rows: any[]): string[] {
  // Standard COGS journal entry per day:
  //   Debit  Cost of Goods Sold
  //   Credit Inventory Asset
  const out: string[] = [];
  for (const r of rows) {
    const amount = moneyCell(r.cogs_amount);
    const memo = `Parts consumed (${r.movement_count} movements)`;
    out.push(csvRow([dateCell(r.journal_date), "Cost of Goods Sold", amount, "0.00", memo]));
    out.push(csvRow([dateCell(r.journal_date), "Inventory Asset", "0.00", amount, memo]));
  }
  return out;
}

function setCsvHeaders(res: any, filename: string) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
}

router.get("/invoices.csv", async (req, res) => {
  const range = parseRange(req);
  const rows = await fetchInvoices(range);
  setCsvHeaders(res, `invoices${rangeSuffix(range)}.csv`);
  res.write(csvRow(INVOICE_HEADERS));
  for (const line of invoiceCsvRows(rows)) res.write(line);
  res.end();
});

router.get("/payments.csv", async (req, res) => {
  const range = parseRange(req);
  const rows = await fetchPayments(range);
  setCsvHeaders(res, `payments${rangeSuffix(range)}.csv`);
  res.write(csvRow(PAYMENT_HEADERS));
  for (const line of paymentCsvRows(rows)) res.write(line);
  res.end();
});

router.get("/expenses.csv", async (req, res) => {
  const range = parseRange(req);
  const rows = await fetchExpenses(range);
  setCsvHeaders(res, `expenses${rangeSuffix(range)}.csv`);
  res.write(csvRow(EXPENSE_HEADERS));
  for (const line of expenseCsvRows(rows)) res.write(line);
  res.end();
});

router.get("/cogs-journal.csv", async (req, res) => {
  const range = parseRange(req);
  const rows = await fetchCogsJournal(range);
  setCsvHeaders(res, `cogs-journal${rangeSuffix(range)}.csv`);
  res.write(csvRow(COGS_HEADERS));
  for (const line of cogsCsvRows(rows)) res.write(line);
  res.end();
});

// Bundle all four CSVs into a single ZIP for one-click download.
router.get("/bookkeeping.zip", async (req, res) => {
  const range = parseRange(req);
  const suffix = rangeSuffix(range);
  const filename = `bookkeeping${suffix}.zip`;

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("warning", (err) => req.log?.warn({ err }, "zip warning"));
  archive.on("error", (err) => {
    req.log?.error({ err }, "zip error");
    try { res.destroy(err); } catch { /* noop */ }
  });
  archive.pipe(res);

  const [invoices, payments, expenses, cogs] = await Promise.all([
    fetchInvoices(range),
    fetchPayments(range),
    fetchExpenses(range),
    fetchCogsJournal(range),
  ]);

  const invoicesCsv = csvRow(INVOICE_HEADERS) + invoiceCsvRows(invoices).join("");
  const paymentsCsv = csvRow(PAYMENT_HEADERS) + paymentCsvRows(payments).join("");
  const expensesCsv = csvRow(EXPENSE_HEADERS) + expenseCsvRows(expenses).join("");
  const cogsCsv = csvRow(COGS_HEADERS) + cogsCsvRows(cogs).join("");

  archive.append(invoicesCsv, { name: `invoices${suffix}.csv` });
  archive.append(paymentsCsv, { name: `payments${suffix}.csv` });
  archive.append(expensesCsv, { name: `expenses${suffix}.csv` });
  archive.append(cogsCsv, { name: `cogs-journal${suffix}.csv` });

  await archive.finalize();
});

export default router;
