import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Printer, Pencil, Loader2, Send, Link as LinkIcon,
  Check, X, MinusCircle, RefreshCw,
} from "lucide-react";

type Status = "pass" | "attention" | "fail" | "not_inspected" | string;

const STATUS_LABEL: Record<string, string> = {
  pass: "Pass", attention: "Attention", fail: "Fail", not_inspected: "Not inspected",
  ok: "OK", needs_attention: "Needs Attention", urgent: "Urgent", na: "N/A",
};
const STATUS_COLOR: Record<string, string> = {
  pass: "#16a34a", attention: "#f59e0b", fail: "#dc2626", not_inspected: "#94a3b8",
  ok: "#16a34a", needs_attention: "#f59e0b", urgent: "#dc2626", na: "#94a3b8",
};

function decisionBadge(decision?: string | null) {
  if (decision === "approved") return <Badge className="bg-green-600 hover:bg-green-700"><Check className="h-3 w-3 mr-1" />Approved</Badge>;
  if (decision === "declined") return <Badge variant="destructive"><X className="h-3 w-3 mr-1" />Declined</Badge>;
  return <Badge variant="outline" className="text-muted-foreground"><MinusCircle className="h-3 w-3 mr-1" />Awaiting</Badge>;
}

export default function InspectionDetail() {
  const [, params] = useRoute("/inspections/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const id = Number(params?.id);
  const [inspection, setInspection] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [linkInfo, setLinkInfo] = useState<{ url: string; token: string } | null>(null);

  function load() {
    setLoading(true);
    fetch(`/api/inspections/${id}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("Not found")))
      .then((d) => { setInspection(d); if (d.publicToken) {
        const base = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "");
        setLinkInfo({ token: d.publicToken, url: `${base}/inspection/${d.publicToken}` });
      }})
      .catch(() => setInspection(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => { if (id > 0) load(); /* eslint-disable-next-line */ }, [id]);

  async function send() {
    setSending(true);
    try {
      const r = await fetch(`/api/inspections/${id}/send`, { method: "POST", credentials: "include" });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.errors?.join("; ") || "Send failed");
      setLinkInfo({ token: d.token, url: d.url });
      toast({
        title: "Sent to customer",
        description: `${d.emailed ? "Emailed" : ""}${d.emailed && d.smsed ? " + " : ""}${d.smsed ? "Texted" : ""} via ${d.channel}`,
      });
      load();
    } catch (err: any) {
      toast({ title: "Could not send", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  async function copyLink() {
    let url = linkInfo?.url;
    if (!url) {
      const r = await fetch(`/api/inspections/${id}/public-link`, { method: "POST", credentials: "include" });
      const d = await r.json();
      url = d.url;
      if (d.token) setLinkInfo({ url: d.url, token: d.token });
    }
    if (url) {
      try { await navigator.clipboard.writeText(url); toast({ title: "Link copied" }); }
      catch { window.prompt("Copy this link:", url); }
    }
  }

  function handlePrint() {
    if (!inspection) return;
    const v = inspection.vehicle || {};
    const items: any[] = Array.isArray(inspection.items) ? inspection.items : [];
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    const rows = items.map((it) => `
      <tr>
        <td>${esc(it.label || "")}</td>
        <td><span style="display:inline-block;width:10px;height:10px;background:${STATUS_COLOR[it.status] || "#999"};margin-right:6px;border-radius:50%"></span>${esc(STATUS_LABEL[it.status] || it.status || "")}</td>
        <td>${esc(it.note || it.notes || "")}</td>
        <td>${it.customerDecision === "approved" ? "✓ Approved" : it.customerDecision === "declined" ? "✗ Declined" : "—"}</td>
      </tr>`).join("");
    w.document.write(`<!doctype html><html><head><title>Inspection #${inspection.id}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{margin:0 0 4px}h2{margin:24px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}.meta{color:#555;font-size:13px;margin-bottom:16px}table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f4f4f4}</style></head><body>
      <h1>Inspection #${inspection.id}</h1>
      <div class="meta">${esc(inspection.type || "")} · ${new Date(inspection.createdAt).toLocaleString()}</div>
      <h2>Vehicle</h2>
      <p>${esc(`${v.year || ""} ${v.make || ""} ${v.model || ""}`.trim())} · VIN ${esc(v.vin || "—")} · Plate ${esc(v.licensePlate || "—")}</p>
      <h2>Items</h2>
      <table><thead><tr><th>Item</th><th>Status</th><th>Note</th><th>Customer</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No items</td></tr>'}</tbody></table>
      ${inspection.customerSignedAt ? `<h2>Customer signature</h2><p>Signed by <b>${esc(inspection.customerSignerName || "")}</b> on ${new Date(inspection.customerSignedAt).toLocaleString()}</p>` : ""}
      </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
  }

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!inspection) return <div className="p-8">Inspection not found.</div>;

  const v = inspection.vehicle || {};
  const items: any[] = Array.isArray(inspection.items) ? inspection.items : [];
  const decided = items.filter((it: any) => it.customerDecision).length;
  const approved = items.filter((it: any) => it.customerDecision === "approved").length;
  const declined = items.filter((it: any) => it.customerDecision === "declined").length;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/inspections")}><ArrowLeft className="h-5 w-5" /></Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Inspection #{inspection.id}</h1>
            <p className="text-muted-foreground text-sm">{inspection.type} · {new Date(inspection.createdAt).toLocaleString()}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
          <Button variant="outline" size="sm" onClick={handlePrint}><Printer className="h-4 w-4 mr-1" /> Print</Button>
          <Button variant="outline" size="sm" onClick={() => setLocation(`/inspections/new?edit=${inspection.id}`)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
          <Button variant="outline" size="sm" onClick={copyLink}><LinkIcon className="h-4 w-4 mr-1" /> Copy link</Button>
          <Button size="sm" onClick={send} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
            {inspection.sentAt ? "Resend" : "Send to customer"}
          </Button>
        </div>
      </div>

      {linkInfo && (
        <Card><CardContent className="py-3 text-xs flex items-center gap-2 break-all">
          <LinkIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="font-mono">{linkInfo.url}</span>
        </CardContent></Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Vehicle</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
          <div><span className="text-muted-foreground">Vehicle: </span>{`${v.year || ""} ${v.make || ""} ${v.model || ""}`.trim() || "—"}</div>
          <div><span className="text-muted-foreground">VIN: </span>{v.vin || "—"}</div>
          <div><span className="text-muted-foreground">Plate: </span>{v.licensePlate || "—"}</div>
          <div><span className="text-muted-foreground">Mileage: </span>{inspection.mileage ?? "—"}</div>
          <div><span className="text-muted-foreground">Overall: </span><span className="capitalize">{inspection.overallCondition || "—"}</span></div>
          <div><span className="text-muted-foreground">Sent: </span>{inspection.sentAt ? new Date(inspection.sentAt).toLocaleString() : "Not yet"}</div>
        </CardContent>
      </Card>

      {inspection.sentAt && (
        <Card className="border-blue-500/40 bg-blue-50/30 dark:bg-blue-950/20">
          <CardContent className="py-3 flex items-center gap-3 text-sm">
            <div className="font-medium">Customer responses:</div>
            <Badge className="bg-green-600 hover:bg-green-700">{approved} approved</Badge>
            <Badge variant="destructive">{declined} declined</Badge>
            <Badge variant="outline">{items.length - decided} pending</Badge>
            {inspection.customerSignedAt && (
              <Badge className="bg-blue-600 hover:bg-blue-700 ml-auto">
                Signed by {inspection.customerSignerName} · {new Date(inspection.customerSignedAt).toLocaleDateString()}
              </Badge>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Items ({items.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items recorded.</p>
          ) : items.map((it: any, i: number) => (
            <div key={i} className="border rounded p-3 border-l-4" style={{ borderLeftColor: STATUS_COLOR[it.status] || "#999" }}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{it.label}</div>
                  {(it.note || it.notes) && <div className="text-sm text-muted-foreground mt-1">{it.note || it.notes}</div>}
                  {it.estimatedCost != null && <div className="text-xs text-muted-foreground mt-1">Est. ${Number(it.estimatedCost).toFixed(2)}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" style={{ borderColor: STATUS_COLOR[it.status] || "#999", color: STATUS_COLOR[it.status] || "#999" }}>
                    {STATUS_LABEL[it.status] || it.status}
                  </Badge>
                  {decisionBadge(it.customerDecision)}
                </div>
              </div>
              {Array.isArray(it.photos) && it.photos.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {it.photos.map((p: string, j: number) => (
                    <a key={j} href={`/api/storage${p}`} target="_blank" rel="noreferrer" className="block">
                      <img src={`/api/storage${p}`} alt="" className="h-20 w-20 object-cover rounded border" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {inspection.notes && (
        <Card><CardHeader><CardTitle className="text-base">Internal notes</CardTitle></CardHeader>
        <CardContent><p className="text-sm whitespace-pre-wrap">{inspection.notes}</p></CardContent></Card>
      )}

      {inspection.customerSignatureUrl && linkInfo?.token && (
        <Card><CardHeader><CardTitle className="text-base">Customer signature</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">
              Signed by <b>{inspection.customerSignerName}</b> on {new Date(inspection.customerSignedAt).toLocaleString()}
            </p>
            <img
              src={`/api/public/inspections/${linkInfo.token}/signature`}
              alt="Customer signature"
              className="border rounded bg-white max-h-32"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function esc(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
