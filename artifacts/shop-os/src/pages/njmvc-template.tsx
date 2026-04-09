import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Settings2, Plus, Trash2, ChevronDown, ChevronRight,
  GripVertical, ClipboardCheck, Save, X, Check, Edit2
} from "lucide-react";

const TEMPLATE_API = "/api/njmvc/template";
const CAT_API = "/api/njmvc/categories";
const ITEM_API = "/api/njmvc/items";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  if (r.status === 204) return null;
  return r.json();
}

function EditableText({ value, onSave, className = "" }: { value: string; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <div className="flex items-center gap-1 flex-1">
        <Input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          className={`h-7 text-sm ${className}`}
          onKeyDown={e => {
            if (e.key === "Enter") { onSave(draft); setEditing(false); }
            if (e.key === "Escape") { setDraft(value); setEditing(false); }
          }}
        />
        <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" onClick={() => { onSave(draft); setEditing(false); }}>
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setDraft(value); setEditing(false); }}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <button type="button" className={`text-left flex-1 hover:text-primary group flex items-center gap-1 ${className}`} onClick={() => setEditing(true)}>
      <span>{value}</span>
      <Edit2 className="h-3 w-3 opacity-0 group-hover:opacity-50 flex-shrink-0" />
    </button>
  );
}

export default function NjmvcTemplate() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expandedCats, setExpandedCats] = useState<Set<number>>(new Set());
  const [newCatName, setNewCatName] = useState("");
  const [addingCat, setAddingCat] = useState(false);
  const [addingItemForCat, setAddingItemForCat] = useState<number | null>(null);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [newItemMeasurement, setNewItemMeasurement] = useState(false);
  const [newItemUnit, setNewItemUnit] = useState("mm");

  const { data: template, isLoading } = useQuery<any[]>({
    queryKey: [TEMPLATE_API],
    queryFn: () => apiFetch(TEMPLATE_API),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: [TEMPLATE_API] });
  }

  // Categories
  const createCat = useMutation({
    mutationFn: (name: string) => apiFetch(CAT_API, { method: "POST", body: JSON.stringify({ name, sortOrder: (template?.length || 0) }) }),
    onSuccess: () => { invalidate(); setNewCatName(""); setAddingCat(false); toast({ title: "Category added" }); },
  });

  const updateCat = useMutation({
    mutationFn: ({ id, data }: any) => apiFetch(`${CAT_API}/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: invalidate,
  });

  const deleteCat = useMutation({
    mutationFn: (id: number) => apiFetch(`${CAT_API}/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: "Category deleted" }); },
  });

  // Items
  const createItem = useMutation({
    mutationFn: (data: any) => apiFetch(ITEM_API, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      invalidate();
      setNewItemLabel("");
      setNewItemMeasurement(false);
      setNewItemUnit("mm");
      setAddingItemForCat(null);
      toast({ title: "Item added" });
    },
  });

  const updateItem = useMutation({
    mutationFn: ({ id, data }: any) => apiFetch(`${ITEM_API}/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: invalidate,
  });

  const deleteItem = useMutation({
    mutationFn: (id: number) => apiFetch(`${ITEM_API}/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: "Item deleted" }); },
  });

  function moveCat(cat: any, dir: -1 | 1) {
    const sorted = [...(template || [])].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex(c => c.id === cat.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const swap = sorted[swapIdx];
    updateCat.mutate({ id: cat.id, data: { ...cat, sortOrder: swap.sortOrder } });
    updateCat.mutate({ id: swap.id, data: { ...swap, sortOrder: cat.sortOrder } });
  }

  function moveItem(item: any, catItems: any[], dir: -1 | 1) {
    const sorted = [...catItems].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex(i => i.id === item.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const swap = sorted[swapIdx];
    updateItem.mutate({ id: item.id, data: { ...item, sortOrder: swap.sortOrder } });
    updateItem.mutate({ id: swap.id, data: { ...swap, sortOrder: item.sortOrder } });
  }

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading template...</div>;
  }

  const sorted = [...(template || [])].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Settings2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">NJMVC Template Editor</h1>
            <p className="text-muted-foreground">Edit inspection categories and items used in all quarterly inspections.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{sorted.length} categories</Badge>
          <Badge variant="secondary">{sorted.reduce((n, c) => n + (c.items?.length || 0), 0)} items</Badge>
        </div>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
        <ClipboardCheck className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <span>Changes here affect all <strong>new</strong> inspections. Existing inspection records are not modified.</span>
      </div>

      {/* Categories */}
      <div className="space-y-2">
        {sorted.map((cat, catIdx) => {
          const sortedItems = [...(cat.items || [])].sort((a, b) => a.sortOrder - b.sortOrder);
          const isExpanded = expandedCats.has(cat.id);
          const isAddingItem = addingItemForCat === cat.id;

          return (
            <Card key={cat.id} className={`border-border transition-opacity ${!cat.active ? "opacity-50" : ""}`}>
              {/* Category Header */}
              <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/30">
                <div className="flex flex-col gap-0.5">
                  <Button size="icon" variant="ghost" className="h-4 w-4" disabled={catIdx === 0} onClick={() => moveCat(cat, -1)}>▲</Button>
                  <Button size="icon" variant="ghost" className="h-4 w-4" disabled={catIdx === sorted.length - 1} onClick={() => moveCat(cat, 1)}>▼</Button>
                </div>
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <button type="button" className="flex items-center gap-1" onClick={() => setExpandedCats(s => { const n = new Set(s); n.has(cat.id) ? n.delete(cat.id) : n.add(cat.id); return n; })}>
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </button>
                <EditableText
                  value={cat.name}
                  onSave={name => updateCat.mutate({ id: cat.id, data: { ...cat, name } })}
                  className="font-semibold text-sm"
                />
                <Badge variant="outline" className="text-xs ml-auto">{sortedItems.length} items</Badge>
                <div className="flex items-center gap-1.5 ml-2">
                  <span className="text-xs text-muted-foreground">{cat.active ? "Active" : "Inactive"}</span>
                  <Switch
                    checked={cat.active}
                    onCheckedChange={active => updateCat.mutate({ id: cat.id, data: { ...cat, active } })}
                  />
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive ml-1"
                  onClick={() => confirm(`Delete category "${cat.name}" and all its items?`) && deleteCat.mutate(cat.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Items */}
              {isExpanded && (
                <div className="divide-y divide-border">
                  {sortedItems.map((item, itemIdx) => (
                    <div key={item.id} className={`flex items-center gap-2 px-4 py-2 hover:bg-muted/10 ${!item.active ? "opacity-50" : ""}`}>
                      <div className="flex flex-col gap-0.5">
                        <Button size="icon" variant="ghost" className="h-4 w-4" disabled={itemIdx === 0} onClick={() => moveItem(item, sortedItems, -1)}>▲</Button>
                        <Button size="icon" variant="ghost" className="h-4 w-4" disabled={itemIdx === sortedItems.length - 1} onClick={() => moveItem(item, sortedItems, 1)}>▼</Button>
                      </div>
                      <EditableText
                        value={item.label}
                        onSave={label => updateItem.mutate({ id: item.id, data: { ...item, label } })}
                        className="text-sm flex-1"
                      />

                      {/* Measurement toggle */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Measurement:</span>
                        <Switch
                          checked={item.hasMeasurement}
                          onCheckedChange={hasMeasurement => updateItem.mutate({ id: item.id, data: { ...item, hasMeasurement } })}
                        />
                        {item.hasMeasurement && (
                          <Select
                            value={item.measurementUnit || "mm"}
                            onValueChange={measurementUnit => updateItem.mutate({ id: item.id, data: { ...item, measurementUnit } })}
                          >
                            <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="mm">mm</SelectItem>
                              <SelectItem value="/32&quot;">/32"</SelectItem>
                              <SelectItem value="in">in</SelectItem>
                              <SelectItem value="psi">psi</SelectItem>
                              <SelectItem value="%">%</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={item.active}
                          onCheckedChange={active => updateItem.mutate({ id: item.id, data: { ...item, active } })}
                        />
                      </div>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => confirm(`Delete item "${item.label}"?`) && deleteItem.mutate(item.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}

                  {/* Add Item Form */}
                  {isAddingItem ? (
                    <div className="px-4 py-3 bg-muted/20 space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          autoFocus
                          placeholder="Item label (e.g. a. Service Brakes)"
                          value={newItemLabel}
                          onChange={e => setNewItemLabel(e.target.value)}
                          className="h-8 text-sm"
                          onKeyDown={e => e.key === "Enter" && newItemLabel.trim() && createItem.mutate({
                            categoryId: cat.id, label: newItemLabel.trim(),
                            hasMeasurement: newItemMeasurement, measurementUnit: newItemMeasurement ? newItemUnit : null,
                            sortOrder: sortedItems.length,
                          })}
                        />
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-xs">Measurement</span>
                          <Switch checked={newItemMeasurement} onCheckedChange={setNewItemMeasurement} />
                          {newItemMeasurement && (
                            <Select value={newItemUnit} onValueChange={setNewItemUnit}>
                              <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="mm">mm</SelectItem>
                                <SelectItem value='/32"'>/32"</SelectItem>
                                <SelectItem value="in">in</SelectItem>
                                <SelectItem value="psi">psi</SelectItem>
                                <SelectItem value="%">%</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" disabled={!newItemLabel.trim() || createItem.isPending}
                          onClick={() => createItem.mutate({
                            categoryId: cat.id, label: newItemLabel.trim(),
                            hasMeasurement: newItemMeasurement, measurementUnit: newItemMeasurement ? newItemUnit : null,
                            sortOrder: sortedItems.length,
                          })}>
                          <Save className="h-3.5 w-3.5 mr-1" /> Add Item
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setAddingItemForCat(null); setNewItemLabel(""); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="px-4 py-2">
                      <Button size="sm" variant="ghost" className="text-xs h-7"
                        onClick={() => { setAddingItemForCat(cat.id); setExpandedCats(s => new Set(s).add(cat.id)); }}>
                        <Plus className="h-3 w-3 mr-1" /> Add item to {cat.name}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Add Category */}
      {addingCat ? (
        <Card className="border-dashed border-2 border-primary/30">
          <CardContent className="pt-4 pb-3 space-y-3">
            <Input
              autoFocus
              placeholder="New category name (e.g. Brake System)"
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && newCatName.trim() && createCat.mutate(newCatName.trim())}
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={!newCatName.trim() || createCat.isPending} onClick={() => createCat.mutate(newCatName.trim())}>
                <Save className="h-3.5 w-3.5 mr-1" /> Add Category
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setAddingCat(false); setNewCatName(""); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" className="w-full border-dashed" onClick={() => setAddingCat(true)}>
          <Plus className="h-4 w-4 mr-2" /> Add Category
        </Button>
      )}
    </div>
  );
}
