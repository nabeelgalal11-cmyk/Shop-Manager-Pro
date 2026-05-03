import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShoppingCart, Truck, FileDown, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SupplierPicker } from "@/components/supplier-picker";

const API = "/api/reports/reorder";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  if (r.status === 204) return null;
  return r.json();
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

type Item = {
  id: number; partNumber: string; name: string; category: string | null;
  quantity: number; minQuantity: number; costPrice: number; reorderQty: number; lineCost: number;
};
type Group = {
  supplierId: number | null; supplierName: string | null; accountNumber: string | null;
  contactEmail: string | null; items: Item[]; itemCount: number; estimatedCost: number;
};

function GroupCard({ group, onCreated }: { group: Group; onCreated: () => void }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Record<number, boolean>>(
    Object.fromEntries(group.items.map((i) => [i.id, true]))
  );
  const [qtyOverride, setQtyOverride] = useState<Record<number, number>>(
    Object.fromEntries(group.items.map((i) => [i.id, i.reorderQty]))
  );
  const [assignTo, setAssignTo] = useState<number | null>(null);

  const create = useMutation({
    mutationFn: async (supplierId: number) => {
      const items = group.items
        .filter((it) => selected[it.id])
        .map((it) => ({ inventoryId: it.id, quantity: qtyOverride[it.id] }));
      if (items.length === 0) throw new Error("Select at least one item");
      const r = await apiFetch("/api/purchases/from-reorder", {
        method: "POST",
        body: JSON.stringify({ supplierId, items }),
      });
      return r;
    },
    onSuccess: (data: any) => {
      toast({ title: "Draft purchase created" });
      qc.invalidateQueries({ queryKey: [API] });
      onCreated();
      if (data?.id) setLocation(`/purchases/${data.id}`);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const assign = useMutation({
    mutationFn: async (supplierId: number) => {
      // Update each item's preferred supplier
      const ids = group.items.filter((it) => selected[it.id]).map((it) => it.id);
      await Promise.all(
        ids.map((id) =>
          apiFetch(`/api/inventory/${id}`, {
            method: "PUT",
            body: JSON.stringify({ preferredSupplierId: supplierId }),
          })
        )
      );
    },
    onSuccess: () => {
      toast({ title: "Items assigned to supplier" });
      qc.invalidateQueries({ queryKey: [API] });
      onCreated();
    },
  });

  const selectedItems = group.items.filter((it) => selected[it.id]);
  const selectedCost = selectedItems.reduce((s, it) => s + (qtyOverride[it.id] ?? it.reorderQty) * it.costPrice, 0);

  const isUnassigned = group.supplierId === null;

  return (
    <Card>
      <CardHeader className="bg-muted/30 border-b">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            {isUnassigned ? (
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
            ) : (
              <Truck className="h-5 w-5 text-primary" />
            )}
            <div>
              <CardTitle className="text-base">
                {group.supplierName || "Unassigned"}
                {group.accountNumber && (
                  <span className="ml-2 text-xs font-mono text-muted-foreground">#{group.accountNumber}</span>
                )}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {group.itemCount} item{group.itemCount === 1 ? "" : "s"} · est. {fmt(group.estimatedCost)}
                {group.contactEmail && ` · ${group.contactEmail}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {group.contactEmail && (
              <Button variant="outline" size="sm" asChild>
                <a href={`mailto:${group.contactEmail}?subject=Parts Reorder Request`}>
                  <Mail className="h-3.5 w-3.5 mr-1.5" /> Email
                </a>
              </Button>
            )}
            {!isUnassigned && group.supplierId !== null ? (
              <Button size="sm" disabled={create.isPending || selectedItems.length === 0}
                onClick={() => create.mutate(group.supplierId!)}>
                <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />
                Create draft purchase ({fmt(selectedCost)})
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>Part #</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Min</TableHead>
              <TableHead className="text-right">Reorder qty</TableHead>
              <TableHead className="text-right">Unit cost</TableHead>
              <TableHead className="text-right">Line</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.items.map((it) => {
              const q = qtyOverride[it.id] ?? it.reorderQty;
              return (
                <TableRow key={it.id}>
                  <TableCell>
                    <Checkbox checked={!!selected[it.id]}
                      onCheckedChange={(v) => setSelected((s) => ({ ...s, [it.id]: !!v }))} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{it.partNumber || "—"}</TableCell>
                  <TableCell className="font-medium">{it.name}</TableCell>
                  <TableCell className="text-muted-foreground">{it.category || "—"}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline" className="font-mono">{it.quantity}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{it.minQuantity}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number" min={1} value={q}
                      onChange={(e) => setQtyOverride((p) => ({ ...p, [it.id]: Math.max(1, Number(e.target.value) || 1) }))}
                      className="h-8 w-20 ml-auto text-right"
                    />
                  </TableCell>
                  <TableCell className="text-right">{fmt(it.costPrice)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmt(q * it.costPrice)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {isUnassigned && (
          <div className="border-t bg-muted/20 p-3 flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">Assign selected items to a supplier:</span>
            <div className="min-w-64 flex-1 max-w-sm">
              <SupplierPicker value={assignTo} onChange={setAssignTo} placeholder="Pick a supplier..." />
            </div>
            <Button size="sm" disabled={!assignTo || assign.isPending || selectedItems.length === 0}
              onClick={() => assignTo && assign.mutate(assignTo)}>
              Assign {selectedItems.length} item{selectedItems.length === 1 ? "" : "s"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ReorderReport() {
  const { data, isLoading, refetch } = useQuery<{ groups: Group[]; totalItems: number }>({
    queryKey: [API],
    queryFn: () => apiFetch(API),
  });

  function exportCsv() {
    if (!data) return;
    const rows = [
      ["Supplier", "Account", "Part #", "Name", "Category", "On hand", "Min", "Reorder qty", "Unit cost", "Line cost"],
    ];
    for (const g of data.groups) {
      for (const it of g.items) {
        rows.push([
          g.supplierName || "Unassigned",
          g.accountNumber || "",
          it.partNumber || "",
          it.name,
          it.category || "",
          String(it.quantity),
          String(it.minQuantity),
          String(it.reorderQty),
          String(it.costPrice),
          String(it.lineCost),
        ]);
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reorder-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalCost = (data?.groups || []).reduce((s, g) => s + g.estimatedCost, 0);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Reorder Report</h1>
            <p className="text-muted-foreground">Items at or below their minimum stock level, grouped by preferred supplier.</p>
          </div>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!data || data.totalItems === 0}>
          <FileDown className="h-4 w-4 mr-2" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Card><CardContent className="pt-5 pb-4">
          <div className="text-muted-foreground text-sm mb-1">Items needing reorder</div>
          <p className="text-3xl font-bold">{data?.totalItems ?? "—"}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5 pb-4">
          <div className="text-muted-foreground text-sm mb-1">Suppliers involved</div>
          <p className="text-3xl font-bold">{(data?.groups || []).filter((g) => g.supplierId !== null).length}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5 pb-4">
          <div className="text-muted-foreground text-sm mb-1">Estimated total</div>
          <p className="text-3xl font-bold">{fmt(totalCost)}</p>
        </CardContent></Card>
      </div>

      {isLoading ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Loading...</CardContent></Card>
      ) : (data?.groups || []).length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Nothing to reorder right now. All items are above their minimum stock levels.
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {data!.groups.map((g) => (
            <GroupCard key={g.supplierId ?? "unassigned"} group={g} onCreated={() => refetch()} />
          ))}
        </div>
      )}
    </div>
  );
}
