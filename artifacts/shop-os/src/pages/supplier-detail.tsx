import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Save, Truck, DollarSign, Package, Calendar } from "lucide-react";
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

const FIELDS: Array<[string, string, string?]> = [
  ["name", "Name *"], ["accountNumber", "Account #"], ["paymentTerms", "Payment Terms"],
  ["contactName", "Contact Name"], ["contactEmail", "Contact Email", "email"], ["contactPhone", "Contact Phone"],
  ["address", "Address"],
];

export default function SupplierDetail() {
  const [, params] = useRoute("/suppliers/:id");
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const id = Number(params?.id);
  const [form, setForm] = useState<any>({});

  const { data, isLoading } = useQuery<any>({
    queryKey: [API, id],
    queryFn: () => apiFetch(`${API}/${id}`),
    enabled: Number.isFinite(id),
  });

  useEffect(() => {
    if (data) {
      const f: any = {};
      for (const [k] of FIELDS) f[k] = data[k] ?? "";
      f.notes = data.notes ?? "";
      setForm(f);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: (payload: any) => apiFetch(`${API}/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [API] });
      toast({ title: "Supplier updated" });
    },
    onError: (e: any) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;

  const stats = data.stats || {};

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload: any = { ...form };
    for (const k of Object.keys(payload)) if (payload[k] === "") payload[k] = null;
    save.mutate(payload);
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/suppliers")}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Truck className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">{data.name}</h1>
          <p className="text-muted-foreground">{data.accountNumber || "Supplier details"}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><DollarSign className="h-4 w-4" /> Total Spend</div>
          <p className="text-3xl font-bold">{fmt(Number(stats.totalSpend || 0))}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><Package className="h-4 w-4" /> Purchases</div>
          <p className="text-3xl font-bold">{stats.purchaseCount || 0}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><Package className="h-4 w-4" /> Linked Items</div>
          <p className="text-3xl font-bold">{stats.inventoryCount || 0}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><Calendar className="h-4 w-4" /> Last Purchase</div>
          <p className="text-lg font-semibold">{stats.lastPurchaseDate ? new Date(stats.lastPurchaseDate).toLocaleDateString() : "—"}</p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="purchases">Recent Purchases ({(data.recentPurchases || []).length})</TabsTrigger>
          <TabsTrigger value="inventory">Linked Inventory ({(data.linkedInventory || []).length})</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <Card>
            <CardHeader><CardTitle className="text-base">Contact & Payment</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {FIELDS.map(([k, label, type]) => (
                  <div key={k} className="space-y-1.5">
                    <Label>{label}</Label>
                    <Input
                      type={type || "text"}
                      value={form[k] ?? ""}
                      onChange={(e) => setForm((f: any) => ({ ...f, [k]: e.target.value }))}
                      required={k === "name"}
                    />
                  </div>
                ))}
                <div className="md:col-span-2 space-y-1.5">
                  <Label>Notes</Label>
                  <Input value={form.notes ?? ""} onChange={(e) => setForm((f: any) => ({ ...f, notes: e.target.value }))} />
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <Button type="submit" disabled={save.isPending}>
                    <Save className="h-4 w-4 mr-2" />{save.isPending ? "Saving..." : "Save changes"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="purchases">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data.recentPurchases || []).length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No purchases yet.</TableCell></TableRow>
                ) : (data.recentPurchases || []).map((p: any) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setLocation(`/purchases/${p.id}`)}>
                    <TableCell>{new Date(p.purchaseDate).toLocaleDateString()}</TableCell>
                    <TableCell className="font-mono text-sm">{p.invoiceNumber || "—"}</TableCell>
                    <TableCell className="capitalize">{p.status}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt(Number(p.amount || 0))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="inventory">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part #</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data.linkedInventory || []).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No inventory linked.</TableCell></TableRow>
                ) : (data.linkedInventory || []).map((it: any) => (
                  <TableRow key={it.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setLocation(`/inventory/${it.id}`)}>
                    <TableCell className="font-mono text-sm">{it.partNumber || "—"}</TableCell>
                    <TableCell>{it.name}</TableCell>
                    <TableCell className="text-muted-foreground">{it.category}</TableCell>
                    <TableCell className="text-right">{it.quantity}</TableCell>
                    <TableCell className="text-right">{it.minQuantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
