import { Router } from "express";
import { db, emailTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendTemplatedEmail } from "../lib/email.js";
import { requireRole } from "../lib/auth.js";

const router: Router = Router();

// Only admins can view, edit, or test-send email templates
router.use(requireRole("admin"));

router.get("/", async (_req, res) => {
  const rows = await db.select().from(emailTemplatesTable).orderBy(emailTemplatesTable.key);
  res.json(rows);
});

router.get("/:key", async (req, res) => {
  const [tpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.key, req.params.key));
  if (!tpl) return res.status(404).json({ error: "Template not found" });
  res.json(tpl);
});

router.put("/:key", async (req, res) => {
  const { name, subject, bodyHtml, fromName, fromEmail, enabled } = req.body;
  const [tpl] = await db
    .update(emailTemplatesTable)
    .set({
      name,
      subject,
      bodyHtml,
      fromName: fromName || null,
      fromEmail: fromEmail || null,
      enabled: enabled === false || enabled === "false" ? "false" : "true",
      updatedAt: new Date(),
    })
    .where(eq(emailTemplatesTable.key, req.params.key))
    .returning();
  if (!tpl) return res.status(404).json({ error: "Template not found" });
  res.json(tpl);
});

router.post("/:key/test", async (req, res) => {
  const { to } = req.body as { to?: string };
  if (!to) return res.status(400).json({ error: "Recipient email is required" });
  const result = await sendTemplatedEmail(req.params.key, to, {
    customerName: "Test Customer",
    customerEmail: to,
    shopName: "Your Shop",
    appointmentDateTime: new Date().toLocaleString(),
    serviceType: "Sample Service",
    vehicleInfo: "2020 Bluebird Vision",
    notes: "This is a test email.",
  });
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

export default router;
