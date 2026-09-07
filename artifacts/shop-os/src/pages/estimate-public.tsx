import { useState } from "react";
import { useRoute } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Loader2, Check, X } from "lucide-react";
import { useGetPublicEstimateRevision, useDecidePublicEstimateRevision } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const fmt = (n: number | string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));
const lineAmount = (item: { quantity: number | string; unitPrice: number | string }) =>
  Number(item.quantity) * Number(item.unitPrice);

export default function EstimatePublic() {
  const [, params] = useRoute("/estimate/:token");
  const token = params?.token ?? "";
  const { toast } = useToast();

  const { data: estData, isLoading, error } = useGetPublicEstimateRevision(token, {
    query: { enabled: !!token, retry: false }
  });

  const decideMutation = useDecidePublicEstimateRevision();

  const [decisions, setDecisions] = useState<Record<number, "approved" | "declined" | "">>(({}));
  const [signerName, setSignerName] = useState("");

  const est = estData ? {
    ...estData.revision,
    lineItems: estData.items
  } : null;

  function handleDecide(itemId: number, decision: "approved" | "declined" | "") {
    setDecisions(prev => ({ ...prev, [itemId]: decision }));
  }

  async function submitDecision(overall: "approved" | "declined") {
    if (!signerName.trim()) {
      toast({ title: "Please enter your name", variant: "destructive" });
      return;
    }

    const approvedItemIds: number[] = [];
    const declinedItemIds: number[] = [];

    if (overall === "declined") {
      est?.lineItems.forEach(item => declinedItemIds.push(item.id));
    } else {
      est?.lineItems.forEach(item => {
        if (decisions[item.id] === "approved") approvedItemIds.push(item.id);
        if (decisions[item.id] === "declined") declinedItemIds.push(item.id);
      });
      // Ensure all items are decided if they want to approve part
      const totalDecided = approvedItemIds.length + declinedItemIds.length;
      if (totalDecided < (est?.lineItems.length ?? 0)) {
        toast({ title: "Please approve or decline all items", variant: "destructive" });
        return;
      }
      if (approvedItemIds.length === 0) {
        toast({ title: "Please approve at least one item, or decline the entire estimate", variant: "destructive" });
        return;
      }
    }

    decideMutation.mutate({
      token,
      data: {
        signerName,
        decision: overall,
        approvedItemIds,
        declinedItemIds
      }
    }, {
      onSuccess: () => {
        toast({ title: "Thank you, your decision has been recorded." });
        setTimeout(() => window.location.reload(), 2000);
      },
      onError: (err: any) => {
        toast({ title: "Could not submit decision", description: err.message, variant: "destructive" });
      }
    });
  }

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  if (error || !est) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <Card className="max-w-md w-full"><CardContent className="py-12 text-center">
        <p className="text-lg font-semibold">Estimate unavailable</p>
        <p className="text-sm text-muted-foreground mt-2">This link may have expired or the estimate has already been decided.</p>
      </CardContent></Card>
    </div>
  );

  const customerName = est.customerSnapshot ? `${(est.customerSnapshot as any).firstName} ${(est.customerSnapshot as any).lastName}`.trim() : null;
  const v = est.vehicleSnapshot as any;

  const approvedSubtotal = est.lineItems
    .filter(li => decisions[li.id] === "approved")
    .reduce((sum, item) => sum + lineAmount(item), 0);
  const explicitTaxRateBps = Number(est.taxRateBps);
  const effectiveTaxRateBps = Number.isFinite(explicitTaxRateBps)
    ? explicitTaxRateBps
    : Number(est.subtotal) > 0
      ? Math.round(Number(est.taxAmount) / Number(est.subtotal) * 10_000)
      : 0;
  const approvedTax = Math.round(
    Math.max(approvedSubtotal, 0) * 100 * effectiveTaxRateBps / 10_000,
  ) / 100;
  const approvedTotal = approvedSubtotal + approvedTax;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-12">
      <div className="bg-violet-600 text-white">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <p className="text-xs uppercase tracking-wide opacity-90">915motors</p>
          <h1 className="text-2xl font-bold mt-1 capitalize">{est.kind} #{est.revisionNo}</h1>
          <p className="text-sm opacity-90 mt-1">
            {v ? `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() : ""}
          </p>
          {customerName && <p className="text-xs opacity-80 mt-1">Prepared for {customerName}</p>}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-5">
        <Card>
          <CardContent className="pt-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold">Recommended work</h2>
              <p className="text-sm text-muted-foreground">
                Approve or decline each line, then submit your decision at the bottom.
              </p>
            </div>
            <div className="space-y-3">
              {est.lineItems.map(li => (
                <div key={li.id} className={`border-l-4 ${decisions[li.id] === "approved" ? "border-green-500" : decisions[li.id] === "declined" ? "border-red-500" : "border-slate-200 dark:border-slate-800"} bg-card rounded-md p-3`}>
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <p className="font-semibold">{li.description}</p>
                    <span className="text-sm font-medium tabular-nums">{fmt(lineAmount(li))}</span>
                  </div>
                  <p className="text-xs text-muted-foreground capitalize mt-0.5">
                    {li.kind} · {Number(li.quantity)} × {fmt(Number(li.unitPrice))}
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <Button
                      type="button" size="sm"
                      variant={decisions[li.id] === "approved" ? "default" : "outline"}
                      className={decisions[li.id] === "approved" ? "bg-green-600 hover:bg-green-700" : "border-green-500 text-green-700 hover:bg-green-50"}
                      onClick={() => handleDecide(li.id, decisions[li.id] === "approved" ? "" : "approved")}
                    >
                      <Check className="h-4 w-4 mr-1" /> Approve
                    </Button>
                    <Button
                      type="button" size="sm"
                      variant={decisions[li.id] === "declined" ? "destructive" : "outline"}
                      className={decisions[li.id] === "declined" ? "" : "border-red-500 text-red-700 hover:bg-red-50"}
                      onClick={() => handleDecide(li.id, decisions[li.id] === "declined" ? "" : "declined")}
                    >
                      <X className="h-4 w-4 mr-1" /> Decline
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmt(est.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{fmt(est.taxAmount)}</span></div>
            <Separator />
            <div className="flex justify-between font-semibold text-base"><span>Estimated total</span><span>{fmt(est.total)}</span></div>
            <div className="flex justify-between text-sm text-green-700 dark:text-green-400 mt-2 font-medium">
              <span>Your approved total</span>
              <span>{fmt(approvedTotal)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 space-y-4">
            <h2 className="text-base font-semibold mb-2">Finalize Decision</h2>
            <div>
              <label className="text-sm font-medium">Your full name</label>
              <Input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Type your full name"
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button
                variant="destructive"
                onClick={() => submitDecision("declined")}
                disabled={decideMutation.isPending}
              >
                {decideMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Decline Entire Estimate
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={() => submitDecision("approved")}
                disabled={decideMutation.isPending}
              >
                {decideMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Submit Approvals
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center pt-4">
          Questions? Reply to the message we sent you and we'll be right with you.
        </p>
      </div>
    </div>
  );
}