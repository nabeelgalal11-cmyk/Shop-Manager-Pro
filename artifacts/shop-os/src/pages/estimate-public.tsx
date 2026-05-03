import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Loader2, Check, X, CheckCircle2, XCircle } from "lucide-react";

interface PublicLine {
  id: number;
  type: string;
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
  partNumber: string | null;
  customerDecision: "pending" | "approved" | "declined";
}
interface PublicEstimate {
  id: number;
  estimateNumber: string;
  status: string;
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  createdAt: string;
  sentAt: string | null;
  customerSignedAt: string | null;
  customerSignerName: string | null;
  customerSignatureUrl: string | null;
  declineReason: string | null;
  lineItems: PublicLine[];
  vehicle: { year?: number; make?: string; model?: string; vin?: string; licensePlate?: string } | null;
  customer: { firstName: string; lastName: string } | null;
  shopName: string;
}

const fmt = (n: number | string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));

function SignaturePad({ onSubmit, submitting, label }: { onSubmit: (name: string, dataUrl: string) => void; submitting: boolean; label: string; }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = c.clientWidth;
    const cssH = 180;
    c.width = cssW * dpr;
    c.height = cssH * dpr;
    c.style.height = `${cssH}px`;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#111827";
    }
  }, []);

  function pos(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function start(e: React.PointerEvent) {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const { x, y } = pos(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath(); ctx.moveTo(x, y);
    setDrawing(true);
  }
  function move(e: React.PointerEvent) {
    if (!drawing) return;
    const { x, y } = pos(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineTo(x, y); ctx.stroke();
    setHasInk(true);
  }
  function end() { setDrawing(false); }
  function clear() {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  }
  function submit() {
    if (!name.trim() || !hasInk) return;
    onSubmit(name.trim(), canvasRef.current!.toDataURL("image/png"));
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium">Your full name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your full name" className="mt-1" />
      </div>
      <div>
        <label className="text-sm font-medium">Sign below</label>
        <div className="mt-1 border-2 border-dashed border-slate-300 rounded-md bg-white">
          <canvas
            ref={canvasRef}
            className="w-full touch-none rounded-md"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
            onPointerCancel={end}
          />
        </div>
        <div className="flex justify-between mt-2">
          <Button type="button" variant="ghost" size="sm" onClick={clear}>Clear</Button>
          <span className="text-xs text-muted-foreground self-center">Use your finger or stylus</span>
        </div>
      </div>
      <Button onClick={submit} disabled={!name.trim() || !hasInk || submitting} className="w-full" size="lg">
        {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
        {label}
      </Button>
    </div>
  );
}

export default function EstimatePublic() {
  const [, params] = useRoute("/estimate/:token");
  const token = params?.token ?? "";

  const [est, setEst] = useState<PublicEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  function load() {
    setLoading(true);
    fetch(`/api/public/estimates/${token}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? "Estimate not found" : "Could not load")))
      .then(setEst)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { if (token) load(); /* eslint-disable-next-line */ }, [token]);

  async function decide(itemId: number, decision: "approved" | "declined" | "") {
    if (!est) return;
    setEst({
      ...est,
      lineItems: est.lineItems.map(li => li.id === itemId
        ? { ...li, customerDecision: decision === "" ? "pending" : decision }
        : li),
    });
    try {
      const r = await fetch(`/api/public/estimates/${token}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, decision }),
      });
      if (!r.ok) throw new Error();
    } catch {
      load();
    }
  }

  async function sign(name: string, dataUrl: string) {
    setSigning(true);
    try {
      const r = await fetch(`/api/public/estimates/${token}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerName: name, signatureDataUrl: dataUrl }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || "Could not sign");
      load();
    } catch (err: any) {
      alert(err.message || "Could not sign");
    } finally {
      setSigning(false);
    }
  }

  async function declineWhole() {
    if (!declineReason.trim()) return;
    setSigning(true);
    try {
      const r = await fetch(`/api/public/estimates/${token}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ declineReason: declineReason.trim(), declineAll: true }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || "Could not submit");
      load();
    } catch (err: any) {
      alert(err.message || "Could not submit");
    } finally {
      setSigning(false);
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
  if (error || !est) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <Card className="max-w-md w-full"><CardContent className="py-12 text-center">
        <p className="text-lg font-semibold">{error || "Not found"}</p>
        <p className="text-sm text-muted-foreground mt-2">This link may have expired or is no longer valid.</p>
      </CardContent></Card>
    </div>
  );

  const isSigned = !!est.customerSignedAt;
  const isDeclined = est.status === "declined";
  const v = est.vehicle;
  const customerName = est.customer ? `${est.customer.firstName} ${est.customer.lastName}`.trim() : null;
  const approvedTotal = est.lineItems
    .filter(li => li.customerDecision === "approved")
    .reduce((s, li) => s + Number(li.total), 0);
  const anyApproved = est.lineItems.some(li => li.customerDecision === "approved");

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-12">
      <div className="bg-violet-600 text-white">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <p className="text-xs uppercase tracking-wide opacity-90">{est.shopName}</p>
          <h1 className="text-2xl font-bold mt-1">Estimate {est.estimateNumber}</h1>
          <p className="text-sm opacity-90 mt-1">
            {v ? `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() : ""}
            {v?.licensePlate ? ` · ${v.licensePlate}` : ""}
          </p>
          {customerName && <p className="text-xs opacity-80 mt-1">Prepared for {customerName}</p>}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-5">
        {isSigned && (
          <Card className="border-green-500 bg-green-50 dark:bg-green-950/30">
            <CardContent className="py-4 flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
              <div>
                <p className="font-semibold text-green-900 dark:text-green-200">Thanks — your approval is on file.</p>
                <p className="text-sm text-green-800 dark:text-green-300">
                  Signed by <b>{est.customerSignerName}</b> on {new Date(est.customerSignedAt!).toLocaleString()}.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {isDeclined && !isSigned && (
          <Card className="border-red-500 bg-red-50 dark:bg-red-950/30">
            <CardContent className="py-4 flex items-start gap-3">
              <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
              <div>
                <p className="font-semibold text-red-900 dark:text-red-200">Estimate declined</p>
                {est.declineReason && (
                  <p className="text-sm text-red-800 dark:text-red-300">"{est.declineReason}"</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold">Recommended work</h2>
              <p className="text-sm text-muted-foreground">
                {isSigned || isDeclined
                  ? "Your decisions are locked below."
                  : "Approve or decline each line, then sign at the bottom."}
              </p>
            </div>
            <div className="space-y-3">
              {est.lineItems.map(li => (
                <LineCard
                  key={li.id}
                  line={li}
                  locked={isSigned || isDeclined}
                  onDecide={d => decide(li.id, d)}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmt(est.subtotal)}</span></div>
            {Number(est.discountAmount) > 0 && (
              <div className="flex justify-between text-destructive"><span>Discount</span><span>-{fmt(est.discountAmount)}</span></div>
            )}
            <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{fmt(est.taxAmount)}</span></div>
            <Separator />
            <div className="flex justify-between font-semibold text-base"><span>Estimated total</span><span>{fmt(est.total)}</span></div>
            {!isSigned && !isDeclined && anyApproved && (
              <div className="flex justify-between text-sm text-green-700 dark:text-green-400">
                <span>Your approved total (pre-tax)</span>
                <span>{fmt(approvedTotal)}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {!isSigned && !isDeclined && (
          <>
            <Card>
              <CardContent className="pt-5">
                <h2 className="text-base font-semibold mb-2">Approve & sign</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Once you sign, your decisions are sent to the shop and locked.
                </p>
                <SignaturePad onSubmit={sign} submitting={signing} label="Approve & sign" />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5">
                {!showDecline ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-red-500 text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                    onClick={() => setShowDecline(true)}
                  >
                    Decline the entire estimate
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <label className="text-sm font-medium">Why are you declining?</label>
                    <Textarea
                      value={declineReason}
                      onChange={e => setDeclineReason(e.target.value)}
                      placeholder="Tell us why so we can follow up"
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <Button variant="ghost" className="flex-1" onClick={() => { setShowDecline(false); setDeclineReason(""); }}>
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        className="flex-1"
                        onClick={declineWhole}
                        disabled={!declineReason.trim() || signing}
                      >
                        {signing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        Submit decline
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {isSigned && est.customerSignatureUrl && (
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Signature on file</p>
              <img
                src={`/api/public/estimates/${token}/signature`}
                alt="Customer signature"
                className="max-h-32 bg-white border rounded-md p-2"
              />
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground text-center pt-4">
          Questions? Reply to the message we sent you and we'll be right with you.
        </p>
      </div>
    </div>
  );
}

function LineCard({ line, locked, onDecide }: {
  line: PublicLine;
  locked: boolean;
  onDecide: (d: "approved" | "declined" | "") => void;
}) {
  const borderColor =
    line.customerDecision === "approved" ? "border-green-500" :
    line.customerDecision === "declined" ? "border-red-500" :
    "border-slate-200 dark:border-slate-800";
  return (
    <div className={`border-l-4 ${borderColor} bg-card rounded-md p-3`}>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="font-semibold">{line.description}</p>
        <span className="text-sm font-medium tabular-nums">{fmt(line.total)}</span>
      </div>
      <p className="text-xs text-muted-foreground capitalize mt-0.5">
        {line.type} · {Number(line.quantity)} × {fmt(line.unitPrice)}
        {line.partNumber ? ` · ${line.partNumber}` : ""}
      </p>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <Button
          type="button" size="sm" disabled={locked}
          variant={line.customerDecision === "approved" ? "default" : "outline"}
          className={line.customerDecision === "approved" ? "bg-green-600 hover:bg-green-700" : "border-green-500 text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"}
          onClick={() => onDecide(line.customerDecision === "approved" ? "" : "approved")}
        >
          <Check className="h-4 w-4 mr-1" /> Approve
        </Button>
        <Button
          type="button" size="sm" disabled={locked}
          variant={line.customerDecision === "declined" ? "destructive" : "outline"}
          className={line.customerDecision === "declined" ? "" : "border-red-500 text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"}
          onClick={() => onDecide(line.customerDecision === "declined" ? "" : "declined")}
        >
          <X className="h-4 w-4 mr-1" /> Decline
        </Button>
      </div>
    </div>
  );
}
