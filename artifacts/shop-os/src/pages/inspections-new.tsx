import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useGetVehicles, getGetVehiclesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2, Camera, Mic, MicOff, Loader2, X } from "lucide-react";

type Status = "pass" | "attention" | "fail" | "not_inspected";

interface InspectionItem {
  id: string;
  label: string;
  status: Status;
  note: string;
  photos: string[];
  estimatedCost?: number | null;
}

const DEFAULT_ITEMS: { label: string; status: Status }[] = [
  { label: "Brakes (front)", status: "not_inspected" },
  { label: "Brakes (rear)", status: "not_inspected" },
  { label: "Tires (tread depth)", status: "not_inspected" },
  { label: "Battery", status: "not_inspected" },
  { label: "Engine oil", status: "not_inspected" },
  { label: "Coolant", status: "not_inspected" },
  { label: "Wipers", status: "not_inspected" },
  { label: "Lights", status: "not_inspected" },
  { label: "Suspension", status: "not_inspected" },
  { label: "Belts & hoses", status: "not_inspected" },
];

const STATUS_CFG: Record<Status, { label: string; cls: string; chipCls: string }> = {
  pass:           { label: "Pass",          cls: "bg-green-600 text-white hover:bg-green-700",       chipCls: "border-green-600 text-green-700 dark:text-green-300" },
  attention:      { label: "Attention",     cls: "bg-amber-500 text-white hover:bg-amber-600",       chipCls: "border-amber-500 text-amber-700 dark:text-amber-300" },
  fail:           { label: "Fail",          cls: "bg-red-600 text-white hover:bg-red-700",           chipCls: "border-red-600 text-red-700 dark:text-red-300" },
  not_inspected:  { label: "Not inspected", cls: "bg-slate-400 text-white hover:bg-slate-500",       chipCls: "border-slate-400 text-slate-600 dark:text-slate-300" },
};

function newId() { return `it-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; }

async function uploadPhoto(file: File): Promise<string> {
  const r = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!r.ok) throw new Error("Could not get upload URL");
  const { uploadURL, objectPath } = await r.json();
  const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!put.ok) throw new Error("Upload failed");
  return objectPath as string;
}

function VoiceMic({ onTranscript }: { onTranscript: (t: string) => void }) {
  const [active, setActive] = useState(false);
  const recRef = useRef<any>(null);
  const SR = typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;
  if (!SR) return null;

  function toggle() {
    if (active && recRef.current) {
      recRef.current.stop();
      setActive(false);
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e: any) => {
      let txt = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) txt += e.results[i][0].transcript + " ";
      }
      if (txt.trim()) onTranscript(txt.trim());
    };
    rec.onend = () => setActive(false);
    rec.onerror = () => setActive(false);
    rec.start();
    recRef.current = rec;
    setActive(true);
  }

  return (
    <Button type="button" variant={active ? "default" : "outline"} size="sm" onClick={toggle} title={active ? "Stop dictating" : "Dictate note"}>
      {active ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
    </Button>
  );
}

function ItemRow({
  item, onChange, onRemove,
}: { item: InspectionItem; onChange: (i: InspectionItem) => void; onRemove: () => void; }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const cfg = STATUS_CFG[item.status];

  async function handleFiles(fl: FileList | null) {
    if (!fl || fl.length === 0) return;
    setUploading(true);
    try {
      const newPaths: string[] = [];
      for (const f of Array.from(fl)) {
        const p = await uploadPhoto(f);
        newPaths.push(p);
      }
      onChange({ ...item, photos: [...item.photos, ...newPaths] });
    } catch (err) { console.error(err); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <div className={`border rounded-md p-3 space-y-3 border-l-4`} style={{ borderLeftColor:
      item.status === "pass" ? "#16a34a" :
      item.status === "attention" ? "#f59e0b" :
      item.status === "fail" ? "#dc2626" : "#94a3b8" }}>
      <div className="flex items-start gap-2">
        <Input
          value={item.label}
          onChange={(e) => onChange({ ...item, label: e.target.value })}
          placeholder="Item (e.g. Front brake pads)"
          className="flex-1"
        />
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} className="text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["pass","attention","fail","not_inspected"] as Status[]).map(s => (
          <Button
            key={s}
            type="button"
            size="sm"
            variant={item.status === s ? "default" : "outline"}
            className={item.status === s ? STATUS_CFG[s].cls : ""}
            onClick={() => onChange({ ...item, status: s })}
          >
            {STATUS_CFG[s].label}
          </Button>
        ))}
      </div>

      <div className="flex items-start gap-2">
        <Textarea
          value={item.note}
          onChange={(e) => onChange({ ...item, note: e.target.value })}
          placeholder="Notes for the customer (e.g. 3mm pads remaining, recommend replacement)"
          rows={2}
          className="flex-1"
        />
        <VoiceMic onTranscript={(t) => onChange({ ...item, note: (item.note ? item.note + " " : "") + t })} />
      </div>

      {(item.status === "attention" || item.status === "fail") && (
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Est. cost</Label>
          <Input
            type="number" step="0.01" inputMode="decimal"
            value={item.estimatedCost ?? ""}
            onChange={(e) => onChange({ ...item, estimatedCost: e.target.value === "" ? null : Number(e.target.value) })}
            className="w-32 h-8"
            placeholder="0.00"
          />
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground">Photos ({item.photos.length})</span>
          <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Camera className="h-3.5 w-3.5 mr-1" />}
            {uploading ? "Uploading…" : "Add photo"}
          </Button>
          <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" className="hidden"
            onChange={(e) => handleFiles(e.target.files)} />
        </div>
        {item.photos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {item.photos.map((p, i) => (
              <div key={p + i} className="relative h-20 w-20 rounded border overflow-hidden group">
                <img src={`/api${p.startsWith("/") ? "/storage" + p : p}`} alt="" className="h-full w-full object-cover" />
                <button type="button"
                  onClick={() => onChange({ ...item, photos: item.photos.filter((x) => x !== p) })}
                  className="absolute top-0 right-0 bg-black/60 text-white rounded-bl px-1 py-0.5 opacity-0 group-hover:opacity-100">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${cfg.chipCls}`}>{cfg.label}</div>
    </div>
  );
}

export default function InspectionsNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [savedId, setSavedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const editId = params.get("edit") ? Number(params.get("edit")) : null;

  const { data: vehicles } = useGetVehicles({ limit: 200 }, { query: { queryKey: getGetVehiclesQueryKey({ limit: 200 }) } });

  const [vehicleId, setVehicleId] = useState<number | "">("");
  const [type, setType] = useState("Multi-Point Inspection");
  const [overallCondition, setOverallCondition] = useState("good");
  const [mileage, setMileage] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<InspectionItem[]>(
    DEFAULT_ITEMS.map((d) => ({ id: newId(), label: d.label, status: d.status, note: "", photos: [] }))
  );

  // Load existing inspection on edit
  useEffect(() => {
    if (!editId) return;
    fetch(`/api/inspections/${editId}`, { credentials: "include" }).then(r => r.json()).then((d) => {
      setSavedId(d.id);
      setVehicleId(d.vehicleId);
      setType(d.type || "Multi-Point Inspection");
      setOverallCondition(d.overallCondition || "good");
      setMileage(d.mileage ? String(d.mileage) : "");
      setNotes(d.notes || "");
      const arr: any[] = Array.isArray(d.items) ? d.items : [];
      if (arr.length) {
        setItems(arr.map((it: any, idx: number): InspectionItem => ({
          id: it.id || `it-${idx}`,
          label: it.label || "",
          status: ((): Status => {
            const s = it.status;
            if (s === "pass" || s === "attention" || s === "fail" || s === "not_inspected") return s;
            if (s === "ok") return "pass";
            if (s === "needs_attention") return "attention";
            if (s === "urgent") return "fail";
            return "not_inspected";
          })(),
          note: it.note || it.notes || "",
          photos: Array.isArray(it.photos) ? it.photos : [],
          estimatedCost: it.estimatedCost ?? null,
        })));
      }
    }).catch(() => {});
  }, [editId]);

  async function save() {
    if (!vehicleId) {
      toast({ title: "Select a vehicle", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const body = {
        vehicleId: Number(vehicleId),
        type,
        overallCondition,
        mileage: mileage ? Number(mileage) : null,
        notes,
        items,
      };
      const url = savedId ? `/api/inspections/${savedId}` : "/api/inspections";
      const method = savedId ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setSavedId(data.id);
      toast({ title: savedId ? "Inspection updated" : "Inspection saved" });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/inspections")}><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-2xl md:text-3xl font-bold">{editId ? "Edit Inspection" : "New Inspection"}</h1>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Vehicle & overview</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Vehicle</Label>
            <Select value={vehicleId ? String(vehicleId) : undefined} onValueChange={(v) => setVehicleId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Select a vehicle" /></SelectTrigger>
              <SelectContent>
                {vehicles?.data?.map((v: any) => (
                  <SelectItem key={v.id} value={String(v.id)}>
                    {v.year} {v.make} {v.model}{v.licensePlate ? ` · ${v.licensePlate}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Inspection Type</Label>
            <Input value={type} onChange={(e) => setType(e.target.value)} />
          </div>
          <div>
            <Label>Overall Condition</Label>
            <Select value={overallCondition} onValueChange={setOverallCondition}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="fair">Fair</SelectItem>
                <SelectItem value="poor">Poor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Mileage</Label>
            <Input type="number" inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>Notes (internal)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Inspection items</CardTitle>
          <Button type="button" size="sm" variant="outline"
            onClick={() => setItems([...items, { id: newId(), label: "", status: "not_inspected", note: "", photos: [] }])}>
            <Plus className="h-4 w-4 mr-1" /> Add item
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((it, idx) => (
            <ItemRow
              key={it.id}
              item={it}
              onChange={(next) => setItems(items.map((x, i) => i === idx ? next : x))}
              onRemove={() => setItems(items.filter((_, i) => i !== idx))}
            />
          ))}
        </CardContent>
      </Card>

      <div className="sticky bottom-0 bg-background/95 backdrop-blur py-3 border-t flex items-center justify-end gap-2 -mx-4 px-4 md:mx-0 md:px-0 md:border-0 md:static md:bg-transparent">
        {savedId && (
          <Button type="button" variant="outline" onClick={() => setLocation(`/inspections/${savedId}`)}>
            View detail
          </Button>
        )}
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {savedId ? "Update" : "Save inspection"}
        </Button>
      </div>
    </div>
  );
}
