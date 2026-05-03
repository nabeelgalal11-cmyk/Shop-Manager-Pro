import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Truck, Plus, Search, DollarSign, Package, ShoppingCart, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API = "/api/suppliers";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  if (r.status === 204) return null;
  return r.json();
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

const EMPTY = {
  name: "", contactName: "", contactEmail: "", contactPhone: "",
  accountNumber: "", paymentTerms: "",
  address: "", notes: "",
};

export default function Suppliers() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const { data, isLoading } = useQuery<any>({
    queryKey: [API, search],
    queryFn: () => apiFetch(`${API}?${new URLSearchParams(search ? { search } : {})}`),
  });

  const create = useMutation({
    mutationFn: (payload: any) => apiFetch(API, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [API] });
      setOpen(false);
      setForm({ ...EMPTY });
      toast({ title: "Supplier created" });
    },
    onError: (e: any) => toast({ title: "Failed to create supplier", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`${API}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [API] });
      toast({ title: "Supplier removed" });
    },
    onError: (e: any) => toast({ title: "Could not delete", description: e.message, variant: "destructive" }),
  });

  const suppliers = data?.data || [];
  const totalSpend = suppliers.reduce((s: number, x: any) => s + Number(x.totalSpend || 0), 0);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    const payload: any = { ...form };
    for (const k of Object.keys(payload)) if (payload[k] === "") payload[k] = null;
    create.mutate(payload);
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Truck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Suppliers</h1>
            <p className="text-muted-foreground">Vendors you buy parts and supplies from.</p>
          </div>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" /> New Supplier</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Card><CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><Truck className="h-4 w-4" /> Suppliers</div>
          <p className="text-3xl font-bold">{suppliers.length}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><DollarSign className="h-4 w-4" /> Lifetime Spend</div>
          <p className="text-3xl font-bold">{fmt(totalSpend)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><ShoppingCart className="h-4 w-4" /> Linked Inventory Items</div>
          <p className="text-3xl font-bold">{suppliers.reduce((s: number, x: any) => s + Number(x.inventoryCount || 0), 0)}</p>
        </CardContent></Card>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search suppliers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      <Card className="shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Account #</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Purchases</TableHead>
              <TableHead className="text-right">Total Spend</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : suppliers.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No suppliers yet.</TableCell></TableRow>
            ) : suppliers.map((s: any) => (
              <TableRow key={s.id} className="hover:bg-muted/50 cursor-pointer" onClick={() => setLocation(`/suppliers/${s.id}`)}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground">{s.accountNumber || "—"}</TableCell>
                <TableCell>{s.contactName || s.contactEmail || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{s.contactPhone || "—"}</TableCell>
                <TableCell className="text-right">{s.inventoryCount}</TableCell>
                <TableCell className="text-right">{s.purchaseCount}</TableCell>
                <TableCell className="text-right font-semibold">{fmt(Number(s.totalSpend || 0))}</TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" className="text-destructive"
                    onClick={() => confirm(`Delete ${s.name}? Will be archived if referenced.`) && remove.mutate(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New Supplier</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2 space-y-1.5">
              <Label>Name *</Label>
              <Input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="NAPA Auto Parts" />
            </div>
            <div className="space-y-1.5"><Label>Account #</Label><Input value={form.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Payment Terms</Label><Input value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} placeholder="Net 30" /></div>
            <div className="space-y-1.5"><Label>Contact Name</Label><Input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Contact Email</Label><Input type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Contact Phone</Label><Input value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></div>
            <div className="md:col-span-2 space-y-1.5"><Label>Address</Label><Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Street, City, State, ZIP" /></div>
            <div className="md:col-span-2 space-y-1.5">
              <Label>Notes</Label>
              <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
            <DialogFooter className="md:col-span-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating..." : "Create supplier"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
