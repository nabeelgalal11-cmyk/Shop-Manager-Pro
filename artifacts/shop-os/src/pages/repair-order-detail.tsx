import { useState, useRef, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRepairOrder, getGetRepairOrderQueryKey,
  useUpdateRepairOrder, useDeleteRepairOrder,
  useGetInventory, getGetInventoryQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Printer, Trash2, Plus, X, Save, Package, Search, BoxIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

type Part = { name: string; partNumber?: string; quantity: number; unitPrice: number; fromInventory?: boolean };

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

  const updateRO = useUpdateRepairOrder();
  const deleteRO = useDeleteRepairOrder();

  const currentDiagnosis = diagnosis !== null ? diagnosis : (ro?.diagnosis ?? "");
  const currentParts: Part[] = parts !== null ? parts : ((ro?.parts as Part[]) ?? []);

  // Filter inventory based on search query
  const inventoryMatches = searchQuery.trim().length >= 1
    ? allInventory.filter(item =>
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.partNumber ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.category ?? "").toLowerCase().includes(searchQuery.toLowerCase())
      ).slice(0, 8)
    : [];

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
    updateRO.mutate({ id, data: { diagnosis: currentDiagnosis } as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRepairOrderQueryKey(id) });
        toast({ title: "Diagnosis saved" });
      },
      onError: () => toast({ title: "Failed to save", variant: "destructive" }),
    });
  };

  const saveParts = (updated: Part[]) => {
    updateRO.mutate({ id, data: { parts: updated } as any }, {
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

  const updateStatus = (newStatus: any) => {
    updateRO.mutate({ id, data: { status: newStatus } as any }, {
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
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Search Inventory</p>
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
                        {inventoryMatches.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="w-full text-left px-3 py-2.5 hover:bg-muted/60 flex items-center justify-between gap-4 border-b last:border-0 transition-colors"
                            onMouseDown={(e) => { e.preventDefault(); selectInventoryItem(item); }}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <BoxIcon className="h-4 w-4 text-blue-500 flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{item.name}</p>
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
                        ))}
                      </div>
                    )}
                    {showDropdown && searchQuery.trim().length >= 1 && inventoryMatches.length === 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg px-3 py-3 text-sm text-muted-foreground">
                        No inventory match — you can still add this part manually below.
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
            <CardHeader className="bg-muted/20 border-b pb-3">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="pt-5 space-y-4 text-sm">
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
              <div>
                <p className="text-muted-foreground mb-1">Estimated Hours</p>
                <p className="font-medium">{ro.estimatedHours ? ro.estimatedHours + " hrs" : "—"}</p>
              </div>
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
