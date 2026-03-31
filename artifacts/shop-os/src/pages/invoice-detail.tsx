import { useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInvoice, getGetInvoiceQueryKey,
  useCreatePayment,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Printer, CreditCard } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function InvoiceDetail() {
  const [match, params] = useRoute("/invoices/:id");
  const id = match ? parseInt(params.id) : 0;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");

  const { data: invoice, isLoading } = useGetInvoice(id, {
    query: { enabled: !!id, queryKey: getGetInvoiceQueryKey(id) },
  });

  const createPayment = useCreatePayment();

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);

  const handlePrint = () => {
    const el = printRef.current;
    if (!el) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>Invoice ${invoice?.invoiceNumber}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            h1 { font-size: 20px; margin-bottom: 4px; }
            .meta { color: #555; font-size: 13px; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; font-size: 13px; }
            th { background: #f0f0f0; text-align: left; padding: 6px 8px; font-size: 12px; }
            td { padding: 6px 8px; border-bottom: 1px solid #eee; }
            .totals { margin-top: 16px; float: right; width: 240px; font-size: 13px; }
            .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
            .totals .grand { font-weight: bold; font-size: 15px; border-top: 2px solid #ddd; margin-top: 4px; padding-top: 6px; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>${el.innerHTML}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  const handleRecordPayment = () => {
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    createPayment.mutate(
      { data: { invoiceId: id, amount: String(amount), method: payMethod, paidAt: new Date().toISOString() } as any },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
          toast({ title: "Payment recorded successfully" });
          setPaymentOpen(false);
          setPayAmount("");
          setPayMethod("cash");
        },
        onError: () => toast({ title: "Failed to record payment", variant: "destructive" }),
      }
    );
  };

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!invoice) return <div className="p-8 text-center">Invoice not found</div>;

  const balance = Number(invoice.balance ?? 0);

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
              variant={invoice.status === "paid" ? "default" : invoice.status === "overdue" ? "destructive" : "secondary"}
              className="mt-1 capitalize"
            >
              {invoice.status}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
          {invoice.status !== "paid" && balance > 0 && (
            <Button onClick={() => setPaymentOpen(true)}>
              <CreditCard className="h-4 w-4 mr-2" /> Record Payment
            </Button>
          )}
        </div>
      </div>

      <Card className="shadow-sm border-border">
        <CardContent className="p-8">
          <div className="flex justify-between items-start mb-8">
            <div>
              <h2 className="text-lg font-bold mb-2">ShopOS Auto Repair</h2>
              <p className="text-sm text-muted-foreground">123 Mechanic St.<br />Auto City, ST 12345<br />(555) 555-5555</p>
            </div>
            <div className="text-right">
              <h3 className="font-semibold text-lg mb-2">Bill To</h3>
              <p className="text-sm font-medium">{invoice.customer?.firstName} {invoice.customer?.lastName}</p>
              {invoice.customer?.address && <p className="text-sm text-muted-foreground">{invoice.customer.address}</p>}
              <p className="text-xs text-muted-foreground mt-2">
                Invoice Date: {new Date(invoice.createdAt).toLocaleDateString()}
              </p>
              {invoice.dueDate && (
                <p className="text-xs text-muted-foreground">
                  Due: {new Date(invoice.dueDate).toLocaleDateString()}
                </p>
              )}
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
              {invoice.lineItems?.map(item => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.description}</TableCell>
                  <TableCell className="capitalize">{item.type}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(Number(item.unitPrice))}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(Number(item.total))}</TableCell>
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
              {Number(invoice.discountAmount) > 0 && (
                <div className="flex justify-between text-sm text-destructive">
                  <span>Discount</span>
                  <span>-{formatCurrency(Number(invoice.discountAmount))}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax ({invoice.taxRate}%)</span>
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
                  <SelectItem value="paypal">PayPal</SelectItem>
                  <SelectItem value="square">Square</SelectItem>
                  <SelectItem value="stripe">Stripe</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button>
            <Button onClick={handleRecordPayment} disabled={createPayment.isPending}>
              {createPayment.isPending ? "Saving..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div ref={printRef} style={{ display: "none" }}>
        <h1>Invoice: {invoice.invoiceNumber}</h1>
        <div className="meta">
          Customer: {invoice.customer?.firstName} {invoice.customer?.lastName} &bull;
          Date: {new Date(invoice.createdAt).toLocaleDateString()} &bull;
          Status: {invoice.status}
        </div>
        <table>
          <thead><tr><th>Description</th><th>Type</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
          <tbody>
            {invoice.lineItems?.map(item => (
              <tr key={item.id}>
                <td>{item.description}</td>
                <td style={{ textTransform: "capitalize" }}>{item.type}</td>
                <td>{item.quantity}</td>
                <td>{formatCurrency(Number(item.unitPrice))}</td>
                <td>{formatCurrency(Number(item.total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="totals">
          <div><span>Subtotal</span><span>{formatCurrency(Number(invoice.subtotal))}</span></div>
          <div><span>Tax ({invoice.taxRate}%)</span><span>{formatCurrency(Number(invoice.taxAmount))}</span></div>
          <div><span>Amount Paid</span><span>{formatCurrency(Number(invoice.amountPaid))}</span></div>
          <div className="grand"><span>Balance Due</span><span>{formatCurrency(balance)}</span></div>
        </div>
      </div>
    </div>
  );
}
