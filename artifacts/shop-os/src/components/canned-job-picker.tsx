import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Wrench } from "lucide-react";

export type CannedJobItem = { type: "labor" | "part" | "fee" | "discount"; description: string; quantity: number; unitPrice: number; warrantyMonths?: number | null; warrantyMiles?: number | null };
export type CannedJob = { id: number; name: string; category?: string | null; description?: string | null; estimatedHours?: string | null; items: CannedJobItem[] };

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (job: CannedJob) => void;
}

export function CannedJobPicker({ open, onClose, onPick }: Props) {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useQuery<CannedJob[]>({
    queryKey: ["/api/canned-jobs", search],
    queryFn: async () => {
      const r = await fetch(`/api/canned-jobs${search ? `?search=${encodeURIComponent(search)}` : ""}`);
      if (!r.ok) throw new Error("Load failed");
      return r.json();
    },
    enabled: open,
  });

  const items = data || [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" /> Pick a Canned Job</DialogTitle>
        </DialogHeader>
        <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        <div className="space-y-2 mt-2">
          {isLoading ? (
            <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No canned jobs found. Create some on the Canned Jobs page first.</div>
          ) : items.map((j) => {
            const total = (j.items || []).reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0) * (it.type === "discount" ? -1 : 1), 0);
            return (
              <button key={j.id} type="button" onClick={() => { onPick(j); onClose(); }} className="w-full text-left p-3 border rounded-md hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1">
                    <p className="font-medium">{j.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {j.category ? `${j.category} · ` : ""}
                      {j.items?.length || 0} item{j.items?.length === 1 ? "" : "s"}
                      {j.estimatedHours ? ` · ${j.estimatedHours} hrs` : ""}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">${total.toFixed(2)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
