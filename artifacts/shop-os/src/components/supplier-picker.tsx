import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";

type Supplier = { id: number; name: string; contactEmail?: string | null; contactPhone?: string | null };

async function fetchSuppliers(search = ""): Promise<Supplier[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  const r = await fetch(`/api/suppliers?${params}`);
  if (!r.ok) return [];
  const j = await r.json();
  return j.data || [];
}

export function SupplierPicker({
  value,
  onChange,
  placeholder = "Select or create supplier...",
  allowClear = false,
}: {
  value: number | null;
  onChange: (id: number | null, supplier?: Supplier) => void;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Supplier[]>([]);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSuppliers().then(setItems);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) => s.name.toLowerCase().includes(q));
  }, [items, query]);

  const selected = items.find((s) => s.id === value);
  const exactMatch = filtered.some((s) => s.name.toLowerCase() === query.trim().toLowerCase());

  async function createSupplier() {
    const name = query.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const r = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error(await r.text());
      const created: Supplier = await r.json();
      setItems((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);
      onChange(created.id, created);
      setOpen(false);
      setQuery("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted/50"
      >
        <span className={selected ? "" : "text-muted-foreground"}>
          {selected ? selected.name : placeholder}
        </span>
        <div className="flex items-center gap-1">
          {allowClear && selected && (
            <X
              className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
            />
          )}
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
        </div>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg">
          <div className="p-2 border-b">
            <Input
              autoFocus
              placeholder="Search or type a new supplier name..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered.length === 1) {
                    onChange(filtered[0].id, filtered[0]);
                    setOpen(false);
                    setQuery("");
                  } else if (!exactMatch && query.trim()) {
                    void createSupplier();
                  }
                }
              }}
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onChange(s.id, s);
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted text-left"
              >
                <span>{s.name}</span>
                {s.id === value && <Check className="h-4 w-4 text-primary" />}
              </button>
            ))}
            {filtered.length === 0 && !query.trim() && (
              <div className="px-3 py-2 text-sm text-muted-foreground">No suppliers yet.</div>
            )}
            {query.trim() && !exactMatch && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={creating}
                onClick={createSupplier}
                className="w-full justify-start mt-1"
              >
                <Plus className="h-3.5 w-3.5 mr-2" />
                Create "{query.trim()}"
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
