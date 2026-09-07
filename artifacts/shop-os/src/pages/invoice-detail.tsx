import { useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInvoice, getGetInvoiceQueryKey, getGetRepairOrderQueryKey,
  useCreatePayment,
  useIssueWorkflowInvoice,
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
import { ArrowLeft, Printer, CreditCard, CheckCircle, XCircle, Link } from "lucide-react";
import { ActivityTimeline } from "@/components/activity-timeline";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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
  const [paymentAttemptKey, setPaymentAttemptKey] = useState(() => crypto.randomUUID());

  const [voidInvoiceOpen, setVoidInvoiceOpen] = useState(false);
  const [voidInvoiceReason, setVoidInvoiceReason] = useState("");

  const [reversalOpen, setReversalOpen] = useState<{ id: number; action: "refund" | "void"; amount: string } | null>(null);
  const [reversalAmount, setReversalAmount] = useState("");
  const [reversalReason, setReversalReason] = useState("");

  const { data: invoice, isLoading } = useGetInvoice(id, {
    query: { enabled: !!id, queryKey: getGetInvoiceQueryKey(id) },
  });

  const issueInvoice = useIssueWorkflowInvoice();
  const voidInvoice = useVoidWorkflowInvoice();
  const createPayment = useCreatePayment({
    request: { headers: { "Idempotency-Key": paymentAttemptKey } }
  });
  const refundPayment = useRefundWorkflowPayment();
  const voidPayment = useVoidWorkflowPayment();

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
              <h2 className="text-lg font-bold mb-2">915motors</h2>
              <p className="text-sm text-muted-foreground">123 Mechanic St.<br />Auto City, ST 12345</p>
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
                            }}>Void</Button>
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
