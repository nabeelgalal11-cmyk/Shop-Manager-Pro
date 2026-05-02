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
];

export async function seedEmailTemplates() {
  for (const tpl of DEFAULT_TEMPLATES) {
    const [existing] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.key, tpl.key));
    if (!existing) {
      await db.insert(emailTemplatesTable).values(tpl);
      logger.info({ key: tpl.key }, "Seeded email template");
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
      if (!resp.ok) {
        logger.error({ status: resp.status, data }, "Resend API error");
        return { ok: false, error: data.message || `HTTP ${resp.status}`, provider: "resend" };
      }
      logger.info({ id: data.id, to: toEmail, template: templateKey, provider: "resend" }, "Email sent");
      return { ok: true, id: data.id, provider: "resend" };
    } catch (err: any) {
      logger.error({ err }, "Failed to send email via Resend");
      return { ok: false, error: err?.message || "Send failed", provider: "resend" };
    }
  }

  // Fallback to SMTP (HostGator etc.) when Resend not configured
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

  logger.warn("Neither RESEND_API_KEY nor SMTP_* configured; skipping email send");
  return { ok: false, error: "Email not configured" };
}
