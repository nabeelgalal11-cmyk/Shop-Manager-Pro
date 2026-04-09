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
  Wrench, CheckCircle, Info
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

type ItemStatus = "ok" | "needs_repair" | "na";
type ResultMap = Record<number, { status: ItemStatus | ""; repairedDate: string; measurementValue: string; notes: string }>;

// ─── Keyword→Category mapping for Apply button ────────────────────────────────
// Each entry maps a set of keywords to category names (partial, case-insensitive).
// When a repair order's complaint/diagnosis/parts text matches a keyword, all
// active items in matching categories are toggled to "ok" with the RO date.

interface KeywordRule {
  keywords: string[];
  categoryPatterns: string[];
}

const KEYWORD_RULES: KeywordRule[] = [
  { keywords: ["brake", "brakes", "braking", "abs", "rotor", "drum", "caliper", "master cylinder", "wheel cylinder"], categoryPatterns: ["brake"] },
  { keywords: ["tire", "tires", "wheel", "tread", "flat"], categoryPatterns: ["tire"] },
  { keywords: ["light", "lights", "headlight", "taillight", "turn signal", "marker", "clearance", "lamp", "bulb", "led", "stop arm", "crossing arm", "backup alarm", "back up alarm"], categoryPatterns: ["lighting"] },
  { keywords: ["wiper", "wipers", "washer", "windshield"], categoryPatterns: ["wiper"] },
  { keywords: ["exhaust", "muffler", "catalytic", "emission"], categoryPatterns: ["exhaust"] },
  { keywords: ["steering", "power steering", "tie rod", "ball joint", "rack", "pinion"], categoryPatterns: ["steering"] },
  { keywords: ["fuel", "gas", "tank", "fuel line", "fuel pump"], categoryPatterns: ["fuel"] },
  { keywords: ["mirror", "mirrors", "rearview", "crossover"], categoryPatterns: ["mirror"] },
  { keywords: ["glass", "windshield", "window", "glazing"], categoryPatterns: ["glass"] },
  { keywords: ["door", "doors", "emergency door", "emergency exit", "exit", "step", "grab handle"], categoryPatterns: ["door", "emergency exit"] },
  { keywords: ["fire extinguisher", "first aid", "flare", "triangle", "warning device", "wrecking bar"], categoryPatterns: ["safety"] },
  { keywords: ["differential", "diff"], categoryPatterns: ["differential"] },
  { keywords: ["transmission", "trans", "gearbox"], categoryPatterns: ["transmission"] },
  { keywords: ["underbody", "frame", "crossmember", "spring", "shock", "absorber", "driveshaft", "drive shaft"], categoryPatterns: ["underbody"] },
  { keywords: ["lift", "handicap", "wheelchair", "ramp", "interlock"], categoryPatterns: ["handicapped"] },
  { keywords: ["belt", "hose", "battery", "coolant", "antifreeze", "oil", "radiator", "alternator", "underhood", "engine"], categoryPatterns: ["underhood"] },
  { keywords: ["interior", "seat", "seats", "heater", "defroster", "instrument", "dashboard"], categoryPatterns: ["bus interior"] },
  { keywords: ["exterior", "body", "bumper", "rub rail"], categoryPatterns: ["bus exterior"] },
  { keywords: ["lining", "pad", "pads"], categoryPatterns: ["brake lining"] },
];

function getMatchedCategoryPatterns(ro: { complaint?: string | null; diagnosis?: string | null; parts?: string | null }): string[] {
  const text = [ro.complaint, ro.diagnosis, ro.parts].filter(Boolean).join(" ").toLowerCase();
  const matched = new Set<string>();
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some(kw => text.includes(kw))) {
      rule.categoryPatterns.forEach(p => matched.add(p));
    }
  }
  return Array.from(matched);
}

export default function NjmvcNew() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = Boolean(id);

  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("none");
  const [header, setHeader] = useState(emptyHeader);
  const [results, setResults] = useState<ResultMap>({});
  const [relatedPanelOpen, setRelatedPanelOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());

  const { data: template } = useQuery<{
    id: number; name: string; active: boolean; notes: string | null;
    items: { id: number; label: string; active: boolean; hasMeasurement: boolean; measurementUnit: string | null; sortOrder: number }[];
  }[]>({
    queryKey: ["/api/njmvc/template"],
    queryFn: () => apiFetch("/api/njmvc/template"),
  });

  const { data: vehiclesData } = useQuery<{ data: { id: number; year: string; make: string; model: string; licensePlate: string | null; vin: string | null }[] }>({
    queryKey: ["/api/vehicles"],
    queryFn: () => apiFetch("/api/vehicles?limit=200"),
  });
  const vehicles = vehiclesData?.data || [];

  const { data: existing } = useQuery<{
    vehicleId: number; operatorName: string | null; address: string | null;
    mechanicNamePrint: string | null; mechanicNameSigned: string | null;
    reportNumber: string | null; fleetUnitNumber: string | null; mileage: number | null;
    vehicleType: string | null; vin: string | null; licensePlate: string | null;
    inspectionDate: string | null;
    certifiedPassed: boolean; notes: string | null;
    template: { id: number; items: { id: number; result: { status: string | null; repairedDate: string | null; measurementValue: string | null; notes: string | null } | null }[] }[];
  }>({
    queryKey: ["/api/njmvc/inspections", id],
    queryFn: () => apiFetch(`/api/njmvc/inspections/${id}`),
    enabled: isEdit,
  });

  const vehicleIdForRepairs = isEdit ? null : (selectedVehicleId !== "none" ? selectedVehicleId : null);

  const { data: relatedDataExisting } = useQuery<{ repairOrders: { id: number; orderNumber: string; complaint: string | null; diagnosis: string | null; parts: string | null; status: string; completedAt: string | null; createdAt: string; technician: string | null }[] }>({
    queryKey: ["/api/njmvc/inspections", id, "related-repairs"],
    queryFn: () => apiFetch(`/api/njmvc/inspections/${id}/related-repairs`),
    enabled: isEdit,
  });

  const { data: relatedDataNew } = useQuery<{ repairOrders: { id: number; orderNumber: string; complaint: string | null; diagnosis: string | null; parts: string | null; status: string; completedAt: string | null; createdAt: string; technician: string | null }[] }>({
    queryKey: ["/api/njmvc/vehicles", vehicleIdForRepairs, "related-repairs", header.inspectionDate],
    queryFn: () => apiFetch(
      `/api/njmvc/vehicles/${vehicleIdForRepairs}/related-repairs?untilDate=${encodeURIComponent(header.inspectionDate || new Date().toISOString().split("T")[0])}`
    ),
    enabled: !isEdit && vehicleIdForRepairs !== null,
  });

  const relatedData = isEdit ? relatedDataExisting : relatedDataNew;
  const relatedRepairs = relatedData?.repairOrders || [];

  useEffect(() => {
    if (template?.length) {
      setExpandedCategories(new Set(template.map(c => c.id)));
      if (!isEdit) {
        const defaults: ResultMap = {};
        template.forEach(cat => {
          cat.items.filter(i => i.active).forEach(item => {
            defaults[item.id] = { status: "ok", repairedDate: "", measurementValue: "", notes: "" };
          });
        });
        setResults(defaults);
      }
    }
  }, [template, isEdit]);

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
      if (existing.template) {
        const map: ResultMap = {};
        existing.template.forEach(cat => {
          cat.items?.forEach(item => {
            if (item.result) {
              map[item.id] = {
                status: (item.result.status || "") as ItemStatus | "",
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

  function handleVehicleSelect(vehicleId: string) {
    setSelectedVehicleId(vehicleId);
    if (vehicleId !== "none") {
      const vehicle = vehicles.find(v => String(v.id) === vehicleId);
      if (vehicle) {
        setHeader(h => ({
          ...h,
          vin: vehicle.vin || h.vin,
          licensePlate: vehicle.licensePlate || h.licensePlate,
        }));
      }
    }
  }

  function setH(key: keyof typeof emptyHeader, val: string | boolean) {
    setHeader(h => ({ ...h, [key]: val }));
  }

  function emptyResult(itemId: number): ResultMap[number] {
    return results[itemId] || { status: "", repairedDate: "", measurementValue: "", notes: "" };
  }

  function setResult(itemId: number, key: keyof ResultMap[number], val: string) {
    setResults(r => ({ ...r, [itemId]: { ...emptyResult(itemId), [key]: val } }));
  }

  function toggleStatus(itemId: number, status: ItemStatus) {
    const current = results[itemId]?.status;
    setResults(r => ({
      ...r,
      [itemId]: {
        ...emptyResult(itemId),
        status: current === status ? "" : status,
      },
    }));
  }

  // Apply a repair order: use keyword matching to identify which inspection categories
  // are relevant to this RO, then mark those category's "needs_repair" items as OK.
  // If no category matches are found, fall back to marking ALL "needs_repair" items as OK.
  function applyRepairOrder(ro: { id: number; orderNumber: string; complaint: string | null; diagnosis: string | null; parts: string | null; completedAt: string | null; createdAt: string }) {
    if (!template) return;

    const repairDate = ro.completedAt
      ? new Date(ro.completedAt).toISOString().split("T")[0]
      : new Date(ro.createdAt).toISOString().split("T")[0];

    // Determine which categories this RO is relevant to via keyword matching
    const matchedPatterns = getMatchedCategoryPatterns(ro);

    // Collect item IDs to update: prioritise keyword-matched categories, then fall back
    const targetItemIds: number[] = [];

    if (matchedPatterns.length > 0) {
      template.forEach(cat => {
        const catNameLower = cat.name.toLowerCase();
        const isMatch = matchedPatterns.some(pattern => catNameLower.includes(pattern));
        if (isMatch) {
          cat.items
            .filter(item => item.active && results[item.id]?.status === "needs_repair")
            .forEach(item => targetItemIds.push(item.id));
        }
      });

      // If keyword match found categories but none had "needs_repair" items,
      // still apply to matched-category items that have no status (mark them ok)
      if (targetItemIds.length === 0) {
        template.forEach(cat => {
          const catNameLower = cat.name.toLowerCase();
          const isMatch = matchedPatterns.some(pattern => catNameLower.includes(pattern));
          if (isMatch) {
            cat.items
              .filter(item => item.active)
              .forEach(item => targetItemIds.push(item.id));
          }
        });
      }
    } else {
      // No keyword matches — fall back to all "needs_repair" items across the form
      template.forEach(cat => {
        cat.items
          .filter(item => item.active && results[item.id]?.status === "needs_repair")
          .forEach(item => targetItemIds.push(item.id));
      });
    }

    if (targetItemIds.length === 0) {
      toast({
        title: "No items to apply",
        description: "No matching inspection items found for this repair order.",
        variant: "destructive",
      });
      return;
    }

    setResults(prev => {
      const next = { ...prev };
      targetItemIds.forEach(itemId => {
        next[itemId] = { ...emptyResult(itemId), status: "ok", repairedDate: repairDate };
      });
      return next;
    });

    const matchLabel = matchedPatterns.length > 0
      ? `Matched sections: ${matchedPatterns.join(", ")}.`
      : "Applied to all 'Needs Repair' items (no specific section matched).";

    toast({
      title: `Applied RO ${ro.orderNumber}`,
      description: `${targetItemIds.length} item(s) marked OK with date ${repairDate}. ${matchLabel}`,
    });
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
    mutationFn: (data: ReturnType<typeof buildPayload>) =>
      isEdit
        ? apiFetch(`/api/njmvc/inspections/${id}`, { method: "PUT", body: JSON.stringify(data) })
        : apiFetch("/api/njmvc/inspections", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: (data: { id: number }) => {
      qc.invalidateQueries({ queryKey: ["/api/njmvc/inspections"] });
      toast({ title: isEdit ? "Inspection updated" : "Inspection created" });
      setLocation(`/njmvc/${data.id}`);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
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
      onSuccess: (data: { id: number }) => setLocation(`/njmvc/${data.id}/print`),
    });
  }

  const activeCategories = template?.filter(c => c.active) || [];

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
                  {vehicles.map(v => (
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
              <span className="text-xs text-muted-foreground">(OK / Needs Repair / N/A)</span>
            </div>

            {activeCategories.map(cat => {
              const activeItems = cat.items?.filter(i => i.active) || [];
              const filledCount = activeItems.filter(i => results[i.id]?.status).length;
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
                      <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-2 px-4 py-1.5 bg-muted/20 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        <div>Item</div>
                        <div className="w-10 text-center">OK</div>
                        <div className="w-20 text-center">Needs Repair</div>
                        <div className="w-10 text-center">N/A</div>
                        <div className="w-28 text-center">Repaired Date</div>
                        <div className="w-24 text-center">Measurement</div>
                      </div>

                      {activeItems.map(item => {
                        const r = results[item.id];
                        return (
                          <div
                            key={item.id}
                            className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-2 items-center px-4 py-2 hover:bg-muted/10"
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

                            {/* N/A */}
                            <div className="w-10 flex justify-center">
                              <Checkbox
                                checked={r?.status === "na"}
                                onCheckedChange={() => toggleStatus(item.id, "na")}
                                className="h-4 w-4 data-[state=checked]:bg-slate-400 data-[state=checked]:border-slate-400"
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
        {(isEdit || selectedVehicleId !== "none") && (
          <div className={`flex-shrink-0 ${relatedPanelOpen ? "w-80" : ""}`}>
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
                      <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
                        {relatedRepairs.map(ro => {
                          const matched = getMatchedCategoryPatterns(ro);
                          return (
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
                              {matched.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {matched.map(m => (
                                    <Badge key={m} variant="secondary" className="text-xs capitalize">{m}</Badge>
                                  ))}
                                </div>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full h-7 text-xs"
                                onClick={() => applyRepairOrder(ro)}
                              >
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Apply to Inspection
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </Card>

              <Card className="border-border bg-blue-50/50 border-blue-200">
                <CardContent className="pt-3 pb-3">
                  <div className="flex gap-2">
                    <Info className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-800">
                      <strong>Apply</strong> uses the RO description to identify related inspection sections (brakes, tires, lights, etc.) and marks those items OK with the completion date.
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
