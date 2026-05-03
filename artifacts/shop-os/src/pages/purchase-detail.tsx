import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AttachmentsPanel } from "@/components/attachments-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Printer, Pencil, Loader2 } from "lucide-react";

function fmt(n: any) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  received: "default",
  returned: "destructive",
  partial: "outline",
};

export default function PurchaseDetail() {
  const [, params] = useRoute("/purchases/:id");
  const [, setLocation] = useLocation();
  const id = Number(params?.id);

  const { data: purchase, isLoading } = useQuery<any>({
    queryKey: [`/api/purchases/${id}`],
    queryFn: async () => {
      const r = await fetch(`/api/purchases/${id}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: id > 0,
  });

  function handlePrint() {
    if (!purchase) return;
    const lineItems: any[] = Array.isArray(purchase.lineItems) ? purchase.lineItems : [];
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    const rows = lineItems.map((it) => `
      <tr>
        <td>${escape(it.description || "")}</td>
        <td style="text-align:right">${Number(it.quantity || 0)}</td>
        <td style="text-align:right">${fmt(it.unitCost)}</td>
        <td style="text-align:right">${fmt(Number(it.quantity || 0) * Number(it.unitCost || 0))}</td>
      </tr>`).join("");
    const subtotal = lineItems.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitCost || 0), 0);
    w.document.write(`<!doctype html><html><head><title>Purchase #${purchase.id}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;color:#111}
        h1{margin:0 0 4px} h2{margin:24px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}
        .meta{color:#555;font-size:13px;margin-bottom:16px}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-bottom:12px}
        .grid div b{display:inline-block;min-width:140px;color:#444}
        table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
        th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
        th{background:#f4f4f4}
        .totals{margin-top:12px;width:300px;margin-left:auto;font-size:14px}
        .totals div{display:flex;justify-content:space-between;padding:4px 0}
        .totals .grand{font-weight:bold;border-top:2px solid #333;margin-top:6px;padding-top:6px}
        .notes{white-space:pre-wrap;border:1px solid #ddd;padding:8px;border-radius:4px;background:#fafafa}
      </style></head><body>
      <h1>Purchase Order #${purchase.id}</h1>
      <div class="meta">${escape(purchase.invoiceNumber ? `Invoice ${purchase.invoiceNumber} · ` : "")}${purchase.purchaseDate ? new Date(purchase.purchaseDate).toLocaleDateString() : ""}</div>
      <h2>Supplier</h2>
      <div class="grid">
        <div><b>Supplier:</b> ${escape(purchase.supplier || "")}</div>
        <div><b>Contact:</b> ${escape(purchase.supplierContact || "")}</div>
        <div><b>Email:</b> ${escape(purchase.supplierEmail || "")}</div>
        <div><b>Phone:</b> ${escape(purchase.supplierPhone || "")}</div>
        <div><b>Status:</b> ${escape(purchase.status || "")}</div>
        <div><b>Invoice #:</b> ${escape(purchase.invoiceNumber || "")}</div>
      </div>
      <h2>Line Items</h2>
      <table><thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Cost</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">No line items</td></tr>'}</tbody></table>
      <div class="totals">
        <div><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
        <div><span>Tax</span><span>${fmt(purchase.tax)}</span></div>
        <div><span>Shipping</span><span>${fmt(purchase.shipping)}</span></div>
        <div class="grand"><span>Total</span><span>${fmt(purchase.amount)}</span></div>
      </div>
      ${purchase.notes ? `<h2>Notes</h2><div class="notes">${escape(purchase.notes)}</div>` : ""}
      </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
  }

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!purchase) return <div className="p-8">Purchase not found.</div>;
  const lineItems: any[] = Array.isArray(purchase.lineItems) ? purchase.lineItems : [];
  const subtotal = lineItems.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitCost || 0), 0);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/purchases")}><ArrowLeft className="h-5 w-5" /></Button>
          <div>
            <h1 className="text-3xl font-bold">Purchase #{purchase.id}</h1>
            <p className="text-muted-foreground">
              {purchase.supplier || "—"}
              {purchase.purchaseDate ? ` · ${new Date(purchase.purchaseDate).toLocaleDateString()}` : ""}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Badge variant={STATUS_VARIANT[purchase.status] || "outline"} className="capitalize self-center mr-2">{purchase.status}</Badge>
          <Button variant="outline" onClick={handlePrint}><Printer className="h-4 w-4 mr-2" /> Print</Button>
          <Button variant="outline" onClick={() => setLocation(`/purchases/new?edit=${purchase.id}`)}><Pencil className="h-4 w-4 mr-2" /> Edit</Button>
        </div>
      </div>

      <Card className="shadow-sm border-border">
        <CardHeader><CardTitle className="text-lg">Supplier</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div><span className="text-muted-foreground">Supplier: </span>{purchase.supplier || "—"}</div>
          <div><span className="text-muted-foreground">Contact: </span>{purchase.supplierContact || "—"}</div>
          <div><span className="text-muted-foreground">Email: </span>{purchase.supplierEmail || "—"}</div>
          <div><span className="text-muted-foreground">Phone: </span>{purchase.supplierPhone || "—"}</div>
          <div><span className="text-muted-foreground">Invoice #: </span>{purchase.invoiceNumber || "—"}</div>
          <div><span className="text-muted-foreground">Status: </span><span className="capitalize">{purchase.status}</span></div>
        </CardContent>
      </Card>

      <Card className="shadow-sm border-border">
        <CardHeader><CardTitle className="text-lg">Line Items</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit Cost</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {lineItems.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No line items.</TableCell></TableRow>
              ) : lineItems.map((it, i) => (
                <TableRow key={i}>
                  <TableCell>{it.description}{it.linkedItem?.name ? ` (${it.linkedItem.name})` : ""}</TableCell>
                  <TableCell className="text-right">{Number(it.quantity || 0)}</TableCell>
                  <TableCell className="text-right">{fmt(it.unitCost)}</TableCell>
                  <TableCell className="text-right">{fmt(Number(it.quantity || 0) * Number(it.unitCost || 0))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
            <div className="flex justify-between"><span>Tax</span><span>{fmt(purchase.tax)}</span></div>
            <div className="flex justify-between"><span>Shipping</span><span>{fmt(purchase.shipping)}</span></div>
            <div className="flex justify-between border-t pt-2 font-bold"><span>Total</span><span>{fmt(purchase.amount)}</span></div>
          </div>
        </CardContent>
      </Card>

      {purchase.notes && (
        <Card className="shadow-sm border-border">
          <CardHeader><CardTitle className="text-lg">Notes</CardTitle></CardHeader>
          <CardContent><p className="text-sm whitespace-pre-wrap">{purchase.notes}</p></CardContent>
        </Card>
      )}

      {id > 0 && (
        <AttachmentsPanel
          ownerType="purchase"
          ownerId={id}
          title="Receipts & Documents"
          description="Receipts, supplier invoices, and supporting documents for this purchase."
        />
      )}
    </div>
  );
}

function escape(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
