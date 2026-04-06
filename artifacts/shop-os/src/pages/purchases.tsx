import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ShoppingCart, Plus, Search, DollarSign, Package, Clock, CheckCircle, FileText, Trash2, Pencil
} from "lucide-react";

const API = "/api/purchases";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  if (r.status === 204) return null;
  return r.json();
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  received: "bg-green-100 text-green-800 border-green-200",
  returned: "bg-red-100 text-red-800 border-red-200",
  partial: "bg-blue-100 text-blue-800 border-blue-200",
};

export default function Purchases() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data, isLoading } = useQuery<any>({
    queryKey: [API, search, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      return apiFetch(`${API}?${params}`);
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`${API}/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [API] }),
  });

  const purchases = data?.data || [];
  const stats = data?.stats;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <ShoppingCart className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Purchases</h1>
            <p className="text-muted-foreground">Track supplier purchases, invoices, and inventory restocking.</p>
          </div>
        </div>
        <Button onClick={() => setLocation("/purchases/new")}><Plus className="mr-2 h-4 w-4" /> New Purchase</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-border">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <DollarSign className="h-4 w-4" /> Total Spent
            </div>
            <p className="text-3xl font-bold">{stats ? fmt(stats.totalAmount) : "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats ? `+${fmt(stats.totalTax)} tax · ${fmt(stats.totalShipping)} shipping` : ""}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Package className="h-4 w-4" /> Total Purchases
            </div>
            <p className="text-3xl font-bold">{stats?.totalCount ?? "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">purchase orders</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Clock className="h-4 w-4 text-yellow-500" /> Pending
            </div>
            <p className="text-3xl font-bold text-yellow-600">{stats?.pendingCount ?? "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">awaiting receipt</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <CheckCircle className="h-4 w-4 text-green-500" /> Received
            </div>
            <p className="text-3xl font-bold text-green-600">{stats?.receivedCount ?? "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">completed orders</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search supplier or invoice number..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="received">Received</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="returned">Returned</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="shadow-sm border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Invoice #</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Tax</TableHead>
              <TableHead>Shipping</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : purchases.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No purchases found. Create your first purchase order.</TableCell></TableRow>
            ) : purchases.map((p: any) => {
              const total = Number(p.amount) + Number(p.tax || 0) + Number(p.shipping || 0);
              return (
                <TableRow key={p.id} className="hover:bg-muted/50 cursor-pointer" onClick={() => setLocation(`/purchases/${p.id}`)}>
                  <TableCell className="font-medium whitespace-nowrap">
                    {new Date(p.purchaseDate).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{p.supplier}</div>
                    {p.supplierContact && <div className="text-xs text-muted-foreground">{p.supplierContact}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{p.invoiceNumber || "—"}</TableCell>
                  <TableCell className="font-medium">{fmt(Number(p.amount))}</TableCell>
                  <TableCell className="text-muted-foreground">{Number(p.tax) > 0 ? fmt(Number(p.tax)) : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{Number(p.shipping) > 0 ? fmt(Number(p.shipping)) : "—"}</TableCell>
                  <TableCell className="font-semibold">{fmt(total)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border capitalize ${STATUS_STYLES[p.status] || "bg-gray-100 text-gray-700 border-gray-200"}`}>
                      {p.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    {p.invoiceFilePath ? (
                      <span className="flex items-center gap-1 text-xs text-primary font-medium">
                        <FileText className="h-3.5 w-3.5" /> {p.invoiceFileName || "File"}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setLocation(`/purchases/${p.id}`)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => confirm("Delete this purchase?") && remove.mutate(p.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
