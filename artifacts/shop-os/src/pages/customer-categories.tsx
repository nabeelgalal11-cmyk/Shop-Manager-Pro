import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Tags } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

const API = "/api/customer-categories";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  if (r.status === 204) return null;
  return r.json();
}

interface Category {
  id: number;
  name: string;
  description: string | null;
  laborRate: string;
  partsMarkup: string;
  customerCount: number;
}

const defaultForm = { name: "", description: "", laborRate: "120", partsMarkup: "0" };

export default function CustomerCategories() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState(defaultForm);

  const { data = [], isLoading } = useQuery<Category[]>({
    queryKey: [API],
    queryFn: () => apiFetch(API),
  });

  const save = useMutation({
    mutationFn: (cat: any) =>
      editing
        ? apiFetch(`${API}/${editing.id}`, { method: "PUT", body: JSON.stringify(cat) })
        : apiFetch(API, { method: "POST", body: JSON.stringify(cat) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [API] }); closeDialog(); },
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`${API}/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [API] }),
  });

  function openNew() {
    setEditing(null);
    setForm(defaultForm);
    setOpen(true);
  }

  function openEdit(cat: Category) {
    setEditing(cat);
    setForm({ name: cat.name, description: cat.description || "", laborRate: cat.laborRate, partsMarkup: cat.partsMarkup });
    setOpen(true);
  }

  function closeDialog() { setOpen(false); setEditing(null); setForm(defaultForm); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate({ ...form, laborRate: Number(form.laborRate), partsMarkup: Number(form.partsMarkup) });
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Tags className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Customer Categories</h1>
            <p className="text-muted-foreground">Define pricing tiers for different customer groups.</p>
          </div>
        </div>
        <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> New Category</Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {data.map(cat => (
          <Card key={cat.id} className="border-border">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {cat.name}
              </p>
              <p className="text-2xl font-bold mt-1">${Number(cat.laborRate).toFixed(2)}<span className="text-sm font-normal text-muted-foreground">/hr</span></p>
              <p className="text-xs text-muted-foreground mt-1">{Number(cat.partsMarkup)}% parts markup · {cat.customerCount} customers</p>
            </CardContent>
          </Card>
        ))}
        {data.length === 0 && !isLoading && (
          <div className="col-span-4 text-center py-8 text-muted-foreground">
            No categories yet. Create one to start applying custom pricing.
          </div>
        )}
      </div>

      {/* Table */}
      <Card className="shadow-sm border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">All Categories</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Labor Rate</TableHead>
                <TableHead>Parts Markup</TableHead>
                <TableHead>Customers</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
              ) : data.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No categories found.</TableCell></TableRow>
              ) : data.map(cat => (
                <TableRow key={cat.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium">{cat.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{cat.description || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono">${Number(cat.laborRate).toFixed(2)}/hr</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{Number(cat.partsMarkup)}%</Badge>
                  </TableCell>
                  <TableCell>{cat.customerCount}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(cat)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => confirm(`Delete "${cat.name}"?`) && remove.mutate(cat.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Category" : "New Category"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Category Name *</Label>
              <Input
                required
                placeholder="e.g. Fleet, VIP, Retail"
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                placeholder="Optional description..."
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Labor Rate ($/hr)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.laborRate}
                  onChange={e => setForm(p => ({ ...p, laborRate: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Parts Markup (%)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.partsMarkup}
                  onChange={e => setForm(p => ({ ...p, partsMarkup: e.target.value }))}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Labor rate and parts markup will be automatically applied when creating estimates and invoices for customers in this category.
            </p>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving..." : editing ? "Save Changes" : "Create Category"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
