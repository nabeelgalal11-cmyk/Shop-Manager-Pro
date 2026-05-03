import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, CreditCard, Loader2 } from "lucide-react";

interface PublicInvoice {
  invoiceNumber: string;
  status: string;
  createdAt: string;
  dueDate: string | null;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  amountPaid: string;
  balance: string;
  notes: string | null;
  customer: { firstName: string; lastName: string; email: string | null } | null;
  lineItems: { description: string; quantity: string; unitPrice: string; total: string; type: string }[];
  payments: { amount: string; method: string; paidAt: string; referenceNumber: string | null }[];
  paymentsEnabled: boolean;
  shopName: string;
}

const fmt = (n: number | string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));

export default function PayInvoice() {
  const [match, params] = useRoute("/pay/:token");
  const [, successParams] = useRoute("/pay/:token/success");
  const [, cancelParams] = useRoute("/pay/:token/cancelled");
  const token = params?.token ?? successParams?.token ?? cancelParams?.token ?? "";
  const isSuccess = !!successParams;
  const isCancel = !!cancelParams;

  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(isSuccess);

  useEffect(() => {
    // Best-effort: tell the server the customer cancelled so the attempt
    // shows up in the shop's invoice timeline immediately.
    if (isCancel && token) {
      fetch(`/api/public/invoices/${token}/cancel`, { method: "POST" }).catch(() => {});
    }
  }, [isCancel, token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setLoading(true);
    if (isSuccess) setProcessing(true);

    const POLL_INTERVAL_MS = 1500;
    const MAX_POLL_MS = 10_000;
    const startedAt = Date.now();

    const fetchOnce = () => {
      fetch(`/api/public/invoices/${token}`)
        .then(async r => {
          if (!r.ok) throw new Error(r.status === 404 ? "Invoice not found" : "Unable to load invoice");
          return r.json() as Promise<PublicInvoice>;
        })
        .then(data => {
          if (cancelled) return;
          setInvoice(data);
          setError(null);
          setLoading(false);
          if (isSuccess) {
            if (Number(data.balance) <= 0) {
              setProcessing(false);
            } else if (Date.now() - startedAt < MAX_POLL_MS) {
              timer = setTimeout(fetchOnce, POLL_INTERVAL_MS);
            } else {
              setProcessing(false);
            }
          }
        })
        .catch(err => {
          if (cancelled) return;
          setError(err.message);
          setLoading(false);
          if (isSuccess && Date.now() - startedAt < MAX_POLL_MS) {
            timer = setTimeout(fetchOnce, POLL_INTERVAL_MS);
          } else if (isSuccess) {
            setProcessing(false);
          }
        });
    };

    fetchOnce();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token, isSuccess]);

  const handlePay = async () => {
    setPaying(true);
    setPayError(null);
    try {
      const r = await fetch(`/api/public/invoices/${token}/checkout-session`, { method: "POST" });
      const data = await r.json();
      if (!r.ok || !data.url) throw new Error(data.error ?? "Unable to start payment");
      window.location.href = data.url;
    } catch (err: any) {
      setPayError(err.message);
      setPaying(false);
    }
  };

  if (!match && !successParams && !cancelParams) return null;

  return (
    <div className="min-h-screen bg-muted/30 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-4">
        {isSuccess && processing && (
          <Card className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/30">
            <CardContent className="pt-5 pb-5 flex items-start gap-3">
              <Loader2 className="h-6 w-6 text-blue-600 mt-0.5 animate-spin" />
              <div>
                <p className="font-semibold text-blue-900 dark:text-blue-200">Confirming your payment…</p>
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  Hang tight while we finalize your receipt. This usually takes just a few seconds.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {isSuccess && !processing && invoice && Number(invoice.balance) <= 0 && (
          <Card className="border-green-500/50 bg-green-50 dark:bg-green-950/30">
            <CardContent className="pt-5 pb-5 flex items-start gap-3">
              <CheckCircle2 className="h-6 w-6 text-green-600 mt-0.5" />
              <div>
                <p className="font-semibold text-green-900 dark:text-green-200">Payment received — thank you!</p>
                <p className="text-sm text-green-800 dark:text-green-300">
                  A receipt will be emailed to you shortly. You can close this page.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {isSuccess && !processing && invoice && Number(invoice.balance) > 0 && (
          <Card className="border-green-500/50 bg-green-50 dark:bg-green-950/30">
            <CardContent className="pt-5 pb-5 flex items-start gap-3">
              <CheckCircle2 className="h-6 w-6 text-green-600 mt-0.5" />
              <div>
                <p className="font-semibold text-green-900 dark:text-green-200">We received your payment</p>
                <p className="text-sm text-green-800 dark:text-green-300">
                  It'll appear on your invoice shortly. You can safely close this page — a receipt will be emailed to you once everything is finalized.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {isCancel && (
          <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/30">
            <CardContent className="pt-5 pb-5 flex items-start gap-3">
              <AlertCircle className="h-6 w-6 text-amber-600 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-900 dark:text-amber-200">Payment cancelled</p>
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  You weren't charged. You can try again whenever you're ready.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {loading && <Skeleton className="h-72 w-full" />}
        {error && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">{error}</CardContent></Card>
        )}

        {invoice && (
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">{invoice.shopName}</p>
                  <CardTitle className="text-2xl">Invoice {invoice.invoiceNumber}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {invoice.customer && `${invoice.customer.firstName} ${invoice.customer.lastName}`}
                  </p>
                </div>
                <Badge variant={invoice.status === "paid" ? "default" : "secondary"} className="capitalize">
                  {invoice.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2 text-sm">
                {invoice.lineItems.map((li, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span className="flex-1">{li.description} <span className="text-muted-foreground">× {li.quantity}</span></span>
                    <span className="font-medium tabular-nums">{fmt(li.total)}</span>
                  </div>
                ))}
              </div>

              <Separator />

              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmt(invoice.subtotal)}</span></div>
                {Number(invoice.discountAmount) > 0 && (
                  <div className="flex justify-between text-destructive"><span>Discount</span><span>-{fmt(invoice.discountAmount)}</span></div>
                )}
                <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{fmt(invoice.taxAmount)}</span></div>
                <div className="flex justify-between font-semibold text-base pt-1"><span>Total</span><span>{fmt(invoice.total)}</span></div>
                {Number(invoice.amountPaid) > 0 && (
                  <div className="flex justify-between text-green-700"><span>Paid</span><span>−{fmt(invoice.amountPaid)}</span></div>
                )}
                <div className={`flex justify-between font-bold text-lg pt-1 ${Number(invoice.balance) > 0 ? "text-foreground" : "text-green-700"}`}>
                  <span>Balance due</span>
                  <span>{fmt(invoice.balance)}</span>
                </div>
              </div>

              {Number(invoice.balance) > 0 && invoice.status === "sent" ? (
                <>
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={handlePay}
                    disabled={!invoice.paymentsEnabled || paying}
                  >
                    {paying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CreditCard className="h-4 w-4 mr-2" />}
                    {paying ? "Redirecting to Stripe…" : `Pay ${fmt(invoice.balance)} now`}
                  </Button>
                  {!invoice.paymentsEnabled && (
                    <p className="text-xs text-center text-muted-foreground">
                      Online payments are not configured. Please contact the shop directly.
                    </p>
                  )}
                  {payError && <p className="text-sm text-destructive text-center">{payError}</p>}
                </>
              ) : Number(invoice.balance) <= 0 ? (
                <div className="text-center text-green-700 font-medium">This invoice is fully paid. Thank you!</div>
              ) : invoice.status === "draft" ? (
                <div className="text-center text-sm text-muted-foreground">
                  This invoice is not yet finalized. Please contact the shop.
                </div>
              ) : null}

              {invoice.payments.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Payment history</p>
                    <div className="space-y-1 text-sm">
                      {invoice.payments.map((p, i) => (
                        <div key={i} className="flex justify-between">
                          <span>
                            {new Date(p.paidAt).toLocaleDateString()} · <span className="capitalize">{p.method}</span>
                          </span>
                          <span className="tabular-nums">{fmt(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
