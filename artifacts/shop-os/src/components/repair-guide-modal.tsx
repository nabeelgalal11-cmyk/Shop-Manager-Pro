import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Lightbulb,
  Loader2,
  PlayCircle,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Vehicle {
  year: number;
  make: string;
  model: string;
}

interface RepairStep {
  step: number;
  title: string;
  details: string;
}

interface RepairGuide {
  title: string;
  overview: string;
  difficulty: "Easy" | "Moderate" | "Advanced";
  estimated_time: string;
  tools: string[];
  parts: string[];
  steps: RepairStep[];
  safety_notes: string[];
  youtube_queries: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  vehicle: Vehicle;
  initialRepair: string;
}

function youtubeSearchUrl(query: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export function RepairGuideModal({
  open,
  onClose,
  vehicle,
  initialRepair,
}: Props) {
  const [repair, setRepair] = useState(initialRepair);
  const [loading, setLoading] = useState(false);
  const [guide, setGuide] = useState<RepairGuide | null>(null);
  const [error, setError] = useState<string | null>(null);

  const vehicleLabel = useMemo(
    () => `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    [vehicle],
  );

  useEffect(() => {
    if (open) {
      setRepair(initialRepair);
      setGuide(null);
      setError(null);
    }
  }, [open, initialRepair]);

  const generateGuide = async () => {
    if (!repair.trim()) {
      setError("Describe the job or complaint first.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ai-repair-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicle, repair: repair.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setGuide(data as RepairGuide);
    } catch (err: any) {
      setError(err?.message ?? "Could not generate the repair guide.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5 text-blue-600" />
            How To & Videos
          </DialogTitle>
        </DialogHeader>

        {!guide ? (
          <div className="space-y-4 pt-2">
            <div className="rounded-md border bg-muted/20 p-3 text-sm">
              <p className="font-medium">{vehicleLabel}</p>
              <p className="text-muted-foreground">
                Get practical steps, required tools, safety notes, and relevant YouTube searches.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repair-guide-job">Job or complaint</Label>
              <Input
                id="repair-guide-job"
                value={repair}
                onChange={(event) => setRepair(event.target.value)}
                placeholder="e.g. Replace front brake pads and rotors"
                onKeyDown={(event) => event.key === "Enter" && generateGuide()}
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={generateGuide} disabled={loading || !repair.trim()}>
                {loading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Building guide…</>
                ) : (
                  <><Lightbulb className="h-4 w-4" /> Generate guide</>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5 pt-2">
            <div className="rounded-md border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                <div>
                  <h3 className="font-semibold text-blue-900">{guide.title}</h3>
                  <p className="mt-1 text-sm text-blue-800">{guide.overview}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline" className="border-blue-300 bg-white text-blue-800">
                      {guide.difficulty}
                    </Badge>
                    <Badge variant="outline" className="border-blue-300 bg-white text-blue-800">
                      {guide.estimated_time}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <Wrench className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Tools and materials</h3>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {[...guide.tools, ...guide.parts].map((item, index) => (
                  <div key={`${item}-${index}`} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Procedure</h3>
              </div>
              <div className="space-y-3">
                {guide.steps.map((step) => (
                  <div key={`${step.step}-${step.title}`} className="flex gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
                      {step.step}
                    </div>
                    <div className="rounded-md border p-3 text-sm flex-1">
                      <p className="font-medium">{step.title}</p>
                      <p className="mt-1 text-muted-foreground">{step.details}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {guide.safety_notes.length > 0 && (
              <section className="rounded-md border border-amber-200 bg-amber-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-amber-900">
                  <ShieldAlert className="h-4 w-4" />
                  <h3 className="font-semibold text-sm">Safety and verification</h3>
                </div>
                <ul className="space-y-1 text-sm text-amber-900">
                  {guide.safety_notes.map((note, index) => <li key={index}>• {note}</li>)}
                </ul>
              </section>
            )}

            <section>
              <div className="mb-2 flex items-center gap-2">
                <PlayCircle className="h-4 w-4 text-red-600" />
                <h3 className="font-semibold text-sm">YouTube videos</h3>
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
                These open YouTube searches for this exact vehicle and job. Review the video before following it.
              </p>
              <div className="space-y-2">
                {guide.youtube_queries.slice(0, 3).map((query, index) => (
                  <a
                    key={`${query}-${index}`}
                    href={youtubeSearchUrl(query)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm transition-colors hover:bg-muted"
                  >
                    <span className="flex items-center gap-2">
                      <PlayCircle className="h-4 w-4 shrink-0 text-red-600" />
                      <span>{query}</span>
                    </span>
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </section>

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => setGuide(null)}>New guide</Button>
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}