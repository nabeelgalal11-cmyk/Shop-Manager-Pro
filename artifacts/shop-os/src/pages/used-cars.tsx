import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, CarFront, DollarSign, Package, TrendingUp, Search, Pencil, Trash2 } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";

const API = "/api/used-cars";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  if (r.status === 204) return null;
  return r.json();
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

const STATUS_COLORS: Record<string, string> = {
  available: "bg-green-100 text-green-800 border-green-200",
  reserved: "bg-yellow-100 text-yellow-800 border-yellow-200",
  sold: "bg-blue-100 text-blue-800 border-blue-200",
  pending: "bg-orange-100 text-orange-800 border-orange-200",
};

export default function UsedCars() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<{ data: any[]; stats: any }>({
    queryKey: [API],
    queryFn: () => apiFetch(API),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`${API}/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [API] }),
  });

  const cars = (data?.data || []).filter(c => {
    const matchStatus = statusFilter === "all" || c.status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || `${c.year} ${c.make} ${c.model} ${c.vin || ""}`.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const stats = data?.stats;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <CarFront className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Used Car Inventory</h1>
            <p className="text-muted-foreground">Track vehicle purchases, pricing, and sales.</p>
          </div>
        </div>
        <Button onClick={() => setLocation("/used-cars/new")}><Plus className="mr-2 h-4 w-4" /> Add Vehicle</Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-border">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Package className="h-4 w-4" /> Available
            </div>
            <p className="text-3xl font-bold">{stats?.availableCount ?? "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">{stats ? fmt(stats.totalAvailableValue) : "—"} listing value</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <CarFront className="h-4 w-4" /> Sold
            </div>
            <p className="text-3xl font-bold">{stats?.soldCount ?? "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">{stats ? `${stats.reservedCount} reserved` : "—"}</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <DollarSign className="h-4 w-4" /> Total Invested
            </div>
            <p className="text-3xl font-bold">{stats ? fmt(stats.totalPurchasedCost) : "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">purchase cost</p>
          </CardContent>
        </Card>
        <Card className={`border-border ${stats?.soldProfit >= 0 ? "bg-green-50/50" : "bg-red-50/50"}`}>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <TrendingUp className="h-4 w-4" /> Sold Profit
            </div>
            <p className={`text-3xl font-bold ${stats?.soldProfit >= 0 ? "text-green-700" : "text-red-700"}`}>
              {stats ? fmt(stats.soldProfit) : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">from completed sales</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search year, make, model, VIN..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Vehicles</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="reserved">Reserved</SelectItem>
            <SelectItem value="sold">Sold</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="shadow-sm border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vehicle</TableHead>
              <TableHead>VIN</TableHead>
              <TableHead>Mileage</TableHead>
              <TableHead>Purchase</TableHead>
              <TableHead>Asking</TableHead>
              <TableHead>Margin</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : cars.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No vehicles found.</TableCell></TableRow>
            ) : cars.map(car => {
              const margin = Number(car.sellingPrice) - Number(car.purchasePrice);
              return (
                <TableRow key={car.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium">
                    <div>
                      <span>{car.year} {car.make} {car.model}</span>
                      {car.trim && <span className="text-muted-foreground text-xs ml-1">{car.trim}</span>}
                    </div>
                    {car.color && <div className="text-xs text-muted-foreground">{car.color}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{car.vin || "—"}</TableCell>
                  <TableCell>{car.mileage ? car.mileage.toLocaleString() : "—"}</TableCell>
                  <TableCell className="font-medium">{fmt(Number(car.purchasePrice))}</TableCell>
                  <TableCell className="font-medium">{fmt(Number(car.sellingPrice))}</TableCell>
                  <TableCell>
                    <span className={margin >= 0 ? "text-green-700 font-semibold" : "text-red-700 font-semibold"}>
                      {margin >= 0 ? "+" : ""}{fmt(margin)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${STATUS_COLORS[car.status] || "bg-gray-100 text-gray-700 border-gray-200"}`}>
                      {car.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {car.customer ? `${car.customer.firstName} ${car.customer.lastName}` : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setLocation(`/used-cars/${car.id}`)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => confirm(`Delete ${car.year} ${car.make} ${car.model}?`) && remove.mutate(car.id)}
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
