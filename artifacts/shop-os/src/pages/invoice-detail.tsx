import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInvoice, getGetInvoiceQueryKey, getGetRepairOrderQueryKey,
  useCreatePayment,
  useIssueWorkflowInvoice,
  useSendWorkflowInvoiceEmail,
  useVoidWorkflowInvoice,
  useRefundWorkflowPayment,
  useVoidWorkflowPayment,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Printer, CreditCard, CheckCircle, XCircle, Link, Mail, AlertTriangle } from "lucide-react";
import { ActivityTimeline } from "@/components/activity-timeline";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useShopSettings } from "@/hooks/use-shop-settings";

export default function InvoiceDetail() {
  const [match, params] = useRoute("/invoices/:id");
  const id = match ? parseInt(params.id) : 0;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [paymentAttemptKey, setPaymentAttemptKey] = useState(() => crypto.randomUUID());

  const [voidInvoiceOpen, setVoidInvoiceOpen] = useState(false);
  const [voidInvoiceReason, setVoidInvoiceReason] = useState("");

  const [reversalOpen, setReversalOpen] = useState<{ id: number; action: "refund" | "void"; amount: string } | null>(null);
  const [reversalAmount, setReversalAmount] = useState("");
  const [reversalReason, setReversalReason] = useState("");

  const { data: invoice, isLoading } = useGetInvoice(id, {
    query: { enabled: !!id, queryKey: getGetInvoiceQueryKey(id) },
  });
  const { data: shop } = useShopSettings();

  const issueInvoice = useIssueWorkflowInvoice();
  const sendInvoiceEmail = useSendWorkflowInvoiceEmail();
  const voidInvoice = useVoidWorkflowInvoice();
  const createPayment = useCreatePayment({
    request: { headers: { "Idempotency-Key": paymentAttemptKey } }
  });
  const refundPayment = useRefundWorkflowPayment();
  const voidPayment = useVoidWorkflowPayment();

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);

  const handlePrint = () => {
    if (!invoice) return;

    const escapeHtml = (value: unknown) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    const formatDate = (value?: string | null) =>
      value ? new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";
    const snapshot = (invoice.customerSnapshot || {}) as Record<string, unknown>;
    const vehicleSnapshot = (invoice.vehicleSnapshot || {}) as Record<string, unknown>;
    const customerName = [snapshot.firstName, snapshot.lastName].filter(Boolean).join(" ") || "Customer";
    const vehicleName = [
      vehicleSnapshot.year,
      vehicleSnapshot.make,
      vehicleSnapshot.model,
    ].filter(Boolean).join(" ");
    const vehicleDetails = [
      vehicleName,
      vehicleSnapshot.licensePlate ? `Plate: ${vehicleSnapshot.licensePlate}` : "",
      vehicleSnapshot.vin ? `VIN: ${vehicleSnapshot.vin}` : "",
    ].filter(Boolean);
    const shopAddressHtml = shopAddress.map(escapeHtml).join("<br />");
    const shopContactText = shopContact.map(escapeHtml).join(" • ");
    const itemRows = (invoice.items || []).map((item) => `
      <tr>
        <td class="description">
          <strong>${escapeHtml(item.description)}</strong>
          <span>${escapeHtml(String(item.kind).replace("_", " "))}</span>
        </td>
        <td class="number">${escapeHtml(item.quantity)}</td>
        <td class="number">${escapeHtml(formatCurrency(Number(item.unitPrice)))}</td>
        <td class="number amount">${escapeHtml(formatCurrency(Number(item.lineTotal)))}</td>
      </tr>
    `).join("");
    const statusLabel = invoice.status.replace("_", " ");
    const invoiceDate = invoice.issuedAt || invoice.createdAt;
    const balanceClass = balance > 0 ? "balance-due" : "balance-paid";

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
          <style>
            :root { color-scheme: light; }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              background: #f3f5f8;
              color: #172033;
              font-family: Arial, Helvetica, sans-serif;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .invoice {
              max-width: 820px;
              margin: 32px auto;
              padding: 48px 52px;
              background: #fff;
              box-shadow: 0 8px 30px rgba(23, 32, 51, 0.10);
            }
            .header {
              display: flex;
              justify-content: space-between;
              gap: 32px;
              padding-bottom: 28px;
              border-bottom: 3px solid #1f5eff;
            }
            .brand-name {
              margin: 0 0 8px;
              color: #172033;
              font-size: 22px;
              font-weight: 700;
              letter-spacing: -0.02em;
            }
            .shop-details, .contact-details {
              color: #667085;
              font-size: 11px;
              line-height: 1.7;
            }
            .invoice-heading { text-align: right; }
            .invoice-label {
              margin: 0;
              color: #1f5eff;
              font-size: 12px;
              font-weight: 700;
              letter-spacing: 0.16em;
            }
            .invoice-number {
              margin: 7px 0 14px;
              color: #172033;
              font-size: 25px;
              font-weight: 700;
            }
            .status {
              display: inline-block;
              padding: 5px 10px;
              border-radius: 999px;
              background: #eaf0ff;
              color: #1f5eff;
              font-size: 10px;
              font-weight: 700;
              letter-spacing: 0.08em;
              text-transform: uppercase;
            }
            .info-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 16px;
              margin: 30px 0;
            }
            .info-card {
              min-height: 102px;
              padding: 16px 18px;
              border: 1px solid #e4e7ec;
              border-radius: 8px;
              background: #fafbfc;
            }
            .info-label {
              margin: 0 0 9px;
              color: #667085;
              font-size: 10px;
              font-weight: 700;
              letter-spacing: 0.11em;
              text-transform: uppercase;
            }
            .info-value {
              margin: 0;
              color: #172033;
              font-size: 13px;
              font-weight: 700;
              line-height: 1.5;
            }
            .info-subvalue {
              margin: 3px 0 0;
              color: #667085;
              font-size: 11px;
              line-height: 1.5;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              font-size: 12px;
            }
            thead { display: table-header-group; }
            th {
              padding: 10px 12px;
              border-bottom: 1px solid #d0d5dd;
              color: #667085;
              font-size: 10px;
              font-weight: 700;
              letter-spacing: 0.08em;
              text-align: left;
              text-transform: uppercase;
            }
            td {
              padding: 14px 12px;
              border-bottom: 1px solid #eaecf0;
              vertical-align: top;
            }
            th:first-child, td:first-child { padding-left: 0; }
            th:last-child, td:last-child { padding-right: 0; }
            .description strong { display: block; color: #172033; font-size: 12px; }
            .description span {
              display: block;
              margin-top: 4px;
              color: #98a2b3;
              font-size: 10px;
              text-transform: capitalize;
            }
            .number { text-align: right; white-space: nowrap; }
            .amount { color: #172033; font-weight: 700; }
            .summary {
              display: flex;
              justify-content: flex-end;
              margin-top: 26px;
            }
            .totals { width: 270px; font-size: 12px; }
            .total-row {
              display: flex;
              justify-content: space-between;
              gap: 20px;
              padding: 6px 0;
              color: #667085;
            }
            .total-row strong { color: #172033; }
            .grand-total {
              display: flex;
              justify-content: space-between;
              gap: 20px;
              margin: 8px 0 5px;
              padding: 12px 0;
              border-top: 1px solid #d0d5dd;
              border-bottom: 1px solid #d0d5dd;
              color: #172033;
              font-size: 15px;
              font-weight: 700;
            }
            .paid { color: #039855; }
            .balance-due {
              display: flex;
              justify-content: space-between;
              gap: 20px;
              margin-top: 8px;
              padding: 12px 14px;
              border-radius: 6px;
              background: #172033;
              color: #fff;
              font-size: 13px;
              font-weight: 700;
            }
            .balance-paid {
              display: flex;
              justify-content: space-between;
              gap: 20px;
              margin-top: 8px;
              padding: 12px 14px;
              border-radius: 6px;
              background: #ecfdf3;
              color: #027a48;
              font-size: 13px;
              font-weight: 700;
            }
            .notes {
              margin-top: 34px;
              padding-top: 16px;
              border-top: 1px solid #eaecf0;
              color: #667085;
              font-size: 11px;
              line-height: 1.6;
              white-space: pre-line;
            }
            .footer {
              margin-top: 42px;
              padding-top: 18px;
              border-top: 1px solid #eaecf0;
              color: #98a2b3;
              font-size: 10px;
              line-height: 1.6;
              text-align: center;
            }
            @page { size: auto; margin: 0.5in; }
            @media print {
              body { background: #fff; }
              .invoice { max-width: none; margin: 0; padding: 0; box-shadow: none; }
            }
            @media (max-width: 640px) {
              .invoice { margin: 0; padding: 24px; }
              .header { display: block; }
              .invoice-heading { margin-top: 24px; text-align: left; }
              .info-grid { grid-template-columns: 1fr; }
            }
          </style>
        </head>
        <body>
          <main class="invoice">
            <header class="header">
              <div>
                <h1 class="brand-name">${escapeHtml(shop?.shopName || "915motors")}</h1>
                ${shopAddressHtml ? `<div class="shop-details">${shopAddressHtml}</div>` : ""}
                ${shopContactText ? `<div class="contact-details">${shopContactText}</div>` : ""}
                ${shop?.ein ? `<div class="contact-details">Tax ID: ${escapeHtml(shop.ein)}</div>` : ""}
              </div>
              <div class="invoice-heading">
                <p class="invoice-label">Invoice</p>
                <p class="invoice-number">${escapeHtml(invoice.invoiceNumber)}</p>
                <span class="status">${escapeHtml(statusLabel)}</span>
              </div>
            </header>

            <section class="info-grid">
              <div class="info-card">
                <p class="info-label">Bill to</p>
                <p class="info-value">${escapeHtml(customerName)}</p>
                ${snapshot.email ? `<p class="info-subvalue">${escapeHtml(snapshot.email)}</p>` : ""}
                ${snapshot.phone ? `<p class="info-subvalue">${escapeHtml(snapshot.phone)}</p>` : ""}
              </div>
              <div class="info-card">
                <p class="info-label">Invoice details</p>
                <p class="info-subvalue">Issued <strong>${escapeHtml(formatDate(invoiceDate))}</strong></p>
                ${invoice.repairOrderId ? `<p class="info-subvalue">Repair order <strong>#${escapeHtml(invoice.repairOrderId)}</strong></p>` : ""}
                ${vehicleDetails.length > 0 ? `<p class="info-subvalue">${vehicleDetails.map(escapeHtml).join(" • ")}</p>` : ""}
              </div>
            </section>

            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th class="number">Qty</th>
                  <th class="number">Unit price</th>
                  <th class="number">Amount</th>
                </tr>
              </thead>
              <tbody>${itemRows || `<tr><td colspan="4" style="padding: 22px 0; color: #98a2b3;">No line items</td></tr>`}</tbody>
            </table>

            <section class="summary">
              <div class="totals">
                <div class="total-row"><span>Subtotal</span><strong>${escapeHtml(formatCurrency(Number(invoice.subtotal)))}</strong></div>
                <div class="total-row"><span>Tax</span><strong>${escapeHtml(formatCurrency(Number(invoice.taxAmount)))}</strong></div>
                <div class="grand-total"><span>Total</span><span>${escapeHtml(formatCurrency(Number(invoice.total)))}</span></div>
                <div class="total-row paid"><span>Amount paid</span><strong class="paid">${escapeHtml(formatCurrency(Number(invoice.amountPaid)))}</strong></div>
                <div class="${balanceClass}"><span>${balance > 0 ? "Balance due" : "Paid in full"}</span><span>${escapeHtml(formatCurrency(balance))}</span></div>
              </div>
            </section>

            ${invoice.notes ? `<div class="notes"><strong>Notes</strong><br />${escapeHtml(invoice.notes)}</div>` : ""}
            <footer class="footer">
              ${shop?.additionalInfo ? `<div>${escapeHtml(shop.additionalInfo)}</div>` : ""}
              <div>${shop?.shopName ? escapeHtml(shop.shopName) : "915motors"}${shopContactText ? ` • ${shopContactText}` : ""}</div>
              <div>Thank you for your business.</div>
            </footer>
          </main>
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  const handleIssue = () => {
    issueInvoice.mutate(
      { id },
      {
        onSuccess: async (result) => {
          queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
          if (invoice?.repairOrderId) queryClient.invalidateQueries({ queryKey: getGetRepairOrderQueryKey(invoice.repairOrderId) });
          if (result.paymentUrl) {
            await navigator.clipboard.writeText(result.paymentUrl);
            toast({ title: "Invoice issued", description: "Secure payment link copied to clipboard." });
          } else {
            toast({ title: "Invoice issued", description: "PUBLIC_BASE_URL is not configured, so no payment link was created." });
          }
        },
        onError: (err: any) => toast({ title: "Failed to issue invoice", description: err.message, variant: "destructive" }),
      }
    );
  };

  const handleVoidInvoice = () => {
    if (!voidInvoiceReason.trim()) return toast({ title: "Reason required", variant: "destructive" });
    voidInvoice.mutate(
      { id, data: { reason: voidInvoiceReason } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
          if (invoice?.repairOrderId) queryClient.invalidateQueries({ queryKey: getGetRepairOrderQueryKey(invoice.repairOrderId) });
          toast({ title: "Invoice voided" });
          setVoidInvoiceOpen(false);
        },
        onError: (err: any) => toast({ title: "Failed to void invoice", description: err.message, variant: "destructive" }),
      }
    );
  };

  const handleRecordPayment = () => {
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    createPayment.mutate(
      {
        data: {
          invoiceId: id,
          amount: String(amount),
          method: payMethod,
          attemptKey: paymentAttemptKey,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
          if (invoice?.repairOrderId) queryClient.invalidateQueries({ queryKey: getGetRepairOrderQueryKey(invoice.repairOrderId) });
          toast({ title: "Payment recorded successfully" });
          setPaymentOpen(false);
          setPayAmount("");
          setPayMethod("cash");
          setPaymentAttemptKey(crypto.randomUUID());
        },
        onError: (err: any) => toast({ title: "Failed to record payment", description: err.message, variant: "destructive" }),
      }
    );
  };

  const handleSendInvoiceEmail = () => {
    sendInvoiceEmail.mutate(
      { id },
      {
        onSuccess: (result: any) => {
          if (result.emailSent) {
            toast({ title: "Invoice emailed", description: "The invoice was sent to the customer." });
          } else {
            toast({ title: "Invoice was not emailed", description: result.emailError || "Copy the payment link and send it manually.", variant: "destructive" });
          }
        },
        onError: (err: any) => toast({ title: "Failed to email invoice", description: err.message, variant: "destructive" }),
      },
    );
  };

  const handleReversal = () => {
    if (!reversalOpen) return;
    const amount = parseFloat(reversalAmount);
    if (!amount || amount <= 0) {
      return toast({ title: "Enter a valid amount", variant: "destructive" });
    }
    if (!reversalReason.trim()) {
      return toast({ title: "Reason required", variant: "destructive" });
    }

    const payload = {
      id: reversalOpen.id,
      data: { amount: String(amount), reason: reversalReason },
    };

    const mutation = reversalOpen.action === "refund" ? refundPayment : voidPayment;

    mutation.mutate(payload as any, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
        if (invoice?.repairOrderId) queryClient.invalidateQueries({ queryKey: getGetRepairOrderQueryKey(invoice.repairOrderId) });
        toast({ title: `Payment ${reversalOpen.action === 'refund' ? 'refunded' : 'voided'}` });
        setReversalOpen(null);
        setReversalAmount("");
        setReversalReason("");
      },
      onError: (err: any) => toast({ title: `Failed to ${reversalOpen.action}`, description: err.message, variant: "destructive" }),
    });
  };

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!invoice) return <div className="p-8 text-center">Invoice not found</div>;

  const balance = Number(invoice.balance ?? 0);
  const isDraft = invoice.status === "draft";
  const isVoid = invoice.status === "void";
  const shopAddress = [
    shop?.addressLine1,
    shop?.addressLine2,
    [shop?.city, shop?.state, shop?.postalCode].filter(Boolean).join(", "),
  ].filter(Boolean);
  const shopContact = [shop?.phone, shop?.email, shop?.website].filter(Boolean);

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/invoices")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Invoice {invoice.invoiceNumber}</h1>
            <Badge
              variant={invoice.status === "paid" ? "default" : isVoid ? "destructive" : "secondary"}
              className="mt-1 capitalize"
            >
              {invoice.status.replace("_", " ")}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
          {isDraft && (
            <Button onClick={handleIssue} disabled={issueInvoice.isPending} className="bg-blue-600 hover:bg-blue-700">
              <CheckCircle className="h-4 w-4 mr-2" /> Issue Invoice
            </Button>
          )}
          {!isDraft && !isVoid && invoice.publicToken && (
            <Button variant="outline" onClick={async () => {
              const paymentUrl = `${window.location.origin}/pay/${invoice.publicToken}`;
              await navigator.clipboard.writeText(paymentUrl);
              toast({ title: "Payment link copied" });
            }}>
              <Link className="h-4 w-4 mr-2" /> Copy Pay Link
            </Button>
          )}
          {!isDraft && !isVoid && (
            <Button variant="outline" onClick={handleSendInvoiceEmail} disabled={sendInvoiceEmail.isPending}>
              <Mail className="h-4 w-4 mr-2" /> {sendInvoiceEmail.isPending ? "Emailing…" : "Email invoice"}
            </Button>
          )}
          {!isDraft && !isVoid && invoice.status !== 'paid' && balance > 0 && (
            <Button onClick={() => setPaymentOpen(true)}>
              <CreditCard className="h-4 w-4 mr-2" /> Record Payment
            </Button>
          )}
          {!isVoid && (
            <Button variant="destructive" onClick={() => setVoidInvoiceOpen(true)} disabled={voidInvoice.isPending}>
              <XCircle className="h-4 w-4 mr-2" /> Void
            </Button>
          )}
        </div>
      </div>

      <Card className="shadow-sm border-border">
        <CardContent className="p-8">
          <div className="flex justify-between items-start mb-8">
            <div>
              <h2 className="text-lg font-bold mb-2">{shop?.shopName || "915motors"}</h2>
              {shopAddress.length > 0 && <p className="text-sm text-muted-foreground">{shopAddress.map((line, index) => <span key={index}>{index > 0 && <br />}{line}</span>)}</p>}
              {shopContact.length > 0 && <p className="text-xs text-muted-foreground mt-2">{shopContact.join(" • ")}</p>}
              {shop?.ein && <p className="text-xs text-muted-foreground mt-1">Tax ID: {shop.ein}</p>}
              {shop?.additionalInfo && <p className="text-xs text-muted-foreground mt-1 whitespace-pre-line">{shop.additionalInfo}</p>}
            </div>
            <div className="text-right">
              <h3 className="font-semibold text-lg mb-2">Bill To</h3>
              <p className="text-sm font-medium">{(invoice.customerSnapshot as any)?.firstName} {(invoice.customerSnapshot as any)?.lastName}</p>
              <p className="text-xs text-muted-foreground mt-2">
                Date: {new Date(invoice.createdAt || Date.now()).toLocaleDateString()}
              </p>
            </div>
          </div>

          <Separator className="my-6" />

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.items?.map(item => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.description}</TableCell>
                  <TableCell className="capitalize">{item.kind}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(Number(item.unitPrice))}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(Number(item.lineTotal))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-8 flex justify-end">
            <div className="w-64 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(Number(invoice.subtotal))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax</span>
                <span>{formatCurrency(Number(invoice.taxAmount))}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-lg">
                <span>Total</span>
                <span>{formatCurrency(Number(invoice.total))}</span>
              </div>
              <div className="flex justify-between text-sm text-green-600">
                <span>Amount Paid</span>
                <span>{formatCurrency(Number(invoice.amountPaid))}</span>
              </div>
              <div className={`flex justify-between font-bold ${balance > 0 ? "text-destructive" : "text-green-600"}`}>
                <span>Balance Due</span>
                <span>{formatCurrency(balance)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {invoice.payments && invoice.payments.length > 0 && (
       <Card className="shadow-sm border-border">
          <CardContent className="p-6">
            <h3 className="font-semibold mb-3">Payment history</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.payments.map((p) => {
                  const isSucceeded = p.status === "succeeded";
                  return (
                    <TableRow key={p.id}>
                      <TableCell>{new Date(p.createdAt).toLocaleString()}</TableCell>
                      <TableCell className="capitalize">{p.method}</TableCell>
                      <TableCell>
                        <Badge variant={isSucceeded ? "default" : "destructive"} className="text-xs">
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(Number(p.amount))}
                      </TableCell>
                      <TableCell className="text-right">
                        {isSucceeded && (
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => {
                              setReversalAmount(String(p.amount));
                              setReversalOpen({ id: p.id, action: "refund", amount: String(p.amount) });
                            }}>Refund</Button>
                            <Button variant="outline" size="sm" onClick={() => {
                              setReversalAmount(String(p.amount));
                              setReversalOpen({ id: p.id, action: "void", amount: String(p.amount) });
                            }}>{invoice.status === "paid" ? "Void & reopen" : "Void"}</Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {invoice.status === "paid" && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Invoice is marked paid</AlertTitle>
          <AlertDescription>
            If this payment was entered by mistake before confirming it in Square, use <strong>Void & reopen</strong> next to that payment. This creates a reversal and reopens the invoice without deleting the payment history.
          </AlertDescription>
        </Alert>
      )}

      {/* Record Payment Dialog */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              Balance due: <strong>{formatCurrency(balance)}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount ($)</Label>
              <Input
                id="pay-amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder={String(balance.toFixed(2))}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Method</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Credit / Debit Card</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {payMethod === "card" && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Use Square on the phone for card payments</AlertTitle>
                <AlertDescription>
                  Open the 915motors mobile app, tap <strong>Take payment</strong>, and complete the payment in Square Point of Sale. Only use this manual option after Square confirms the card payment.
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button>
            <Button onClick={handleRecordPayment} disabled={createPayment.isPending}>
              {createPayment.isPending ? "Saving..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Invoice Dialog */}
      <Dialog open={voidInvoiceOpen} onOpenChange={setVoidInvoiceOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void Invoice</DialogTitle>
            <DialogDescription>
              Are you sure you want to void this invoice? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Textarea
                placeholder="Enter void reason"
                value={voidInvoiceReason}
                onChange={(e) => setVoidInvoiceReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidInvoiceOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleVoidInvoice} disabled={voidInvoice.isPending}>
              {voidInvoice.isPending ? "Voiding..." : "Confirm Void"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reversal Dialog */}
      <Dialog open={!!reversalOpen} onOpenChange={(open) => !open && setReversalOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="capitalize">{reversalOpen?.action} Payment</DialogTitle>
            <DialogDescription>
              Enter the {reversalOpen?.action} details below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={reversalAmount}
                onChange={(e) => setReversalAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Textarea
                placeholder={`Reason for ${reversalOpen?.action}`}
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReversalOpen(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReversal} disabled={refundPayment.isPending || voidPayment.isPending}>
              Confirm {reversalOpen?.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ActivityTimeline
        entityType="invoice"
        entityId={invoice.id}
        description="Status changes, payments, and communications for this invoice."
      />
    </div>
  );
}
