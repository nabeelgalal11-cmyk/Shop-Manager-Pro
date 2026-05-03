import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Loader2, Wrench } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type CannedJobItem = { type: "labor" | "part" | "fee" | "discount"; description: string; quantity: number; unitPrice: number };
type CannedJob = { id: number; name: string; category?: string | null; description?: string | null; estimatedHours?: string | null; items: CannedJobItem[] };

const fmt = (n: number | string) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);

async function api(path: string, opts?: RequestInit) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  if (r.status === 204) return null;
  return r.json();
}

export default function CannedJobs() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CannedJob | null>(null);
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<CannedJob[]>({
    queryKey: ["/api/canned-jobs", search],
    queryFn: () => api(`/api/canned-jobs${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  });

  const saveMut = useMutation({
    mutationFn: (j: any) =>
      api(j.id ? `/api/canned-jobs/${j.id}` : "/api/canned-jobs", {
        method: j.id ? "PUT" : "POST",
        body: JSON.stringify(j),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/canned-jobs"] });
      setOpen(false);
      setEditing(null);
      toast({ title: "Saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api(`/api/canned-jobs/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/canned-jobs"] });
      toast({ title: "Deleted" });
    },
  });

  function openNew() {
    setEditing({ id: 0 as any, name: "", category: "", description: "", estimatedHours: "", items: [{ type: "labor", description: "", quantity: 1, unitPrice: 0 }] });
    setOpen(true);
  }
  function openEdit(j: CannedJob) {
    setEditing({ ...j, items: j.items?.length ? j.items : [{ type: "labor", description: "", quantity: 1, unitPrice: 0 }] });
    setOpen(true);
  }

  const items = data || [];

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Wrench className="h-7 w-7" /> Canned Jobs</h1>
          <p className="text-muted-foreground">Reusable service templates — drop into estimates with one click.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> New Canned Job</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editing?.id ? "Edit Canned Job" : "New Canned Job"}</DialogTitle></DialogHeader>
            {editing && <CannedJobForm value={editing} onChange={setEditing} />}
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => editing && saveMut.mutate(editing)} disabled={saveMut.isPending || !editing?.name}>
                {saveMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-sm border-border">
        <CardHeader className="pb-3">
          <Input placeholder="Search by name or category…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Labor Hrs</TableHead><TableHead className="text-right">Items</TableHead><TableHead className="text-right">Default Total</TableHead><TableHead className="w-[120px]"></TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No canned jobs yet. Create your first template.</TableCell></TableRow>
              ) : items.map((j) => {
                const total = (j.items || []).reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0) * (it.type === "discount" ? -1 : 1), 0);
                return (
                  <TableRow key={j.id}>
                    <TableCell className="font-medium">{j.name}{j.description ? <p className="text-xs text-muted-foreground">{j.description}</p> : null}</TableCell>
                    <TableCell>{j.category || "—"}</TableCell>
                    <TableCell className="text-right">{j.estimatedHours || "—"}</TableCell>
                    <TableCell className="text-right">{j.items?.length || 0}</TableCell>
                    <TableCell className="text-right">{fmt(total)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(j)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Delete "${j.name}"?`)) deleteMut.mutate(j.id); }} className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function CannedJobForm({ value, onChange }: { value: CannedJob; onChange: (v: CannedJob) => void }) {
  const update = (patch: Partial<CannedJob>) => onChange({ ...value, ...patch });
  const updateItem = (i: number, patch: Partial<CannedJobItem>) => {
    const items = [...value.items];
    items[i] = { ...items[i], ...patch };
    onChange({ ...value, items });
  };
  const addItem = () => onChange({ ...value, items: [...value.items, { type: "part", description: "", quantity: 1, unitPrice: 0 }] });
  const removeItem = (i: number) => onChange({ ...value, items: value.items.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label className="text-sm font-medium">Name *</label><Input value={value.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Front brake pads & rotors" /></div>
        <div><label className="text-sm font-medium">Category</label><Input value={value.category ?? ""} onChange={(e) => update({ category: e.target.value })} placeholder="Brakes, Engine, Suspension…" /></div>
      </div>
      <div><label className="text-sm font-medium">Description</label><Textarea value={value.description ?? ""} onChange={(e) => update({ description: e.target.value })} rows={2} /></div>
      <div className="w-40"><label className="text-sm font-medium">Default Labor Hours</label><Input type="number" step="0.1" value={value.estimatedHours ?? ""} onChange={(e) => update({ estimatedHours: e.target.value })} /></div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">Line Items</label>
          <Button type="button" size="sm" variant="outline" onClick={addItem}><Plus className="h-4 w-4 mr-1" /> Add</Button>
        </div>
        <div className="space-y-2">
          {value.items.map((it, i) => (
            <div key={i} className="flex gap-2 items-start">
              <Select value={it.type} onValueChange={(v) => updateItem(i, { type: v as any })}>
                <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="labor">Labor</SelectItem>
                  <SelectItem value="part">Part</SelectItem>
                  <SelectItem value="fee">Fee</SelectItem>
                  <SelectItem value="discount">Discount</SelectItem>
                </SelectContent>
              </Select>
              <Input className="flex-1" placeholder="Description" value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} />
              <Input className="w-20" type="number" placeholder="Qty" value={it.quantity} onChange={(e) => updateItem(i, { quantity: Number(e.target.value) })} />
              <Input className="w-28" type="number" step="0.01" placeholder="Unit $" value={it.unitPrice} onChange={(e) => updateItem(i, { unitPrice: Number(e.target.value) })} />
              <Button type="button" size="icon" variant="ghost" className="text-destructive" onClick={() => removeItem(i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
