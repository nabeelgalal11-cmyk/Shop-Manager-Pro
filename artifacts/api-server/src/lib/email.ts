import { db, emailTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import nodemailer, { type Transporter } from "nodemailer";

const RESEND_API = "https://api.resend.com/emails";

let smtpTransporter: Transporter | null = null;
function getSmtpTransporter(): Transporter | null {
  if (smtpTransporter) return smtpTransporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || "465");
  smtpTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465 (SSL), false for 587 (STARTTLS)
    auth: { user, pass },
  });
  return smtpTransporter;
}

const cardWrap = (headerColor: string, headerTitle: string, body: string) => `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="background: ${headerColor}; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0;">${headerTitle}</h1>
  </div>
  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
    ${body}
  </div>
</body>
</html>`;

const DEFAULT_TEMPLATES = [
  {
    key: "appointment_confirmed",
    name: "Appointment Confirmation",
    subject: "Your appointment is confirmed - {{shopName}}",
    fromName: "ShopOS",
    fromEmail: process.env.SMTP_USER || "onboarding@resend.dev",
    enabled: "true",
    bodyHtml: `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="background: #f59e0b; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0;">Appointment Confirmed</h1>
  </div>
  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
    <p>Hi {{customerName}},</p>
    <p>Great news — your appointment with <strong>{{shopName}}</strong> has been confirmed.</p>
    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
      <tr><td style="padding: 8px 0; color: #6b7280;">Date & Time</td><td style="padding: 8px 0; font-weight: bold;">{{appointmentDateTime}}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280;">Service</td><td style="padding: 8px 0; font-weight: bold;">{{serviceType}}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280;">Vehicle</td><td style="padding: 8px 0; font-weight: bold;">{{vehicleInfo}}</td></tr>
    </table>
    <p>If you need to reschedule or have any questions, please reply to this email or call us.</p>
    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
      Thank you for choosing {{shopName}}!
    </p>
  </div>
</body>
</html>`,
  },
  {
    key: "invoice_sent",
    name: "Invoice Sent",
    subject: "Invoice {{invoiceNumber}} from {{shopName}}",
    fromName: "ShopOS",
    fromEmail: process.env.SMTP_USER || "onboarding@resend.dev",
    enabled: "true",
    bodyHtml: cardWrap("#2563eb", "Invoice Ready", `
    <p>Hi {{customerName}},</p>
    <p>Your invoice from <strong>{{shopName}}</strong> is ready.</p>
    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
      <tr><td style="padding: 8px 0; color: #6b7280;">Invoice #</td><td style="padding: 8px 0; font-weight: bold;">{{invoiceNumber}}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280;">Total</td><td style="padding: 8px 0; font-weight: bold;">{{total}}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280;">Balance Due</td><td style="padding: 8px 0; font-weight: bold;">{{balance}}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280;">Due Date</td><td style="padding: 8px 0; font-weight: bold;">{{dueDate}}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280;">Vehicle</td><td style="padding: 8px 0; font-weight: bold;">{{vehicleInfo}}</td></tr>
    </table>
    {{payLinkSection}}
    <p>Please reply to this email if you have any questions about the charges.</p>
    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
      Thank you for choosing {{shopName}}!
    </p>`),
  },
  {
    key: "estimate_sent",
    name: "Estimate Sent",
    subject: "Estimate {{estimateNumber}} from {{shopName}}",
    fromName: "ShopOS",
    fromEmail: process.env.SMTP_USER || "onboarding@resend.dev",
    enabled: "true",
    bodyHtml: cardWrap("#7c3aed", "Estimate Ready for Review", `
    <p>Hi {{customerName}},</p>
    <p>Your estimate from <strong>{{shopName}}</strong> is ready for your review.</p>
    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
      <tr><td style="padding: 8px 0; color: #6b7280;">Estimate #</td><td style="padding: 8px 0; font-weight: bold;">{{estimateNumber}}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280;">Total</td><td style="padding: 8px 0; font-weight: bold;">{{total}}</td></tr>
    </table>
    <p>Reply to this email to approve or with any questions.</p>
    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
      Thank you for choosing {{shopName}}!
    </p>`),
  },
  {
    key: "repair_order_completed",
    name: "Repair Order Completed",
    subject: "Your vehicle is ready for pickup - {{shopName}}",
    fromName: "ShopOS",
    fromEmail: process.env.SMTP_USER || "onboarding@resend.dev",
    enabled: "true",
    bodyHtml: cardWrap("#16a34a", "Your Vehicle Is Ready", `
    <p>Hi {{customerName}},</p>
    <p>Good news — work on your <strong>{{vehicleInfo}}</strong> is complete and your vehicle is ready for pickup.</p>
    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
      <tr><td style="padding: 8px 0; color: #6b7280;">Order #</td><td style="padding: 8px 0; font-weight: bold;">{{orderNumber}}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280;">Work Done</td><td style="padding: 8px 0; font-weight: bold;">{{diagnosis}}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280;">Mileage Out</td><td style="padding: 8px 0; font-weight: bold;">{{mileageOut}}</td></tr>
    </table>
    <p>Please give us a call or stop by during business hours to pick up your vehicle. An invoice will follow shortly if it hasn't already.</p>
    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
      Thanks for trusting {{shopName}} with your vehicle.
    </p>`),
  },
  {
    key: "service_reminder",
    name: "Service Reminder",
    subject: "Time for your {{serviceType}} - {{shopName}}",
    fromName: "ShopOS",
    fromEmail: process.env.SMTP_USER || "onboarding@resend.dev",
    enabled: "true",
    bodyHtml: cardWrap("#f59e0b", "Service Reminder", `
    <p>Hi {{customerName}},</p>
    <p>This is a friendly reminder from <strong>{{shopName}}</strong> that your <strong>{{vehicleInfo}}</strong> is due for service.</p>
    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
      <tr><td style="padding: 8px 0; color: #6b7280;">Service</td><td style="padding: 8px 0; font-weight: bold;">{{serviceType}}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280;">Due Date</td><td style="padding: 8px 0; font-weight: bold;">{{dueDate}}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280;">Due Mileage</td><td style="padding: 8px 0; font-weight: bold;">{{dueMileage}}</td></tr>
    </table>
    <p>Reply to this email or give us a call to schedule your appointment.</p>
    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
      {{shopName}}
    </p>`),
  },
  {
    key: "payment_received",
    name: "Payment Receipt",
    subject: "Payment received - {{shopName}}",
    fromName: "ShopOS",
    fromEmail: process.env.SMTP_USER || "onboarding@resend.dev",
    enabled: "true",
    bodyHtml: cardWrap("#0ea5e9", "Payment Received", `
    <p>Hi {{customerName}},</p>
    <p>We've received your payment — thank you!</p>
    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
      <tr><td style="padding: 8px 0; color: #6b7280;">Invoice #</td><td style="padding: 8px 0; font-weight: bold;">{{invoiceNumber}}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280;">Amount Paid</td><td style="padding: 8px 0; font-weight: bold;">{{amount}}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280;">Method</td><td style="padding: 8px 0; font-weight: bold;">{{method}}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280;">Reference</td><td style="padding: 8px 0; font-weight: bold;">{{referenceNumber}}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280;">Remaining Balance</td><td style="padding: 8px 0; font-weight: bold;">{{balance}}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280;">Paid On</td><td style="padding: 8px 0; font-weight: bold;">{{paidAt}}</td></tr>
    </table>
    <p>Keep this email as your receipt.</p>
    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
      Thank you for your business — {{shopName}}
    </p>`),
  },
];

export async function seedEmailTemplates() {
  for (const tpl of DEFAULT_TEMPLATES) {
    const [existing] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.key, tpl.key));
    if (!existing) {
      await db.insert(emailTemplatesTable).values(tpl);
      logger.info({ key: tpl.key }, "Seeded email template");
    } else if (
      tpl.key === "invoice_sent" &&
      !existing.bodyHtml.includes("{{payLinkSection}}") &&
      existing.bodyHtml.includes("</table>")
    ) {
      const upgraded = existing.bodyHtml.replace("</table>", "</table>\n    {{payLinkSection}}");
      await db.update(emailTemplatesTable).set({ bodyHtml: upgraded }).where(eq(emailTemplatesTable.key, tpl.key));
      logger.info({ key: tpl.key }, "Upgraded invoice_sent template with pay link section");
    }
  }
}

export interface AppointmentEmailVars {
  customerName: string;
  customerEmail: string;
  shopName: string;
  appointmentDateTime: string;
  serviceType: string;
  vehicleInfo: string;
  notes: string;
}

function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

export async function sendTemplatedEmail(
  templateKey: string,
  toEmail: string,
  vars: Record<string, string>,
): Promise<{ ok: boolean; error?: string; id?: string; provider?: string }> {
  const [tpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.key, templateKey));
  if (!tpl) return { ok: false, error: `Template ${templateKey} not found` };
  if (tpl.enabled !== "true") return { ok: false, error: "Template disabled" };

  const subject = render(tpl.subject, vars);
  const html = render(tpl.bodyHtml, vars);
  const fromName = tpl.fromName || "ShopOS";
  const fromEmailRaw = tpl.fromEmail || process.env.SMTP_FROM || process.env.SMTP_USER || "onboarding@resend.dev";
  const from = `${fromName} <${fromEmailRaw}>`;

  // Prefer Resend when configured (better Gmail deliverability than shared-host SMTP)
  const apiKey = process.env.RESEND_API_KEY;
  let resendError: string | undefined;
  if (apiKey) {
    try {
      const resp = await fetch(RESEND_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: [toEmail], subject, html, reply_to: fromEmailRaw }),
      });
      const data = (await resp.json()) as { id?: string; message?: string; name?: string };
      if (resp.ok) {
        logger.info({ id: data.id, to: toEmail, template: templateKey, provider: "resend" }, "Email sent");
        return { ok: true, id: data.id, provider: "resend" };
      }
      resendError = data.message || `HTTP ${resp.status}`;
      logger.error({ status: resp.status, data }, "Resend API error; will try SMTP fallback if available");
    } catch (err: any) {
      resendError = err?.message || "Send failed";
      logger.error({ err }, "Resend send threw; will try SMTP fallback if available");
    }
  }

  // Fallback to SMTP (HostGator etc.) when Resend not configured OR Resend just failed
  const transporter = getSmtpTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from,
        to: toEmail,
        subject,
        html,
        replyTo: fromEmailRaw,
        envelope: { from: fromEmailRaw, to: toEmail },
      });
      logger.info({ id: info.messageId, to: toEmail, template: templateKey, provider: "smtp" }, "Email sent");
      return { ok: true, id: info.messageId, provider: "smtp" };
    } catch (err: any) {
      logger.error({ err: err?.message, code: err?.code }, "SMTP send failed");
      return { ok: false, error: err?.message || "SMTP send failed", provider: "smtp" };
    }
  }

  if (resendError) return { ok: false, error: resendError, provider: "resend" };
  logger.warn("Neither RESEND_API_KEY nor SMTP_* configured; skipping email send");
  return { ok: false, error: "Email not configured" };
}
