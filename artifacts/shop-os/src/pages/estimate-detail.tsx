import { useRef } from "react";
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
import { ArrowLeft, Printer, FileCheck } from "lucide-react";
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

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!estimate) return <div className="p-8 text-center">Estimate not found</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/estimates")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Estimate {estimate.estimateNumber}</h1>
            <Badge variant="outline" className="mt-1 capitalize">{estimate.status}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
          {estimate.status !== "converted" && (
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {estimate.lineItems?.map(item => (
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

      <div ref={printRef} style={{ display: "none" }}>
        <h1>Estimate: {estimate.estimateNumber}</h1>
        <div className="meta">
          Customer: {estimate.customer?.firstName} {estimate.customer?.lastName} &bull;
          Vehicle: {estimate.vehicle?.year} {estimate.vehicle?.make} {estimate.vehicle?.model} &bull;
          Date: {new Date(estimate.createdAt).toLocaleDateString()} &bull;
          Status: {estimate.status}
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
