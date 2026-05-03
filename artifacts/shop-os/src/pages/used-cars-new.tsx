import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Car, DollarSign, Wrench, TrendingUp, Plus } from "lucide-react";
import { useGetCustomers } from "@workspace/api-client-react";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

const API = "/api/used-cars";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  if (r.status === 204) return null;
  return r.json();
}

const empty = {
  vin: "", year: new Date().getFullYear(), make: "", model: "", trim: "", color: "",
  mileage: "", condition: "good", purchasePrice: "", sellingPrice: "",
  status: "available", customerId: "", purchaseDate: "", saleDate: "", notes: "",
};

export default function UsedCarsNew() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const isEdit = Boolean(id);
  const [form, setForm] = useState<typeof empty>(empty);

  const { data: existing } = useQuery({
    queryKey: [API, id],
    queryFn: () => apiFetch(`${API}/${id}`),
    enabled: isEdit,
  });

  const { data: recon } = useQuery<any>({
    queryKey: [API, id, "recon"],
    queryFn: () => apiFetch(`${API}/${id}/recon`),
    enabled: isEdit,
  });

  const { data: customersData } = useGetCustomers({ limit: 200 });
  const customers = Array.isArray(customersData) ? customersData : customersData?.data || [];

  useEffect(() => {
    if (existing) {
      setForm({
        vin: existing.vin || "",
        year: existing.year,
        make: existing.make,
        model: existing.model,
        trim: existing.trim || "",
        color: existing.color || "",
        mileage: String(existing.mileage || ""),
        condition: existing.condition || "good",
        purchasePrice: existing.purchasePrice,
        sellingPrice: existing.sellingPrice,
        status: existing.status,
        customerId: existing.customerId ? String(existing.customerId) : "",
        purchaseDate: existing.purchaseDate || "",
        saleDate: existing.saleDate || "",
        notes: existing.notes || "",
      });
    }
  }, [existing]);

  const save = useMutation({
    mutationFn: (data: any) =>
      isEdit
        ? apiFetch(`${API}/${id}`, { method: "PUT", body: JSON.stringify(data) })
        : apiFetch(API, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [API] });
      setLocation("/used-cars");
    },
  });

  function set(key: keyof typeof empty, val: string | number) {
    setForm(p => ({ ...p, [key]: val }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const margin = Number(form.sellingPrice) - Number(form.purchasePrice);
    save.mutate({
      ...form,
      year: Number(form.year),
      mileage: form.mileage ? Number(form.mileage) : null,
      purchasePrice: Number(form.purchasePrice),
      sellingPrice: Number(form.sellingPrice),
      customerId: form.customerId ? Number(form.customerId) : null,
      purchaseDate: form.purchaseDate || null,
      saleDate: form.saleDate || null,
    });
  }

  const margin = Number(form.sellingPrice) - Number(form.purchasePrice);

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/used-cars")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{isEdit ? "Edit Vehicle" : "Add Vehicle"}</h1>
          <p className="text-muted-foreground">Record a used car for resale inventory.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Vehicle Details */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Car className="h-4 w-4" /> Vehicle Details
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Year *</Label>
              <Input type="number" min="1900" max="2099" required value={form.year} onChange={e => set("year", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Make *</Label>
              <Input required placeholder="Toyota" value={form.make} onChange={e => set("make", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Model *</Label>
              <Input required placeholder="Camry" value={form.model} onChange={e => set("model", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Trim</Label>
              <Input placeholder="XLE" value={form.trim} onChange={e => set("trim", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <Input placeholder="Silver" value={form.color} onChange={e => set("color", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Mileage</Label>
              <Input type="number" min="0" placeholder="45000" value={form.mileage} onChange={e => set("mileage", e.target.value)} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>VIN</Label>
              <Input placeholder="1HGBH41JXMN109186" value={form.vin} onChange={e => set("vin", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Condition</Label>
              <Select value={form.condition} onValueChange={v => set("condition", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="excellent">Excellent</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="fair">Fair</SelectItem>
                  <SelectItem value="poor">Poor</SelectItem>
                  <SelectItem value="parts">Parts Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Pricing */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4" /> Pricing
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Purchase Price *</Label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-muted-foreground text-sm">$</span>
                <Input type="number" min="0" step="0.01" required placeholder="0.00" className="pl-7" value={form.purchasePrice} onChange={e => set("purchasePrice", e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Selling Price *</Label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-muted-foreground text-sm">$</span>
                <Input type="number" min="0" step="0.01" required placeholder="0.00" className="pl-7" value={form.sellingPrice} onChange={e => set("sellingPrice", e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Expected Margin</Label>
              <div className={`h-10 flex items-center px-3 rounded-md border font-semibold text-sm ${margin >= 0 ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700"}`}>
                {form.purchasePrice && form.sellingPrice
                  ? `${margin >= 0 ? "+" : ""}$${margin.toLocaleString("en-US", { minimumFractionDigits: 0 })}`
                  : "—"}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Purchase Date</Label>
              <Input type="date" value={form.purchaseDate} onChange={e => set("purchaseDate", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Sale Date</Label>
              <Input type="date" value={form.saleDate} onChange={e => set("saleDate", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="reserved">Reserved</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="sold">Sold</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Buyer (optional) */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Buyer (Optional)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-w-xs">
              <Label>Link to Customer</Label>
              <Select
                value={form.customerId || "none"}
                onValueChange={v => set("customerId", v === "none" ? "" : v)}
              >
                <SelectTrigger><SelectValue placeholder="Select a customer..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {customers.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.firstName} {c.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Reconditioning + Profitability — edit mode only */}
        {isEdit && recon && (
          <>
            <Card className="border-border">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wrench className="h-4 w-4" /> Reconditioning Costs
                </CardTitle>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setLocation(`/repair-orders/new?usedCarId=${id}`)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> New Recon Job
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Parts (purchased)</div>
                    <div className="font-semibold">{fmt(recon.partsFromPurchasesTotal)}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Parts (recon ROs)</div>
                    <div className="font-semibold">{fmt(recon.repairOrderPartsTotal)}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Labor ({recon.laborHours}h × ${recon.laborRate})</div>
                    <div className="font-semibold">{fmt(recon.laborTotal)}</div>
                  </div>
                  <div className="rounded-md border p-3 bg-orange-50 border-orange-200">
                    <div className="text-xs text-orange-700">Total Recon</div>
                    <div className="font-bold text-orange-700">{fmt(recon.reconTotal)}</div>
                  </div>
                </div>

                {recon.repairOrders.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-2">Recon Repair Orders</div>
                    <div className="space-y-1">
                      {recon.repairOrders.map((ro: any) => (
                        <div
                          key={ro.id}
                          className="flex items-center justify-between text-sm p-2 rounded-md border hover:bg-muted/50 cursor-pointer"
                          onClick={() => setLocation(`/repair-orders/${ro.id}`)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs">{ro.orderNumber}</span>
                            <span className="text-xs text-muted-foreground">{ro.status}</span>
                            {ro.diagnosis || ro.complaint ? (
                              <span className="text-muted-foreground truncate max-w-md">— {ro.diagnosis || ro.complaint}</span>
                            ) : null}
                          </div>
                          <div className="font-medium">{fmt(ro.totalCost)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {recon.partsFromPurchases.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-2">Parts from Purchases</div>
                    <div className="space-y-1">
                      {recon.partsFromPurchases.map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between text-sm p-2 rounded-md border">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{p.supplier}</span>
                            <span>—</span>
                            <span>{p.description}</span>
                            <span className="text-xs text-muted-foreground">×{p.quantity}</span>
                          </div>
                          <div className="font-medium">{fmt(p.lineTotal)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-4 w-4" /> Profitability
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Purchase</div>
                  <div className="font-semibold">{fmt(Number(form.purchasePrice || 0))}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Asking / Sold</div>
                  <div className="font-semibold">{fmt(Number(form.sellingPrice || 0))}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Total Cost</div>
                  <div className="font-semibold">{fmt(Number(form.purchasePrice || 0) + recon.reconTotal)}</div>
                </div>
                <div className={`rounded-md border p-3 ${recon.actualProfit >= 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                  <div className={`text-xs ${recon.actualProfit >= 0 ? "text-green-700" : "text-red-700"}`}>
                    Net Profit {form.status === "sold" ? "(realized)" : "(projected)"}
                  </div>
                  <div className={`font-bold ${recon.actualProfit >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {recon.actualProfit >= 0 ? "+" : ""}{fmt(recon.actualProfit)}
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* Notes */}
        <Card className="border-border">
          <CardHeader className="pb-3"><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              placeholder="Repairs needed, history, special features..."
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
              rows={3}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => setLocation("/used-cars")}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving..." : isEdit ? "Save Changes" : "Add to Inventory"}
          </Button>
        </div>
      </form>
    </div>
  );
}
