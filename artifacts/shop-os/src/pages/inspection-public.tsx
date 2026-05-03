import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Check, X, AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";

interface PublicItem {
  id: string;
  label: string;
  status: string;
  note?: string;
  photos?: string[];
  customerDecision?: "approved" | "declined" | null;
  estimatedCost?: number | null;
}
interface PublicInspection {
  id: number;
  type: string;
  overallCondition: string;
  notes: string | null;
  items: PublicItem[];
  createdAt: string;
  sentAt: string | null;
  customerSignedAt: string | null;
  customerSignerName: string | null;
  customerSignatureUrl: string | null;
  vehicle: { year?: number; make?: string; model?: string; vin?: string; licensePlate?: string; mileage?: number } | null;
  customer: { firstName: string; lastName: string } | null;
  shopName: string;
}

const STATUS_CFG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  pass:          { label: "Looks good",        bg: "bg-green-50 dark:bg-green-950/30", text: "text-green-700 dark:text-green-300", border: "border-green-500" },
  attention:     { label: "Needs attention",   bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-300", border: "border-amber-500" },
  fail:          { label: "Action required",   bg: "bg-red-50 dark:bg-red-950/30",     text: "text-red-700 dark:text-red-300",     border: "border-red-600" },
  not_inspected: { label: "Not inspected",     bg: "bg-slate-50 dark:bg-slate-900/40", text: "text-slate-600 dark:text-slate-300", border: "border-slate-300" },
  // legacy
  ok:              { label: "Looks good",      bg: "bg-green-50 dark:bg-green-950/30", text: "text-green-700 dark:text-green-300", border: "border-green-500" },
  needs_attention: { label: "Needs attention", bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-300", border: "border-amber-500" },
  urgent:          { label: "Action required", bg: "bg-red-50 dark:bg-red-950/30",     text: "text-red-700 dark:text-red-300",     border: "border-red-600" },
  na:              { label: "Not inspected",   bg: "bg-slate-50 dark:bg-slate-900/40", text: "text-slate-600 dark:text-slate-300", border: "border-slate-300" },
};

function StatusIcon({ status }: { status: string }) {
  if (status === "pass" || status === "ok") return <CheckCircle2 className="h-5 w-5 text-green-600" />;
  if (status === "attention" || status === "needs_attention") return <AlertTriangle className="h-5 w-5 text-amber-600" />;
  if (status === "fail" || status === "urgent") return <AlertTriangle className="h-5 w-5 text-red-600" />;
  return <MinusCircle className="h-5 w-5 text-slate-400" />;
}

function SignaturePad({ onSubmit, submitting }: { onSubmit: (name: string, dataUrl: string) => void; submitting: boolean; }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    // High-DPI sizing
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

  function pointerPos(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function start(e: React.PointerEvent) {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const { x, y } = pointerPos(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
  }
  function move(e: React.PointerEvent) {
    if (!drawing) return;
    const { x, y } = pointerPos(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineTo(x, y);
    ctx.stroke();
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
    const dataUrl = canvasRef.current!.toDataURL("image/png");
    onSubmit(name.trim(), dataUrl);
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
        Approve & sign
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        By signing, you authorize the work you marked Approved above.
      </p>
    </div>
  );
}

export default function InspectionPublic() {
  const [, params] = useRoute("/inspection/:token");
  const token = params?.token ?? "";

  const [insp, setInsp] = useState<PublicInspection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  function load() {
    setLoading(true);
    fetch(`/api/public/inspections/${token}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? "Inspection not found" : "Could not load")))
      .then(setInsp)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { if (token) load(); /* eslint-disable-next-line */ }, [token]);

  async function decide(itemId: string, decision: "approved" | "declined" | "") {
    if (!insp) return;
    // Optimistic
    setInsp({
      ...insp,
      items: insp.items.map(i => i.id === itemId ? { ...i, customerDecision: decision === "" ? null : decision } : i),
    });
    try {
      const r = await fetch(`/api/public/inspections/${token}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, decision }),
      });
      if (!r.ok) throw new Error("Could not save decision");
    } catch (err) {
      load(); // rollback by reloading
    }
  }

  async function sign(name: string, dataUrl: string) {
    setSigning(true);
    try {
      const r = await fetch(`/api/public/inspections/${token}/sign`, {
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

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
  if (error || !insp) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <Card className="max-w-md w-full"><CardContent className="py-12 text-center">
        <p className="text-lg font-semibold">{error || "Not found"}</p>
        <p className="text-sm text-muted-foreground mt-2">This link may have expired or is no longer valid.</p>
      </CardContent></Card>
    </div>
  );

  const v = insp.vehicle;
  const customerName = insp.customer ? `${insp.customer.firstName} ${insp.customer.lastName}`.trim() : null;
  const actionable = insp.items.filter(i =>
    ["attention","fail","needs_attention","urgent"].includes(i.status)
  );
  const informational = insp.items.filter(i => !actionable.includes(i));
  const isSigned = !!insp.customerSignedAt;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-12">
      <div className="bg-teal-600 text-white">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <p className="text-xs uppercase tracking-wide opacity-90">{insp.shopName}</p>
          <h1 className="text-2xl font-bold mt-1">Vehicle Inspection</h1>
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
                <p className="font-semibold text-green-900 dark:text-green-200">Thanks — we received your decisions!</p>
                <p className="text-sm text-green-800 dark:text-green-300">
                  Signed by <b>{insp.customerSignerName}</b> on {new Date(insp.customerSignedAt!).toLocaleString()}.
                  We'll get to work and reach out with any questions.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {actionable.length > 0 && (
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-2">Recommended work</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Tap <b>Approve</b> to authorize each item, or <b>Decline</b> to skip.
            </p>
            <div className="space-y-3">
              {actionable.map(it => <ItemCard key={it.id} item={it} token={token} onDecide={decide} locked={isSigned} />)}
            </div>
          </div>
        )}

        {informational.length > 0 && (
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-2">Other items inspected</h2>
            <div className="space-y-2">
              {informational.map(it => <ItemCard key={it.id} item={it} token={token} compact locked={isSigned} />)}
            </div>
          </div>
        )}

        {!isSigned && actionable.length > 0 && (
          <Card>
            <CardContent className="pt-5">
              <h2 className="text-base font-semibold mb-2">Approve & sign</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Once you sign, your decisions are sent to the shop and locked.
              </p>
              <SignaturePad onSubmit={sign} submitting={signing} />
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

function ItemCard({
  item, token, onDecide, compact, locked,
}: {
  item: PublicItem;
  token: string;
  onDecide?: (id: string, d: "approved" | "declined" | "") => void;
  compact?: boolean;
  locked?: boolean;
}) {
  const cfg = STATUS_CFG[item.status] ?? STATUS_CFG.not_inspected;
  return (
    <Card className={`border-l-4 ${cfg.border}`}>
      <CardContent className={compact ? "py-3" : "py-4"}>
        <div className="flex items-start gap-3">
          <StatusIcon status={item.status} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <p className="font-semibold">{item.label}</p>
              <span className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</span>
            </div>
            {item.note && <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">{item.note}</p>}
            {item.estimatedCost != null && (
              <p className="text-sm font-medium mt-1">Estimated cost: ${Number(item.estimatedCost).toFixed(2)}</p>
            )}

            {Array.isArray(item.photos) && item.photos.length > 0 && (
              <div className="flex gap-2 mt-3 overflow-x-auto -mx-1 px-1">
                {item.photos.map((p, j) => (
                  <a key={j} href={`/api/public/inspections/${token}/photo?p=${encodeURIComponent(p)}`} target="_blank" rel="noreferrer" className="shrink-0">
                    <img
                      src={`/api/public/inspections/${token}/photo?p=${encodeURIComponent(p)}`}
                      alt=""
                      className="h-24 w-24 object-cover rounded-md border"
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            )}

            {onDecide && !compact && (
              <div className="grid grid-cols-2 gap-2 mt-4">
                <Button
                  type="button"
                  size="lg"
                  disabled={locked}
                  variant={item.customerDecision === "approved" ? "default" : "outline"}
                  className={item.customerDecision === "approved" ? "bg-green-600 hover:bg-green-700" : "border-green-500 text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"}
                  onClick={() => onDecide(item.id, item.customerDecision === "approved" ? "" : "approved")}
                >
                  <Check className="h-4 w-4 mr-1" /> Approve
                </Button>
                <Button
                  type="button"
                  size="lg"
                  disabled={locked}
                  variant={item.customerDecision === "declined" ? "destructive" : "outline"}
                  className={item.customerDecision === "declined" ? "" : "border-red-500 text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"}
                  onClick={() => onDecide(item.id, item.customerDecision === "declined" ? "" : "declined")}
                >
                  <X className="h-4 w-4 mr-1" /> Decline
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
