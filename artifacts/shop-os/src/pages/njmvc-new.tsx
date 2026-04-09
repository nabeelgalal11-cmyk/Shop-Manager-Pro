import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, ClipboardCheck, ChevronDown, ChevronRight, Printer,
  Wrench, CheckCircle, AlertCircle, Info
} from "lucide-react";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  if (r.status === 204) return null;
  return r.json();
}

const VEHICLE_TYPES = ["A", "B", "C", "D", "SV"];

const emptyHeader = {
  operatorName: "", address: "", mechanicNamePrint: "", mechanicNameSigned: "",
  reportNumber: "", fleetUnitNumber: "", mileage: "", vehicleType: "none",
  vin: "", licensePlate: "", inspectionDate: new Date().toISOString().split("T")[0],
  certifiedPassed: false, notes: "",
};

type ResultMap = Record<number, { status: string; repairedDate: string; measurementValue: string; notes: string }>;

export default function NjmvcNew() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = Boolean(id);

  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("none");
  const [header, setHeader] = useState(emptyHeader);
  const [results, setResults] = useState<ResultMap>({});
  const [relatedPanelOpen, setRelatedPanelOpen] = useState(true);
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());

  // Fetch template
  const { data: template } = useQuery<any[]>({
    queryKey: ["/api/njmvc/template"],
    queryFn: () => apiFetch("/api/njmvc/template"),
  });

  // Fetch vehicles
  const { data: vehiclesData } = useQuery<any>({
    queryKey: ["/api/vehicles"],
    queryFn: () => apiFetch("/api/vehicles?limit=200"),
  });
  const vehicles = vehiclesData?.data || [];

  // Fetch existing inspection if editing
  const { data: existing } = useQuery<any>({
    queryKey: ["/api/njmvc/inspections", id],
    queryFn: () => apiFetch(`/api/njmvc/inspections/${id}`),
    enabled: isEdit,
  });

  // Related repair orders (only when editing)
  const { data: relatedData } = useQuery<any>({
    queryKey: ["/api/njmvc/inspections", id, "related-repairs"],
    queryFn: () => apiFetch(`/api/njmvc/inspections/${id}/related-repairs`),
    enabled: isEdit,
  });
  const relatedRepairs = relatedData?.repairOrders || [];

  // Expand all categories by default when template loads
  useEffect(() => {
    if (template?.length) {
      setExpandedCategories(new Set(template.map((c: any) => c.id)));
    }
  }, [template]);

  // Populate form from existing inspection
  useEffect(() => {
    if (existing) {
      setSelectedVehicleId(String(existing.vehicleId));
      setHeader({
        operatorName: existing.operatorName || "",
        address: existing.address || "",
        mechanicNamePrint: existing.mechanicNamePrint || "",
        mechanicNameSigned: existing.mechanicNameSigned || "",
        reportNumber: existing.reportNumber || "",
        fleetUnitNumber: existing.fleetUnitNumber || "",
        mileage: existing.mileage ? String(existing.mileage) : "",
        vehicleType: existing.vehicleType || "none",
        vin: existing.vin || "",
        licensePlate: existing.licensePlate || "",
        inspectionDate: existing.inspectionDate || new Date().toISOString().split("T")[0],
        certifiedPassed: existing.certifiedPassed || false,
        notes: existing.notes || "",
      });
      // Build results map from template
      if (existing.template) {
        const map: ResultMap = {};
        existing.template.forEach((cat: any) => {
          cat.items?.forEach((item: any) => {
            if (item.result) {
              map[item.id] = {
                status: item.result.status || "",
                repairedDate: item.result.repairedDate || "",
                measurementValue: item.result.measurementValue || "",
                notes: item.result.notes || "",
              };
            }
          });
        });
        setResults(map);
      }
    }
  }, [existing]);

  // Auto-populate VIN/plate when vehicle is selected
  function handleVehicleSelect(vehicleId: string) {
    setSelectedVehicleId(vehicleId);
    if (vehicleId !== "none") {
      const vehicle = vehicles.find((v: any) => String(v.id) === vehicleId);
      if (vehicle) {
        setHeader(h => ({
          ...h,
          vin: vehicle.vin || h.vin,
          licensePlate: vehicle.licensePlate || h.licensePlate,
        }));
      }
    }
  }

  function setH(key: keyof typeof emptyHeader, val: any) {
    setHeader(h => ({ ...h, [key]: val }));
  }

  function setResult(itemId: number, key: string, val: string) {
    setResults(r => ({ ...r, [itemId]: { ...emptyResult(itemId), ...r[itemId], [key]: val } }));
  }

  function emptyResult(itemId: number) {
    return results[itemId] || { status: "", repairedDate: "", measurementValue: "", notes: "" };
  }

  function toggleStatus(itemId: number, status: "ok" | "needs_repair") {
    const current = results[itemId]?.status;
    setResults(r => ({
      ...r,
      [itemId]: {
        ...emptyResult(itemId),
        status: current === status ? "" : status,
      },
    }));
  }

  // Apply a repair order to all items — mark them OK with the repair date
  function applyRepairOrder(ro: any) {
    if (!template) return;
    const repairDate = ro.completedAt
      ? new Date(ro.completedAt).toISOString().split("T")[0]
      : new Date(ro.createdAt).toISOString().split("T")[0];

    setResults(prev => {
      const next = { ...prev };
      template.forEach((cat: any) => {
        cat.items?.forEach((item: any) => {
          if (!next[item.id] || next[item.id].status === "") {
            next[item.id] = { ...emptyResult(item.id), status: "ok", repairedDate: repairDate };
          }
        });
      });
      return next;
    });
    toast({ title: "Applied", description: `RO ${ro.orderNumber} applied — items marked OK with date ${repairDate}.` });
  }

  function toggleCategory(catId: number) {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      next.has(catId) ? next.delete(catId) : next.add(catId);
      return next;
    });
  }

  function buildPayload() {
    const resultEntries = Object.entries(results)
      .filter(([, r]) => r.status || r.measurementValue || r.repairedDate)
      .map(([itemId, r]) => ({
        itemId: Number(itemId),
        status: r.status || null,
        repairedDate: r.repairedDate || null,
        measurementValue: r.measurementValue || null,
        notes: r.notes || null,
      }));

    return {
      vehicleId: selectedVehicleId === "none" ? null : Number(selectedVehicleId),
      ...header,
      vehicleType: header.vehicleType === "none" ? null : header.vehicleType,
      mileage: header.mileage ? Number(header.mileage) : null,
      certifiedPassed: header.certifiedPassed,
      results: resultEntries,
    };
  }

  const save = useMutation({
    mutationFn: (data: any) =>
      isEdit
        ? apiFetch(`/api/njmvc/inspections/${id}`, { method: "PUT", body: JSON.stringify(data) })
        : apiFetch("/api/njmvc/inspections", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/njmvc/inspections"] });
      toast({ title: isEdit ? "Inspection updated" : "Inspection created" });
      setLocation(`/njmvc/${data.id}`);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleSave() {
    if (selectedVehicleId === "none") {
      toast({ title: "Select a vehicle", variant: "destructive" });
      return;
    }
    save.mutate(buildPayload());
  }

  function handleSaveAndPrint() {
    if (selectedVehicleId === "none") {
      toast({ title: "Select a vehicle", variant: "destructive" });
      return;
    }
    save.mutate(buildPayload(), {
      onSuccess: (data) => setLocation(`/njmvc/${data.id}/print`),
    });
  }

  const activeCategories = template?.filter((c: any) => c.active) || [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/njmvc")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <ClipboardCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{isEdit ? "Edit NJMVC Inspection" : "New NJMVC Quarterly Inspection"}</h1>
            <p className="text-sm text-muted-foreground">NJ MVC Quarterly Vehicle Inspection Report</p>
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setLocation("/njmvc")}>Cancel</Button>
          <Button variant="outline" onClick={handleSaveAndPrint} disabled={save.isPending}>
            <Printer className="h-4 w-4 mr-2" /> Save & Print
          </Button>
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? "Saving..." : isEdit ? "Save Changes" : "Create Inspection"}
          </Button>
        </div>
      </div>

      <div className="flex gap-5">
        {/* Main Form Column */}
        <div className="flex-1 min-w-0 space-y-5">
          {/* Vehicle Selector */}
          <Card className="border-border">
            <CardHeader className="pb-3"><CardTitle className="text-base">Vehicle</CardTitle></CardHeader>
            <CardContent>
              <Select value={selectedVehicleId} onValueChange={handleVehicleSelect}>
                <SelectTrigger><SelectValue placeholder="Select a vehicle..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select a vehicle...</SelectItem>
                  {vehicles.map((v: any) => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      {v.year} {v.make} {v.model}
                      {v.licensePlate ? ` — ${v.licensePlate}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Header Fields */}
          <Card className="border-border">
            <CardHeader className="pb-3"><CardTitle className="text-base">Report Header</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-1.5 col-span-2">
                <Label>Operator</Label>
                <Input placeholder="Operator / Company Name" value={header.operatorName} onChange={e => setH("operatorName", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Inspection Date</Label>
                <Input type="date" value={header.inspectionDate} onChange={e => setH("inspectionDate", e.target.value)} />
              </div>
              <div className="space-y-1.5 col-span-3">
                <Label>Address</Label>
                <Input placeholder="Address" value={header.address} onChange={e => setH("address", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Mechanic Name (Print)</Label>
                <Input placeholder="Print name" value={header.mechanicNamePrint} onChange={e => setH("mechanicNamePrint", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Mechanic Name (Signed)</Label>
                <Input placeholder="Signature" value={header.mechanicNameSigned} onChange={e => setH("mechanicNameSigned", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Miles</Label>
                <Input type="number" placeholder="Mileage" value={header.mileage} onChange={e => setH("mileage", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Report #</Label>
                <Input placeholder="Report number" value={header.reportNumber} onChange={e => setH("reportNumber", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Fleet Unit #</Label>
                <Input placeholder="Fleet unit number" value={header.fleetUnitNumber} onChange={e => setH("fleetUnitNumber", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Vehicle Type</Label>
                <Select value={header.vehicleType} onValueChange={v => setH("vehicleType", v)}>
                  <SelectTrigger><SelectValue placeholder="Type..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Select —</SelectItem>
                    {VEHICLE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>VIN</Label>
                <Input placeholder="VIN" value={header.vin} onChange={e => setH("vin", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>License Plate</Label>
                <Input placeholder="Plate number" value={header.licensePlate} onChange={e => setH("licensePlate", e.target.value)} />
              </div>
            </CardContent>
          </Card>

          {/* Inspection Items */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Vehicle Components Inspected</h2>
              <span className="text-xs text-muted-foreground">(OK / Needs Repair / Repaired Date)</span>
            </div>

            {activeCategories.map((cat: any) => {
              const activeItems = cat.items?.filter((i: any) => i.active) || [];
              const filledCount = activeItems.filter((i: any) => results[i.id]?.status).length;
              const isExpanded = expandedCategories.has(cat.id);

              return (
                <Card key={cat.id} className="border-border overflow-hidden">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
                    onClick={() => toggleCategory(cat.id)}
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <span className="font-semibold text-sm uppercase tracking-wide">{cat.name}</span>
                      {cat.notes && <span className="text-xs text-muted-foreground">({cat.notes})</span>}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {filledCount}/{activeItems.length} items
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="divide-y divide-border">
                      {/* Column headers */}
                      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 px-4 py-1.5 bg-muted/20 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        <div>Item</div>
                        <div className="w-10 text-center">OK</div>
                        <div className="w-20 text-center">Needs Repair</div>
                        <div className="w-28 text-center">Repaired Date</div>
                        <div className="w-24 text-center">Measurement</div>
                      </div>

                      {activeItems.map((item: any) => {
                        const r = results[item.id];
                        return (
                          <div
                            key={item.id}
                            className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 items-center px-4 py-2 hover:bg-muted/10"
                          >
                            <div className="text-sm">{item.label}</div>

                            {/* OK */}
                            <div className="w-10 flex justify-center">
                              <Checkbox
                                checked={r?.status === "ok"}
                                onCheckedChange={() => toggleStatus(item.id, "ok")}
                                className="h-4 w-4"
                              />
                            </div>

                            {/* Needs Repair */}
                            <div className="w-20 flex justify-center">
                              <Checkbox
                                checked={r?.status === "needs_repair"}
                                onCheckedChange={() => toggleStatus(item.id, "needs_repair")}
                                className="h-4 w-4 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
                              />
                            </div>

                            {/* Repaired Date */}
                            <div className="w-28">
                              <Input
                                type="date"
                                className="h-7 text-xs"
                                value={r?.repairedDate || ""}
                                onChange={e => setResult(item.id, "repairedDate", e.target.value)}
                              />
                            </div>

                            {/* Measurement */}
                            <div className="w-24">
                              {item.hasMeasurement ? (
                                <div className="flex items-center gap-1">
                                  <Input
                                    type="number"
                                    step="0.1"
                                    className="h-7 text-xs"
                                    placeholder="0"
                                    value={r?.measurementValue || ""}
                                    onChange={e => setResult(item.id, "measurementValue", e.target.value)}
                                  />
                                  <span className="text-xs text-muted-foreground whitespace-nowrap">{item.measurementUnit}</span>
                                </div>
                              ) : <div className="w-24" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {/* Certification */}
          <Card className="border-border border-2 border-primary/20 bg-primary/5">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="certified"
                  checked={header.certifiedPassed}
                  onCheckedChange={v => setH("certifiedPassed", Boolean(v))}
                  className="mt-0.5 h-5 w-5"
                />
                <label htmlFor="certified" className="text-sm font-medium leading-snug cursor-pointer">
                  <span className="font-semibold">CERTIFICATION:</span> THIS VEHICLE HAS PASSED ALL THE INSPECTION
                  ITEMS FOR THE QUARTERLY VEHICLE INSPECTION REPORT.
                </label>
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card className="border-border">
            <CardHeader className="pb-3"><CardTitle className="text-base">Notes</CardTitle></CardHeader>
            <CardContent>
              <Textarea
                placeholder="Additional notes..."
                value={header.notes}
                onChange={e => setH("notes", e.target.value)}
                rows={3}
              />
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-3 pb-6">
            <Button variant="outline" onClick={() => setLocation("/njmvc")}>Cancel</Button>
            <Button variant="outline" onClick={handleSaveAndPrint} disabled={save.isPending}>
              <Printer className="h-4 w-4 mr-2" /> Save & Print
            </Button>
            <Button onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? "Saving..." : isEdit ? "Save Changes" : "Create Inspection"}
            </Button>
          </div>
        </div>

        {/* Side Panel — Related Repair Orders */}
        {isEdit && (
          <div className="w-80 flex-shrink-0">
            <div className="sticky top-6 space-y-3">
              <Card className="border-border">
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                  onClick={() => setRelatedPanelOpen(o => !o)}
                >
                  <div className="flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-sm">Work Since Last Inspection</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{relatedRepairs.length}</Badge>
                    {relatedPanelOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </div>
                </button>

                {relatedPanelOpen && (
                  <div className="border-t border-border">
                    {relatedRepairs.length === 0 ? (
                      <div className="px-4 py-6 text-center">
                        <Info className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">No repair orders found since the previous inspection.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-border max-h-96 overflow-y-auto">
                        {relatedRepairs.map((ro: any) => (
                          <div key={ro.id} className="p-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-mono text-xs font-semibold text-primary">{ro.orderNumber}</div>
                                <div className="text-xs text-muted-foreground">
                                  {ro.completedAt
                                    ? new Date(ro.completedAt).toLocaleDateString()
                                    : new Date(ro.createdAt).toLocaleDateString()}
                                  {ro.technician ? ` · ${ro.technician}` : ""}
                                </div>
                              </div>
                              <Badge variant="outline" className="text-xs capitalize flex-shrink-0">{ro.status}</Badge>
                            </div>
                            {ro.complaint && <p className="text-xs text-muted-foreground line-clamp-2">{ro.complaint}</p>}
                            {ro.diagnosis && <p className="text-xs text-foreground line-clamp-2">{ro.diagnosis}</p>}
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full h-7 text-xs"
                              onClick={() => applyRepairOrder(ro)}
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Apply — Mark items OK
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>

              <Card className="border-border bg-amber-50/50 border-amber-200">
                <CardContent className="pt-3 pb-3">
                  <div className="flex gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800">
                      "Apply" marks <strong>unfilled items</strong> as OK using the repair date. Review each item before certifying.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
