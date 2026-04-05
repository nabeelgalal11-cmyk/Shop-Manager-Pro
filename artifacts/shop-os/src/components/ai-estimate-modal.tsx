import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Bot, CheckCircle2, AlertCircle, Clock,
  Wrench, Droplets, StickyNote, ChevronRight, RotateCcw,
  History, Package
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AIPart {
  name: string;
  type: "required" | "recommended";
  estimated_price: number;
  useUsed?: boolean;
  included?: boolean;
}

interface AIEstimateResult {
  labor_hours: string;
  labor_value: number;
  labor_rate: number;
  parts: AIPart[];
  fluids: string[];
  notes: string;
}

interface SavedEstimate {
  vehicle: string;
  repair: string;
  labor_value: number;
  labor_hours: string;
  savedAt: string;
}

interface Vehicle {
  id: number;
  year: number;
  make: string;
  model: string;
}

interface LineItem {
  type: "labor" | "part" | "fee" | "discount";
  description: string;
  quantity: number;
  unitPrice: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  vehicles: Vehicle[];
  selectedVehicleId?: number;
  onApply: (items: LineItem[], notes: string) => void;
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

const STORAGE_KEY = "shopOS_aiEstimates";

function storageKey(vehicleLabel: string, repair: string) {
  return `${vehicleLabel.toLowerCase().trim()}::${repair.toLowerCase().trim()}`;
}

function loadSaved(): Record<string, SavedEstimate> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"); }
  catch { return {}; }
}

function saveEstimate(vehicleLabel: string, repair: string, result: AIEstimateResult) {
  const all = loadSaved();
  all[storageKey(vehicleLabel, repair)] = {
    vehicle: vehicleLabel,
    repair,
    labor_value: result.labor_value,
    labor_hours: result.labor_hours,
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

function findSaved(vehicleLabel: string, repair: string): SavedEstimate | null {
  return loadSaved()[storageKey(vehicleLabel, repair)] ?? null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AIEstimateModal({ open, onClose, vehicles, selectedVehicleId, onApply }: Props) {
  const { toast } = useToast();

  const [vehicleId, setVehicleId] = useState<number>(selectedVehicleId ?? 0);
  const [repair, setRepair] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AIEstimateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previousEstimate, setPreviousEstimate] = useState<SavedEstimate | null>(null);

  const selectedVehicle = vehicles.find(v => v.id === vehicleId);
  const vehicleLabel = selectedVehicle
    ? `${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}`
    : "";

  // Sync selected vehicle when prop changes
  useEffect(() => {
    if (selectedVehicleId) setVehicleId(selectedVehicleId);
  }, [selectedVehicleId]);

  // Check for previous saved estimate when vehicle + repair changes
  useEffect(() => {
    if (vehicleLabel && repair.trim().length > 3) {
      setPreviousEstimate(findSaved(vehicleLabel, repair));
    } else {
      setPreviousEstimate(null);
    }
  }, [vehicleLabel, repair]);

  const generate = async () => {
    if (!selectedVehicle) {
      toast({ title: "Please select a vehicle first", variant: "destructive" });
      return;
    }
    if (!repair.trim()) {
      toast({ title: "Please describe the repair", variant: "destructive" });
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const resp = await fetch("/api/ai-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle: {
            year: selectedVehicle.year,
            make: selectedVehicle.make,
            model: selectedVehicle.model,
          },
          repair: repair.trim(),
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }

      const data: AIEstimateResult = await resp.json();
      // Default: required parts included, recommended not included
      data.parts = data.parts.map(p => ({
        ...p,
        included: p.type === "required",
        useUsed: false,
      }));
      setResult(data);
    } catch (e: any) {
      setError(e.message ?? "Failed to generate estimate");
    } finally {
      setLoading(false);
    }
  };

  const togglePart = (i: number, field: "included" | "useUsed") => {
    if (!result) return;
    const parts = result.parts.map((p, idx) =>
      idx === i ? { ...p, [field]: !p[field] } : p
    );
    setResult({ ...result, parts });
  };

  const applyToEstimate = () => {
    if (!result) return;

    const laborRate = result.labor_rate ?? 120;
    const lineItems: LineItem[] = [];

    // Labor line item
    lineItems.push({
      type: "labor",
      description: `Labor – ${repair} (${result.labor_hours} hrs)`,
      quantity: result.labor_value,
      unitPrice: laborRate,
    });

    // Included parts
    result.parts
      .filter(p => p.included)
      .forEach(p => {
        lineItems.push({
          type: "part",
          description: `${p.name}${p.useUsed ? " (Used/Recycled)" : ""}`,
          quantity: 1,
          unitPrice: p.estimated_price ?? 0,
        });
      });

    // Fluids as part line items
    result.fluids.forEach(f => {
      lineItems.push({
        type: "part",
        description: `Fluid – ${f}`,
        quantity: 1,
        unitPrice: 0,
      });
    });

    // Save confirmed estimate for future reuse
    if (vehicleLabel) saveEstimate(vehicleLabel, repair, result);

    onApply(lineItems, result.notes ?? "");
    onClose();
    toast({ title: "AI estimate applied to form" });
  };

  const reset = () => {
    setResult(null);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Bot className="h-5 w-5 text-blue-600" />
            AI Estimate Assistant
          </DialogTitle>
        </DialogHeader>

        {/* ── Input panel ── */}
        {!result && (
          <div className="space-y-4 pt-2">
            {/* Vehicle */}
            <div className="space-y-1.5">
              <Label>Vehicle</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={vehicleId}
                onChange={e => setVehicleId(Number(e.target.value))}
              >
                <option value={0}>Select a vehicle…</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.year} {v.make} {v.model}
                  </option>
                ))}
              </select>
            </div>

            {/* Repair description */}
            <div className="space-y-1.5">
              <Label>Repair / Complaint</Label>
              <Input
                placeholder="e.g. Replace alternator, brake job front axle, timing belt…"
                value={repair}
                onChange={e => setRepair(e.target.value)}
                onKeyDown={e => e.key === "Enter" && generate()}
              />
            </div>

            {/* Previous estimate notice */}
            {previousEstimate && (
              <div className="flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50 p-3">
                <History className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm flex-1">
                  <p className="font-medium text-blue-800">Previous saved estimate found</p>
                  <p className="text-blue-700">
                    {previousEstimate.labor_hours} hrs ({previousEstimate.labor_value}h avg) —
                    saved {new Date(previousEstimate.savedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
                <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1" onClick={generate}>
                  <RotateCcw className="h-3.5 w-3.5" /> Retry
                </Button>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={generate} disabled={loading || !selectedVehicle || !repair.trim()}>
                {loading ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing…</>
                ) : (
                  <><Bot className="h-4 w-4 mr-2" /> Generate Estimate</>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ── Results panel ── */}
        {result && (
          <div className="space-y-5 pt-2">
            {/* Header banner */}
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-green-800 text-sm">{vehicleLabel}</p>
                <p className="text-green-700 text-xs">{repair}</p>
              </div>
              <Button size="sm" variant="ghost" className="text-green-700 h-7" onClick={reset}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> New
              </Button>
            </div>

            {/* Labor */}
            <div className="rounded-md border bg-muted/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <p className="font-semibold text-sm">Labor</p>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Range</p>
                  <p className="font-bold text-lg">{result.labor_hours} hrs</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Billing value</p>
                  <p className="font-bold text-lg">{result.labor_value} hrs</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Est. labor cost</p>
                  <p className="font-bold text-lg text-green-700">
                    ${(result.labor_value * (result.labor_rate ?? 120)).toFixed(0)}
                  </p>
                </div>
              </div>

              {/* AI vs Saved comparison */}
              {previousEstimate && (
                <div className="mt-3 pt-3 border-t text-xs text-muted-foreground flex gap-4">
                  <span className="font-medium">AI says:</span>
                  <span className="text-blue-700">{result.labor_value}h</span>
                  <span className="font-medium">Your previous:</span>
                  <span className="text-orange-600">{previousEstimate.labor_value}h</span>
                  {result.labor_value !== previousEstimate.labor_value && (
                    <Badge variant="outline" className="text-[10px] h-4">differs</Badge>
                  )}
                </div>
              )}
            </div>

            {/* Parts */}
            {result.parts.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <p className="font-semibold text-sm">Parts</p>
                  <span className="text-xs text-muted-foreground">(check to include in estimate)</span>
                </div>
                <div className="space-y-2">
                  {result.parts.map((part, i) => (
                    <div
                      key={i}
                      className={`rounded-md border p-3 transition-colors ${
                        part.included
                          ? "bg-blue-50 border-blue-200"
                          : "bg-muted/10 border-border opacity-60"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={!!part.included}
                          onChange={() => togglePart(i, "included")}
                          className="h-4 w-4 rounded accent-blue-600"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{part.name}</span>
                            <Badge
                              variant="outline"
                              className={`text-[10px] h-4 ${
                                part.type === "required"
                                  ? "border-blue-300 text-blue-700 bg-blue-50"
                                  : "border-orange-300 text-orange-600 bg-orange-50"
                              }`}
                            >
                              {part.type === "required" ? "Required" : "Recommended"}
                            </Badge>
                          </div>
                          {part.estimated_price > 0 && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              ~${part.estimated_price.toFixed(0)} est.
                            </p>
                          )}
                        </div>
                        {/* New / Used toggle */}
                        {part.included && (
                          <div className="flex rounded-md border overflow-hidden text-xs">
                            <button
                              type="button"
                              className={`px-2 py-1 transition-colors ${
                                !part.useUsed
                                  ? "bg-blue-600 text-white"
                                  : "bg-background text-muted-foreground hover:bg-muted"
                              }`}
                              onClick={() => part.useUsed && togglePart(i, "useUsed")}
                            >
                              New
                            </button>
                            <button
                              type="button"
                              className={`px-2 py-1 transition-colors ${
                                part.useUsed
                                  ? "bg-orange-500 text-white"
                                  : "bg-background text-muted-foreground hover:bg-muted"
                              }`}
                              onClick={() => !part.useUsed && togglePart(i, "useUsed")}
                            >
                              Used
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Fluids */}
            {result.fluids.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Droplets className="h-4 w-4 text-muted-foreground" />
                  <p className="font-semibold text-sm">Fluids</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {result.fluids.map((f, i) => (
                    <Badge key={i} variant="outline" className="text-xs border-cyan-300 text-cyan-700 bg-cyan-50">
                      {f}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {result.notes && (
              <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/30 rounded-md p-3">
                <StickyNote className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <p>{result.notes}</p>
              </div>
            )}

            <Separator />

            {/* Apply */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Discard</Button>
              <Button onClick={applyToEstimate} className="gap-2">
                <ChevronRight className="h-4 w-4" /> Apply to Estimate
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
