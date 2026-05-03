import { useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEstimate, getGetEstimateQueryKey,
  useConvertEstimateToInvoice,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Printer, FileCheck, Send, Wrench, Check, X, MinusCircle, Copy } from "lucide-react";
import { CustomerMessageThread } from "@/components/customer-message-thread";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

export default function EstimateDetail() {
  const [match, params] = useRoute("/estimates/:id");
  const id = match ? parseInt(params.id) : 0;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);

  const { data: estimate, isLoading } = useGetEstimate(id, {
    query: { enabled: !!id, queryKey: getGetEstimateQueryKey(id) },
  });

  const convertToInvoice = useConvertEstimateToInvoice();
  const [sending, setSending] = useState(false);
  const [convertingRo, setConvertingRo] = useState(false);

  const status = (estimate as any)?.status as string | undefined;
  const publicToken = (estimate as any)?.publicToken as string | null | undefined;
  const customerSignedAt = (estimate as any)?.customerSignedAt as string | null | undefined;
  const customerSignerName = (estimate as any)?.customerSignerName as string | null | undefined;
  const declineReason = (estimate as any)?.declineReason as string | null | undefined;
  const publicUrl = publicToken ? `${window.location.origin}/estimate/${publicToken}` : null;

  const handleSend = async () => {
    setSending(true);
    try {
      const r = await fetch(`/api/estimates/${id}/send`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || "Failed to send estimate");
      const parts = [];
      if (data.emailed) parts.push("email");
      if (data.smsed) parts.push("SMS");
      if (parts.length === 0) {
        toast({ title: "Estimate not sent", description: (data.errors || []).join("; ") || "No channels available", variant: "destructive" });
      } else {
        toast({ title: `Estimate sent via ${parts.join(" + ")}`, description: data.estimateUrl });
        queryClient.invalidateQueries({ queryKey: getGetEstimateQueryKey(id) });
      }
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleCopyLink = () => {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl).then(
      () => toast({ title: "Link copied" }),
      () => toast({ title: "Could not copy", variant: "destructive" }),
    );
  };

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
          <title>Estimate ${estimate?.estimateNumber}</title>
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

  const handleConvert = () => {
    convertToInvoice.mutate({ id }, {
      onSuccess: (invoice: any) => {
        queryClient.invalidateQueries({ queryKey: getGetEstimateQueryKey(id) });
        toast({ title: "Converted to invoice!", description: `Invoice ${invoice.invoiceNumber} created.` });
        setLocation(`/invoices/${invoice.id}`);
      },
      onError: () => toast({ title: "Conversion failed", variant: "destructive" }),
    });
  };

  const handleConvertToRo = async () => {
    setConvertingRo(true);
    try {
      const r = await fetch(`/api/estimates/${id}/convert-to-ro`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || "Failed to create repair order");
      queryClient.invalidateQueries({ queryKey: getGetEstimateQueryKey(id) });
      toast({ title: "Repair order created", description: `RO ${data.orderNumber}` });
      setLocation(`/repair-orders/${data.id}`);
    } catch (err: any) {
      toast({ title: err.message || "Could not create RO", variant: "destructive" });
    } finally {
      setConvertingRo(false);
    }
  };

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!estimate) return <div className="p-8 text-center">Estimate not found</div>;

  const statusBadgeClass =
    status === "approved" ? "bg-green-600 text-white border-transparent" :
    status === "declined" ? "bg-red-600 text-white border-transparent" :
    status === "sent" ? "bg-violet-600 text-white border-transparent" :
    status === "converted" ? "bg-blue-600 text-white border-transparent" :
    "";

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/estimates")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Estimate {estimate.estimateNumber}</h1>
            <Badge variant="outline" className={`mt-1 capitalize ${statusBadgeClass}`}>{status}</Badge>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
          {status !== "converted" && (
            <Button variant="outline" onClick={handleSend} disabled={sending}>
              <Send className="h-4 w-4 mr-2" /> {sending ? "Sending…" : status === "sent" || status === "approved" || status === "declined" ? "Resend" : "Send for approval"}
            </Button>
          )}
          {status === "approved" && (
            <Button
              className="bg-orange-600 hover:bg-orange-700 text-white"
              onClick={handleConvertToRo}
              disabled={convertingRo}
            >
              <Wrench className="h-4 w-4 mr-2" />
              {convertingRo ? "Creating…" : "Convert to Repair Order"}
            </Button>
          )}
          {status !== "converted" && (
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={handleConvert}
              disabled={convertToInvoice.isPending}
            >
              <FileCheck className="h-4 w-4 mr-2" />
              {convertToInvoice.isPending ? "Converting..." : "Convert to Invoice"}
            </Button>
          )}
        </div>
      </div>

      {publicUrl && (
        <Card className="border-dashed">
          <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">Customer approval link</p>
              <a href={publicUrl} target="_blank" rel="noreferrer" className="text-primary underline break-all">{publicUrl}</a>
            </div>
            <Button size="sm" variant="outline" onClick={handleCopyLink}>
              <Copy className="h-3.5 w-3.5 mr-1" /> Copy
            </Button>
          </CardContent>
        </Card>
      )}

      {customerSignedAt && (
        <Card className="border-green-500 bg-green-50 dark:bg-green-950/30">
          <CardContent className="py-4 flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <Check className="h-5 w-5 text-green-600 mt-0.5" />
              <div>
                <p className="font-semibold text-green-900 dark:text-green-200">Approved by customer</p>
                <p className="text-sm text-green-800 dark:text-green-300">
                  Signed by <b>{customerSignerName}</b> on {new Date(customerSignedAt).toLocaleString()}.
                </p>
              </div>
            </div>
            {publicToken && (
              <img
                src={`/api/public/estimates/${publicToken}/signature`}
                alt="Customer signature"
                className="max-h-20 bg-white border rounded-md p-1"
              />
            )}
          </CardContent>
        </Card>
      )}

      {status === "declined" && (
        <Card className="border-red-500 bg-red-50 dark:bg-red-950/30">
          <CardContent className="py-4 flex items-start gap-3">
            <X className="h-5 w-5 text-red-600 mt-0.5" />
            <div>
              <p className="font-semibold text-red-900 dark:text-red-200">Declined by customer</p>
              {declineReason && (
                <p className="text-sm text-red-800 dark:text-red-300 mt-1">"{declineReason}"</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-sm border-border">
        <CardContent className="p-8">
          <div className="flex justify-between items-start mb-8">
            <div>
              <h2 className="text-lg font-bold mb-2">ShopOS Auto Repair</h2>
              <p className="text-sm text-muted-foreground">123 Mechanic St.<br />Auto City, ST 12345</p>
            </div>
            <div className="text-right">
              <h3 className="font-semibold text-lg mb-2">Estimate For</h3>
              <p className="text-sm">{estimate.customer?.firstName} {estimate.customer?.lastName}</p>
              {estimate.vehicle && (
                <p className="text-sm text-muted-foreground">
                  {estimate.vehicle.year} {estimate.vehicle.make} {estimate.vehicle.model}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Date: {new Date(estimate.createdAt).toLocaleDateString()}
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
                <TableHead className="text-center">Customer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {estimate.lineItems?.map(item => {
                const decision = (item as any).customerDecision as string | undefined;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.description}</TableCell>
                    <TableCell className="capitalize">{item.type}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right">{formatCurrency(Number(item.unitPrice))}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(Number(item.total))}</TableCell>
                    <TableCell className="text-center">
                      {decision === "approved" ? (
                        <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400 text-xs font-semibold">
                          <Check className="h-3.5 w-3.5" /> Approved
                        </span>
                      ) : decision === "declined" ? (
                        <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400 text-xs font-semibold">
                          <X className="h-3.5 w-3.5" /> Declined
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                          <MinusCircle className="h-3.5 w-3.5" /> Pending
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="mt-8 flex justify-end">
            <div className="w-64 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(Number(estimate.subtotal))}</span>
              </div>
              {Number(estimate.discountAmount) > 0 && (
                <div className="flex justify-between text-sm text-destructive">
                  <span>Discount</span>
                  <span>-{formatCurrency(Number(estimate.discountAmount))}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax ({estimate.taxRate}%)</span>
                <span>{formatCurrency(Number(estimate.taxAmount))}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-lg">
                <span>Estimated Total</span>
                <span>{formatCurrency(Number(estimate.total))}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {estimate.customerId ? (
        <CustomerMessageThread
          customerId={estimate.customerId}
          estimateId={estimate.id}
          title="Messages on this Estimate"
        />
      ) : null}

      <div ref={printRef} style={{ display: "none" }}>
        <h1>Estimate: {estimate.estimateNumber}</h1>
        <div className="meta">
          Customer: {estimate.customer?.firstName} {estimate.customer?.lastName} &bull;
          Vehicle: {estimate.vehicle?.year} {estimate.vehicle?.make} {estimate.vehicle?.model} &bull;
          Date: {new Date(estimate.createdAt).toLocaleDateString()} &bull;
          Status: {status}
        </div>
        <table>
          <thead><tr><th>Description</th><th>Type</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
          <tbody>
            {estimate.lineItems?.map(item => (
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
          <div><span>Subtotal</span><span>{formatCurrency(Number(estimate.subtotal))}</span></div>
          <div><span>Tax ({estimate.taxRate}%)</span><span>{formatCurrency(Number(estimate.taxAmount))}</span></div>
          <div className="grand"><span>Total</span><span>{formatCurrency(Number(estimate.total))}</span></div>
        </div>
      </div>
    </div>
  );
}
