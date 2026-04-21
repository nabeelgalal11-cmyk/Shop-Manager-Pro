import { useState, useRef, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRepairOrder, getGetRepairOrderQueryKey,
  useUpdateRepairOrder, useDeleteRepairOrder,
  useGetInventory, getGetInventoryQueryKey,
  useGetEmployees, getGetEmployeesQueryKey,
  type UpdateRepairOrderInput,
  type UpdateRepairOrderInputStatus,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Printer, Trash2, Plus, X, Save, Package, Search, BoxIcon, Car, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

type Part = { name: string; partNumber?: string; quantity: number; unitPrice: number; fromInventory?: boolean };

type CompatResult = "compatible" | "universal" | "incompatible";

function getCompatibility(
  compatibleVehicles: string | null | undefined,
  vehicle: { make: string; model: string; year: number } | null
): CompatResult {
  if (!compatibleVehicles) return "universal";
  if (!vehicle) return "universal";
  const cv = compatibleVehicles.toLowerCase();
  const make = vehicle.make.toLowerCase();
  const model = vehicle.model.toLowerCase();
  const year = vehicle.year.toString();
  if (cv.includes(make) && cv.includes(model)) return "compatible";
  if (cv.includes(make) && cv.includes(year)) return "compatible";
  if (cv.includes(make)) return "compatible";
  return "incompatible";
}

const COMPAT_BADGE: Record<CompatResult, { label: string; className: string }> = {
  compatible: { label: "✓ Fits this car", className: "bg-green-100 text-green-700 border-green-300" },
  universal: { label: "Universal", className: "bg-slate-100 text-slate-500 border-slate-200" },
  incompatible: { label: "✗ Other vehicle", className: "bg-orange-100 text-orange-600 border-orange-300" },
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  waiting_parts: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  delivered: "bg-purple-100 text-purple-700",
  cancelled: "bg-red-100 text-red-700",
};

export default function RepairOrderDetail() {
  const [match, params] = useRoute("/repair-orders/:id");
  const id = match ? parseInt(params.id) : 0;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: ro, isLoading } = useGetRepairOrder(id, {
    query: { enabled: !!id, queryKey: getGetRepairOrderQueryKey(id) },
  });

  const { data: inventoryData } = useGetInventory(
    { limit: 200 },
    { query: { queryKey: getGetInventoryQueryKey({ limit: 200 }) } }
  );
  const allInventory = Array.isArray(inventoryData) ? inventoryData : inventoryData?.data ?? [];

  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  const [parts, setParts] = useState<Part[] | null>(null);
  const [newPart, setNewPart] = useState<Part>({ name: "", partNumber: "", quantity: 1, unitPrice: 0 });
  const [searchQuery, setSearchQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // ── Edit Details mode ──────────────────────────────
  const [editingDetails, setEditingDetails] = useState(false);
  const [editForm, setEditForm] = useState<{
    createdAt: string;
    priority: string;
    assignedToId: string;
    mileageIn: string;
    mileageOut: string;
    estimatedHours: string;
    actualHours: string;
    promisedDate: string;
    complaint: string;
    notes: string;
  } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const { data: employeesData } = useGetEmployees(
    { role: "technician" },
    { query: { queryKey: getGetEmployeesQueryKey({ role: "technician" }), enabled: editingDetails } }
  );
  const techList = Array.isArray(employeesData) ? employeesData : employeesData?.data ?? [];

  const updateRO = useUpdateRepairOrder();
  const deleteRO = useDeleteRepairOrder();

  const toDateInput = (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return "";
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 10);
  };

  const startEdit = () => {
    if (!ro) return;
    setEditForm({
      createdAt: toDateInput(ro.createdAt),
      priority: ro.priority || "normal",
      assignedToId: ro.assignedToId ? String(ro.assignedToId) : "none",
      mileageIn: ro.mileageIn != null ? String(ro.mileageIn) : "",
      mileageOut: ro.mileageOut != null ? String(ro.mileageOut) : "",
      estimatedHours: ro.estimatedHours != null ? String(ro.estimatedHours) : "",
      actualHours: ro.actualHours != null ? String(ro.actualHours) : "",
      promisedDate: toDateInput(ro.promisedDate),
      complaint: ro.complaint ?? "",
      notes: ro.notes ?? "",
    });
    setEditError(null);
    setEditingDetails(true);
  };

  const cancelEdit = () => {
    setEditingDetails(false);
    setEditForm(null);
    setEditError(null);
  };

  const saveEdit = () => {
    if (!editForm) return;
    setEditError(null);

    // Validate
    const numOrErr = (v: string, label: string, allowDecimal: boolean) => {
      if (v.trim() === "") return { ok: true, value: null };
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || (!allowDecimal && !Number.isInteger(n))) {
        return { ok: false, error: `${label} must be a positive number` };
      }
      return { ok: true, value: n };
    };

    const mIn = numOrErr(editForm.mileageIn, "Mileage In", false);
    if (!mIn.ok) return setEditError(mIn.error!);
    const mOut = numOrErr(editForm.mileageOut, "Mileage Out", false);
    if (!mOut.ok) return setEditError(mOut.error!);
    const est = numOrErr(editForm.estimatedHours, "Estimated Hours", true);
    if (!est.ok) return setEditError(est.error!);
    const act = numOrErr(editForm.actualHours, "Actual Hours", true);
    if (!act.ok) return setEditError(act.error!);

    if (editForm.createdAt && isNaN(new Date(editForm.createdAt).getTime())) {
      return setEditError("Created date is invalid");
    }
    if (editForm.promisedDate && isNaN(new Date(editForm.promisedDate).getTime())) {
      return setEditError("Promised date is invalid");
    }

    const payload: UpdateRepairOrderInput = {
      priority: editForm.priority,
      assignedToId: editForm.assignedToId === "none" ? null : Number(editForm.assignedToId),
      mileageIn: mIn.value,
      mileageOut: mOut.value,
      estimatedHours: est.value,
      actualHours: act.value,
      promisedDate: editForm.promisedDate ? new Date(editForm.promisedDate) : null,
      complaint: editForm.complaint,
      notes: editForm.notes,
    };
    if (editForm.createdAt) {
      payload.createdAt = new Date(editForm.createdAt);
    }

    updateRO.mutate({ id, data: payload }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRepairOrderQueryKey(id) });
        toast({ title: "Repair order updated" });
        setEditingDetails(false);
        setEditForm(null);
      },
      onError: () => {
        setEditError("Failed to save changes. Please try again.");
        toast({ title: "Failed to save", variant: "destructive" });
      },
    });
  };

  const currentDiagnosis = diagnosis !== null ? diagnosis : (ro?.diagnosis ?? "");
  const currentParts: Part[] = parts !== null ? parts : ((ro?.parts as Part[]) ?? []);

  // Vehicle from the repair order (for compatibility matching)
  const vehicle = ro
    ? { make: ro.vehicle?.make ?? "", model: ro.vehicle?.model ?? "", year: ro.vehicle?.year ?? 0 }
    : null;

  // Filter & sort inventory: compatible first, then universal, then incompatible (hidden by default)
  const inventoryMatches = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const filtered = allInventory.filter(item =>
      item.name.toLowerCase().includes(q) ||
      (item.partNumber ?? "").toLowerCase().includes(q) ||
      (item.category ?? "").toLowerCase().includes(q)
    );
    const scored = filtered.map(item => {
      const compat = getCompatibility((item as any).compatibleVehicles, vehicle);
      return { item, compat, score: compat === "compatible" ? 0 : compat === "universal" ? 1 : 2 };
    });
    scored.sort((a, b) => a.score - b.score);
    return showAll ? scored.slice(0, 10) : scored.filter(r => r.compat !== "incompatible").slice(0, 8);
  })();

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectInventoryItem = (item: typeof allInventory[0]) => {
    setNewPart({
      name: item.name,
      partNumber: item.partNumber ?? "",
      quantity: 1,
      unitPrice: Number(item.sellPrice),
      fromInventory: true,
    });
    setSearchQuery(item.name);
    setShowDropdown(false);
  };

  const saveDiagnosis = () => {
    updateRO.mutate({ id, data: { diagnosis: currentDiagnosis } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRepairOrderQueryKey(id) });
        toast({ title: "Diagnosis saved" });
      },
      onError: () => toast({ title: "Failed to save", variant: "destructive" }),
    });
  };

  const saveParts = (updated: Part[]) => {
    updateRO.mutate({ id, data: { parts: updated } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRepairOrderQueryKey(id) });
        toast({ title: "Parts updated" });
      },
      onError: () => toast({ title: "Failed to update parts", variant: "destructive" }),
    });
  };

  const addPart = () => {
    if (!newPart.name.trim()) {
      toast({ title: "Part name is required", variant: "destructive" });
      return;
    }
    const updated = [...currentParts, { ...newPart, partNumber: newPart.partNumber || undefined }];
    setParts(updated);
    saveParts(updated);
    setNewPart({ name: "", partNumber: "", quantity: 1, unitPrice: 0 });
    setSearchQuery("");
  };

  const removePart = (index: number) => {
    const updated = currentParts.filter((_, i) => i !== index);
    setParts(updated);
    saveParts(updated);
  };

  const updateStatus = (newStatus: UpdateRepairOrderInputStatus) => {
    updateRO.mutate({ id, data: { status: newStatus } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRepairOrderQueryKey(id) });
        toast({ title: "Status updated" });
      },
    });
  };

  const handleDelete = () => {
    deleteRO.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Repair order deleted" });
        setLocation("/repair-orders");
      },
    });
  };

  const handlePrint = () => {
    const el = printRef.current;
    if (!el) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Repair Order ${ro?.orderNumber}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            h1 { font-size: 22px; margin-bottom: 4px; }
            h2 { font-size: 16px; margin: 16px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
            .meta { color: #555; font-size: 13px; margin-bottom: 16px; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
            .label { font-size: 11px; color: #888; text-transform: uppercase; margin-bottom: 2px; }
            .value { font-size: 14px; }
            table { width: 100%; border-collapse: collapse; font-size: 13px; }
            th { background: #f0f0f0; text-align: left; padding: 6px 8px; font-size: 12px; }
            td { padding: 6px 8px; border-bottom: 1px solid #eee; }
            .total-row td { font-weight: bold; border-top: 2px solid #ddd; }
            .box { background: #f9f9f9; border: 1px solid #ddd; border-radius: 4px; padding: 12px; font-size: 13px; min-height: 60px; white-space: pre-wrap; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>${el.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); }, 300);
  };

  const partsTotal = currentParts.reduce((sum, p) => sum + p.quantity * p.unitPrice, 0);

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!ro) {
    return <div className="p-8 text-center">Repair Order not found</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/repair-orders")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">RO: {ro.orderNumber}</h1>
            <p className="text-muted-foreground text-sm">
              {ro.customer?.firstName} {ro.customer?.lastName} &bull;{" "}
              {ro.vehicle?.year} {ro.vehicle?.make} {ro.vehicle?.model}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={ro.status} onValueChange={updateStatus} disabled={updateRO.isPending}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="waiting_parts">Waiting Parts</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
          <Button variant="destructive" size="icon" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">

          {/* Complaint & Diagnosis */}
          <Card>
            <CardHeader className="bg-muted/20 border-b pb-3">
              <CardTitle className="text-base">Complaint &amp; Diagnosis</CardTitle>
            </CardHeader>
            <CardContent className="pt-5 space-y-5">
              <div>
                <p className="text-sm font-semibold mb-2">Customer Complaint</p>
                <div className="p-3 bg-muted/30 rounded-md border text-sm min-h-[70px] whitespace-pre-wrap">
                  {ro.complaint || <span className="text-muted-foreground">No complaint recorded.</span>}
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold mb-2">Technician Diagnosis</p>
                <Textarea
                  placeholder="Enter technician diagnosis..."
                  value={currentDiagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  className="min-h-[110px]"
                />
                <div className="flex justify-end mt-2">
                  <Button size="sm" onClick={saveDiagnosis} disabled={updateRO.isPending}>
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    {updateRO.isPending ? "Saving..." : "Save Diagnosis"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Parts Needed */}
          <Card>
            <CardHeader className="bg-muted/20 border-b pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" /> Parts Needed
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5 space-y-4">

              {/* Parts Table */}
              {currentParts.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Part Name</th>
                        <th className="text-left px-3 py-2 font-medium">Part #</th>
                        <th className="text-right px-3 py-2 font-medium">Qty</th>
                        <th className="text-right px-3 py-2 font-medium">Unit Price</th>
                        <th className="text-right px-3 py-2 font-medium">Total</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {currentParts.map((part, i) => (
                        <tr key={i} className="border-t hover:bg-muted/20">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              {part.fromInventory && (
                                <BoxIcon className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" title="From inventory" />
                              )}
                              <span className="font-medium">{part.name}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{part.partNumber || "—"}</td>
                          <td className="px-3 py-2 text-right">{part.quantity}</td>
                          <td className="px-3 py-2 text-right">${Number(part.unitPrice).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-medium">
                            ${(part.quantity * Number(part.unitPrice)).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => removePart(i)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/20">
                        <td colSpan={4} className="px-3 py-2 font-semibold text-right">Parts Total</td>
                        <td className="px-3 py-2 font-bold text-right">${partsTotal.toFixed(2)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* Add Part Form */}
              <div className="rounded-md border bg-muted/10 p-4 space-y-3">
                <p className="text-sm font-semibold">Add Part</p>

                {/* Inventory Search */}
                <div className="space-y-1.5" ref={dropdownRef}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Search Inventory</p>
                    {vehicle?.make && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 border rounded px-2 py-0.5">
                        <Car className="h-3 w-3" />
                        {vehicle.year} {vehicle.make} {vehicle.model}{vehicle.licensePlate ? ` — ${vehicle.licensePlate}` : ""}
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search by part name, number or category..."
                      className="pl-9"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setNewPart(p => ({ ...p, name: e.target.value, partNumber: "", unitPrice: 0, fromInventory: false }));
                        setShowDropdown(true);
                      }}
                      onFocus={() => searchQuery.trim() && setShowDropdown(true)}
                    />
                    {/* Dropdown Results */}
                    {showDropdown && inventoryMatches.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg overflow-hidden">
                        {inventoryMatches.map(({ item, compat }) => {
                          const badge = COMPAT_BADGE[compat];
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className="w-full text-left px-3 py-2.5 hover:bg-muted/60 flex items-center justify-between gap-4 border-b last:border-0 transition-colors"
                              onMouseDown={(e) => { e.preventDefault(); selectInventoryItem(item); }}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <BoxIcon className="h-4 w-4 text-blue-500 flex-shrink-0" />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <p className="text-sm font-medium truncate">{item.name}</p>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap ${badge.className}`}>
                                      {badge.label}
                                    </span>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {item.partNumber && <span className="font-mono mr-2">{item.partNumber}</span>}
                                    <span>{item.category}</span>
                                  </p>
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className="text-sm font-semibold">${Number(item.sellPrice).toFixed(2)}</p>
                                <p className={`text-xs ${item.quantity <= item.minQuantity ? "text-destructive" : "text-muted-foreground"}`}>
                                  {item.quantity <= item.minQuantity ? `⚠ ${item.quantity} left` : `${item.quantity} in stock`}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                        {/* Show-all toggle row */}
                        <button
                          type="button"
                          className="w-full text-xs text-center px-3 py-2 text-muted-foreground hover:bg-muted/40 border-t transition-colors"
                          onMouseDown={(e) => { e.preventDefault(); setShowAll(v => !v); }}
                        >
                          {showAll ? "Hide parts for other vehicles" : "Also show parts for other vehicles ↓"}
                        </button>
                      </div>
                    )}
                    {showDropdown && searchQuery.trim().length >= 1 && inventoryMatches.length === 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg overflow-hidden">
                        <div className="px-3 py-3 text-sm text-muted-foreground">
                          No matching parts for this vehicle — you can still add manually below.
                        </div>
                        <button
                          type="button"
                          className="w-full text-xs text-center px-3 py-2 text-primary hover:bg-muted/40 border-t transition-colors"
                          onMouseDown={(e) => { e.preventDefault(); setShowAll(true); }}
                        >
                          Show all inventory regardless of vehicle ↓
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Manual / Auto-filled Part Fields */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Input
                    placeholder="Part name *"
                    value={newPart.name}
                    onChange={(e) => { setNewPart(p => ({ ...p, name: e.target.value })); setSearchQuery(e.target.value); }}
                    className="sm:col-span-2"
                  />
                  <Input
                    placeholder="Part # (optional)"
                    value={newPart.partNumber}
                    onChange={(e) => setNewPart(p => ({ ...p, partNumber: e.target.value }))}
                  />
                  <Input
                    type="number"
                    placeholder="Price $"
                    min={0}
                    step={0.01}
                    value={newPart.unitPrice || ""}
                    onChange={(e) => setNewPart(p => ({ ...p, unitPrice: Number(e.target.value) }))}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Qty:</span>
                    <Input
                      type="number"
                      min={1}
                      value={newPart.quantity}
                      onChange={(e) => setNewPart(p => ({ ...p, quantity: Math.max(1, Number(e.target.value)) }))}
                      className="w-20"
                    />
                  </div>
                  {newPart.fromInventory && (
                    <Badge variant="outline" className="text-blue-600 border-blue-300 bg-blue-50 gap-1">
                      <BoxIcon className="h-3 w-3" /> From Inventory
                    </Badge>
                  )}
                  <div className="flex-1" />
                  <Button size="sm" onClick={addPart} disabled={updateRO.isPending}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Part
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="bg-muted/20 border-b pb-3 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Details</CardTitle>
              {!editingDetails && (
                <Button variant="ghost" size="sm" className="h-7 -mr-2" onClick={startEdit}>
                  <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                </Button>
              )}
            </CardHeader>
            <CardContent className="pt-5 space-y-4 text-sm">
              {!editingDetails && (
                <>
                  <div>
                    <p className="text-muted-foreground mb-1">Status</p>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[ro.status] || "bg-gray-100 text-gray-700"}`}>
                      {ro.status.replace("_", " ")}
                    </span>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Priority</p>
                    <Badge variant={ro.priority === "urgent" ? "destructive" : "secondary"} className="capitalize">
                      {ro.priority}
                    </Badge>
                  </div>
                  <Separator />
                  <div>
                    <p className="text-muted-foreground mb-1">Assigned Technician</p>
                    <p className="font-medium">
                      {ro.assignedTo ? `${ro.assignedTo.firstName} ${ro.assignedTo.lastName}` : "Unassigned"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Mileage In</p>
                    <p className="font-medium">{ro.mileageIn ? ro.mileageIn.toLocaleString() + " mi" : "—"}</p>
                  </div>
                  {ro.mileageOut != null && (
                    <div>
                      <p className="text-muted-foreground mb-1">Mileage Out</p>
                      <p className="font-medium">{ro.mileageOut.toLocaleString()} mi</p>
                    </div>
                  )}
                  <div>
                    <p className="text-muted-foreground mb-1">Estimated Hours</p>
                    <p className="font-medium">{ro.estimatedHours ? ro.estimatedHours + " hrs" : "—"}</p>
                  </div>
                  {ro.actualHours != null && (
                    <div>
                      <p className="text-muted-foreground mb-1">Actual Hours</p>
                      <p className="font-medium">{ro.actualHours} hrs</p>
                    </div>
                  )}
                  <Separator />
                  <div>
                    <p className="text-muted-foreground mb-1">Created</p>
                    <p className="font-medium">{new Date(ro.createdAt).toLocaleDateString()}</p>
                  </div>
                  {ro.promisedDate && (
                    <div>
                      <p className="text-muted-foreground mb-1">Promised Date</p>
                      <p className="font-medium">{new Date(ro.promisedDate).toLocaleDateString()}</p>
                    </div>
                  )}
                  {ro.notes && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-muted-foreground mb-1">Internal Notes</p>
                        <p className="font-medium whitespace-pre-wrap">{ro.notes}</p>
                      </div>
                    </>
                  )}
                  {currentParts.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-muted-foreground mb-1">Parts</p>
                        <p className="font-medium">{currentParts.length} part{currentParts.length !== 1 ? "s" : ""}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-1">Parts Total</p>
                        <p className="font-bold text-base">${partsTotal.toFixed(2)}</p>
                      </div>
                    </>
                  )}
                </>
              )}

              {editingDetails && editForm && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Created Date</label>
                    <Input
                      type="date"
                      value={editForm.createdAt}
                      onChange={(e) => setEditForm({ ...editForm, createdAt: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Priority</label>
                    <Select value={editForm.priority} onValueChange={(v) => setEditForm({ ...editForm, priority: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Assigned Technician</label>
                    <Select value={editForm.assignedToId} onValueChange={(v) => setEditForm({ ...editForm, assignedToId: v })}>
                      <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {techList.map(e => (
                          <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Mileage In</label>
                      <Input
                        type="number"
                        min={0}
                        value={editForm.mileageIn}
                        onChange={(e) => setEditForm({ ...editForm, mileageIn: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Mileage Out</label>
                      <Input
                        type="number"
                        min={0}
                        value={editForm.mileageOut}
                        onChange={(e) => setEditForm({ ...editForm, mileageOut: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Est. Hours</label>
                      <Input
                        type="number"
                        min={0}
                        step={0.25}
                        value={editForm.estimatedHours}
                        onChange={(e) => setEditForm({ ...editForm, estimatedHours: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Actual Hours</label>
                      <Input
                        type="number"
                        min={0}
                        step={0.25}
                        value={editForm.actualHours}
                        onChange={(e) => setEditForm({ ...editForm, actualHours: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Promised Date</label>
                    <Input
                      type="date"
                      value={editForm.promisedDate}
                      onChange={(e) => setEditForm({ ...editForm, promisedDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Customer Complaint</label>
                    <Textarea
                      rows={3}
                      value={editForm.complaint}
                      onChange={(e) => setEditForm({ ...editForm, complaint: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Internal Notes</label>
                    <Textarea
                      rows={3}
                      placeholder="Notes visible only to shop staff..."
                      value={editForm.notes}
                      onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                    />
                  </div>

                  {editError && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {editError}
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" onClick={saveEdit} disabled={updateRO.isPending} className="flex-1">
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      {updateRO.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={cancelEdit} disabled={updateRO.isPending}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Print Template (hidden) */}
      <div ref={printRef} style={{ display: "none" }}>
        <h1>Repair Order: {ro.orderNumber}</h1>
        <p className="meta">
          Customer: {ro.customer?.firstName} {ro.customer?.lastName} &bull;{" "}
          Vehicle: {ro.vehicle?.year} {ro.vehicle?.make} {ro.vehicle?.model} &bull;{" "}
          Status: {ro.status?.replace("_", " ")} &bull; Priority: {ro.priority}
        </p>
        <div className="grid">
          <div><div className="label">Technician</div><div className="value">{ro.assignedTo ? `${ro.assignedTo.firstName} ${ro.assignedTo.lastName}` : "Unassigned"}</div></div>
          <div><div className="label">Mileage In</div><div className="value">{ro.mileageIn ? ro.mileageIn.toLocaleString() + " mi" : "—"}</div></div>
          <div><div className="label">Created</div><div className="value">{new Date(ro.createdAt).toLocaleDateString()}</div></div>
          <div><div className="label">Promised Date</div><div className="value">{ro.promisedDate ? new Date(ro.promisedDate).toLocaleDateString() : "—"}</div></div>
        </div>
        <h2>Customer Complaint</h2>
        <div className="box">{ro.complaint || "No complaint recorded."}</div>
        <h2>Technician Diagnosis</h2>
        <div className="box">{currentDiagnosis || "No diagnosis recorded."}</div>
        {currentParts.length > 0 && (
          <>
            <h2>Parts Needed</h2>
            <table>
              <thead>
                <tr><th>Part Name</th><th>Part #</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr>
              </thead>
              <tbody>
                {currentParts.map((part, i) => (
                  <tr key={i}>
                    <td>{part.name}</td>
                    <td>{part.partNumber || "—"}</td>
                    <td>{part.quantity}</td>
                    <td>${Number(part.unitPrice).toFixed(2)}</td>
                    <td>${(part.quantity * Number(part.unitPrice)).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="total-row">
                  <td colSpan={4} style={{ textAlign: "right" }}>Parts Total</td>
                  <td>${partsTotal.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
