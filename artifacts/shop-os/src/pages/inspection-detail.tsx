import { useRoute, useLocation } from "wouter";
import { useGetInspection } from "@workspace/api-client-react";
import { AttachmentsPanel } from "@/components/attachments-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Printer, Pencil, Loader2 } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  ok: "OK",
  needs_attention: "Needs Attention",
  urgent: "Urgent",
  na: "N/A",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ok: "default",
  needs_attention: "secondary",
  urgent: "destructive",
  na: "outline",
};

export default function InspectionDetail() {
  const [, params] = useRoute("/inspections/:id");
  const [, setLocation] = useLocation();
  const id = Number(params?.id);
  const { data: inspection, isLoading } = useGetInspection(id, { query: { enabled: id > 0 } });

  function handlePrint() {
    if (!inspection) return;
    const insp: any = inspection;
    const v = insp.vehicle || {};
    const items: any[] = Array.isArray(insp.items) ? insp.items : [];
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    const rows = items.map((it) => `
      <tr>
        <td>${escape(it.label || "")}</td>
        <td>${escape(STATUS_LABEL[it.status] || it.status || "")}</td>
        <td>${escape(it.notes || "")}</td>
      </tr>`).join("");
    w.document.write(`<!doctype html><html><head><title>Inspection #${insp.id}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;color:#111}
        h1{margin:0 0 4px} h2{margin:24px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}
        .meta{color:#555;font-size:13px;margin-bottom:16px}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-bottom:12px}
        .grid div b{display:inline-block;min-width:130px;color:#444}
        table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
        th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
        th{background:#f4f4f4}
        .notes{white-space:pre-wrap;border:1px solid #ddd;padding:8px;border-radius:4px;background:#fafafa}
      </style></head><body>
      <h1>Inspection #${insp.id}</h1>
      <div class="meta">${escape(insp.type || "")} &middot; ${new Date(insp.createdAt).toLocaleString()}</div>
      <h2>Vehicle</h2>
      <div class="grid">
        <div><b>Vehicle:</b> ${escape(`${v.year || ""} ${v.make || ""} ${v.model || ""}`.trim())}</div>
        <div><b>VIN:</b> ${escape(v.vin || "")}</div>
        <div><b>Plate:</b> ${escape(v.licensePlate || "")}</div>
        <div><b>Mileage:</b> ${insp.mileage ?? ""}</div>
        <div><b>Overall Condition:</b> ${escape(insp.overallCondition || "")}</div>
        <div><b>Inspector:</b> ${escape(insp.inspectedBy?.name || "")}</div>
      </div>
      <h2>Items</h2>
      <table><thead><tr><th>Item</th><th>Status</th><th>Notes</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No items</td></tr>'}</tbody></table>
      ${insp.notes ? `<h2>Notes</h2><div class="notes">${escape(insp.notes)}</div>` : ""}
      </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
  }

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!inspection) return <div className="p-8">Inspection not found.</div>;
  const insp: any = inspection;
  const v = insp.vehicle || {};
  const items: any[] = Array.isArray(insp.items) ? insp.items : [];

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/inspections")}><ArrowLeft className="h-5 w-5" /></Button>
          <div>
            <h1 className="text-3xl font-bold">Inspection #{insp.id}</h1>
            <p className="text-muted-foreground">{insp.type} &middot; {new Date(insp.createdAt).toLocaleString()}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePrint}><Printer className="h-4 w-4 mr-2" /> Print</Button>
          <Button variant="outline" onClick={() => setLocation(`/inspections/new?edit=${insp.id}`)}><Pencil className="h-4 w-4 mr-2" /> Edit</Button>
        </div>
      </div>

      <Card className="shadow-sm border-border">
        <CardHeader><CardTitle className="text-lg">Vehicle</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div><span className="text-muted-foreground">Vehicle: </span>{`${v.year || ""} ${v.make || ""} ${v.model || ""}`.trim() || "—"}</div>
          <div><span className="text-muted-foreground">VIN: </span>{v.vin || "—"}</div>
          <div><span className="text-muted-foreground">Plate: </span>{v.licensePlate || "—"}</div>
          <div><span className="text-muted-foreground">Mileage: </span>{insp.mileage ?? "—"}</div>
          <div><span className="text-muted-foreground">Overall Condition: </span><span className="capitalize">{insp.overallCondition || "—"}</span></div>
          <div><span className="text-muted-foreground">Inspector: </span>{insp.inspectedBy?.name || "—"}</div>
        </CardContent>
      </Card>

      <Card className="shadow-sm border-border">
        <CardHeader><CardTitle className="text-lg">Items</CardTitle></CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items recorded.</p>
          ) : (
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex items-start justify-between gap-4 p-3 border rounded-md">
                  <div className="flex-1">
                    <p className="font-medium">{it.label}</p>
                    {it.notes && <p className="text-sm text-muted-foreground mt-1">{it.notes}</p>}
                  </div>
                  <Badge variant={STATUS_VARIANT[it.status] || "outline"}>{STATUS_LABEL[it.status] || it.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {insp.notes && (
        <Card className="shadow-sm border-border">
          <CardHeader><CardTitle className="text-lg">Notes</CardTitle></CardHeader>
          <CardContent><p className="text-sm whitespace-pre-wrap">{insp.notes}</p></CardContent>
        </Card>
      )}

      {id > 0 && (
        <AttachmentsPanel
          ownerType="inspection"
          ownerId={id}
          title="Photos & Documents"
          description="Walk-around photos, condition shots, and supporting documents."
        />
      )}
    </div>
  );
}

function escape(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
