import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInventoryItem, getGetInventoryItemQueryKey,
  useUpdateInventoryItem, useDeleteInventoryItem,
  useGetInventory, getGetInventoryQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Edit2, Save, X, Trash2, Car, Package, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CUSTOM_KEY = "__custom__";

export default function InventoryDetail() {
  const [match, params] = useRoute("/inventory/:id");
  const id = match ? parseInt(params.id) : 0;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: item, isLoading } = useGetInventoryItem(id, {
    query: { enabled: !!id, queryKey: getGetInventoryItemQueryKey(id) },
  });

  const { data: inventoryData } = useGetInventory(
    { limit: 200 },
    { query: { queryKey: getGetInventoryQueryKey({ limit: 200 }) } }
  );
  const allItems = Array.isArray(inventoryData) ? inventoryData : inventoryData?.data ?? [];
  const existingCategories = Array.from(new Set(allItems.map((i) => i.category).filter(Boolean))).sort();

  const updateItem = useUpdateInventoryItem();
  const deleteItem = useDeleteInventoryItem();

  const [editing, setEditing] = useState(false);
  const [categoryMode, setCategoryMode] = useState<"select" | "custom">("select");
  const [customCategory, setCustomCategory] = useState("");
  const [form, setForm] = useState<Record<string, any>>({});

  const startEdit = () => {
    if (!item) return;
    setForm({
      name: item.name,
      partNumber: item.partNumber ?? "",
      category: item.category,
      vendor: item.vendor ?? "",
      costPrice: item.costPrice,
      sellPrice: item.sellPrice,
      quantity: item.quantity,
      minQuantity: item.minQuantity,
      location: item.location ?? "",
      notes: item.notes ?? "",
      compatibleVehicles: (item as any).compatibleVehicles ?? "",
    });
    setCategoryMode("select");
    setCustomCategory("");
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setForm({});
  };

  const saveEdit = () => {
    const finalCategory = categoryMode === "custom" ? customCategory.trim() : form.category;
    if (!finalCategory) {
      toast({ title: "Category is required", variant: "destructive" });
      return;
    }
    updateItem.mutate(
      { id, data: { ...form, category: finalCategory, costPrice: Number(form.costPrice), sellPrice: Number(form.sellPrice) } as any },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetInventoryItemQueryKey(id) });
          toast({ title: "Item updated" });
          setEditing(false);
        },
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      }
    );
  };

  const handleDelete = () => {
    deleteItem.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Item deleted" });
        setLocation("/inventory");
      },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    });
  };

  const set = (field: string, value: any) => setForm(f => ({ ...f, [field]: value }));

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!item) {
    return <div className="p-8 text-center text-muted-foreground">Inventory item not found.</div>;
  }

  const isLowStock = item.quantity <= item.minQuantity;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/inventory")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{item.name}</h1>
            {item.partNumber && (
              <p className="text-muted-foreground text-sm font-mono">{item.partNumber}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!editing ? (
            <>
              <Button variant="outline" onClick={startEdit}>
                <Edit2 className="h-4 w-4 mr-2" /> Edit
              </Button>
              <Button variant="destructive" size="icon" onClick={handleDelete} disabled={deleteItem.isPending}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={cancelEdit}>
                <X className="h-4 w-4 mr-2" /> Cancel
              </Button>
              <Button onClick={saveEdit} disabled={updateItem.isPending}>
                <Save className="h-4 w-4 mr-2" />
                {updateItem.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">

          {/* Item Details */}
          <Card>
            <CardHeader className="bg-muted/20 border-b pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" /> Part Details
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5 space-y-4">
              {editing ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Part Name <span className="text-destructive">*</span></Label>
                    <Input value={form.name} onChange={e => set("name", e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Part Number</Label>
                      <Input placeholder="e.g. BRK-PAD-FRT" value={form.partNumber} onChange={e => set("partNumber", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Vendor / Supplier</Label>
                      <Input placeholder="e.g. AutoZone" value={form.vendor} onChange={e => set("vendor", e.target.value)} />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Category <span className="text-destructive">*</span></Label>
                    {categoryMode === "select" ? (
                      <Select
                        value={form.category}
                        onValueChange={val => {
                          if (val === CUSTOM_KEY) { setCategoryMode("custom"); set("category", ""); }
                          else set("category", val);
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Select a category..." /></SelectTrigger>
                        <SelectContent>
                          {existingCategories.map(cat => (
                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                          ))}
                          <SelectItem value={CUSTOM_KEY}>
                            <span className="flex items-center gap-1.5 text-primary">
                              <Plus className="h-3.5 w-3.5" /> Add new category...
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="flex gap-2">
                        <Input
                          autoFocus
                          placeholder="Type new category name..."
                          value={customCategory}
                          onChange={e => setCustomCategory(e.target.value)}
                          className="flex-1"
                        />
                        <Button type="button" variant="outline" onClick={() => { setCategoryMode("select"); setCustomCategory(""); }}>
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label>Notes</Label>
                    <Input placeholder="Any additional notes..." value={form.notes} onChange={e => set("notes", e.target.value)} />
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                  <div>
                    <p className="text-muted-foreground mb-1">Category</p>
                    <p className="font-medium">{item.category}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Vendor</p>
                    <p className="font-medium">{item.vendor || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Part Number</p>
                    <p className="font-mono font-medium">{item.partNumber || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Location</p>
                    <p className="font-medium">{item.location || "—"}</p>
                  </div>
                  {item.notes && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground mb-1">Notes</p>
                      <p className="font-medium">{item.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Compatible Vehicles */}
          <Card>
            <CardHeader className="bg-muted/20 border-b pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Car className="h-4 w-4" /> Compatible Vehicles
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              {editing ? (
                <div className="space-y-1.5">
                  <Textarea
                    placeholder={`e.g. Honda Accord 2015-2022, Toyota Camry 2016-2021, Ford F-150 2018+\n\nLeave blank if fits all vehicles (universal part).`}
                    className="resize-none min-h-[90px]"
                    value={form.compatibleVehicles}
                    onChange={e => set("compatibleVehicles", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Separate makes/models with commas. Leave blank for universal parts.
                  </p>
                </div>
              ) : (item as any).compatibleVehicles ? (
                <div className="flex flex-wrap gap-2">
                  {((item as any).compatibleVehicles as string)
                    .split(",")
                    .map((v: string) => v.trim())
                    .filter(Boolean)
                    .map((v: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-sm gap-1">
                        <Car className="h-3 w-3" /> {v}
                      </Badge>
                    ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Universal — fits all vehicles. Edit to restrict to specific makes/models.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Pricing & Stock (edit mode) */}
          {editing && (
            <Card>
              <CardHeader className="bg-muted/20 border-b pb-3">
                <CardTitle className="text-base">Pricing & Stock</CardTitle>
              </CardHeader>
              <CardContent className="pt-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Cost Price ($)</Label>
                    <Input type="number" step="0.01" min="0" value={form.costPrice} onChange={e => set("costPrice", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Sell Price ($)</Label>
                    <Input type="number" step="0.01" min="0" value={form.sellPrice} onChange={e => set("sellPrice", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Current Stock</Label>
                    <Input type="number" min="0" value={form.quantity} onChange={e => set("quantity", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Low Stock Alert</Label>
                    <Input type="number" min="0" value={form.minQuantity} onChange={e => set("minQuantity", e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Storage Location</Label>
                  <Input placeholder="e.g. Shelf A2, Bin 14" value={form.location} onChange={e => set("location", e.target.value)} />
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="bg-muted/20 border-b pb-3">
              <CardTitle className="text-base">Stock</CardTitle>
            </CardHeader>
            <CardContent className="pt-5 space-y-4 text-sm">
              <div className="text-center py-3">
                <p className={`text-4xl font-bold ${isLowStock ? "text-destructive" : "text-foreground"}`}>
                  {item.quantity}
                </p>
                <p className="text-muted-foreground text-xs mt-1">units in stock</p>
                {isLowStock && (
                  <Badge variant="destructive" className="mt-2">Low Stock</Badge>
                )}
              </div>
              <Separator />
              <div>
                <p className="text-muted-foreground mb-1">Low Stock Alert</p>
                <p className="font-medium">Below {item.minQuantity} units</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">Storage Location</p>
                <p className="font-medium">{item.location || "—"}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="bg-muted/20 border-b pb-3">
              <CardTitle className="text-base">Pricing</CardTitle>
            </CardHeader>
            <CardContent className="pt-5 space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground mb-1">Sell Price</p>
                <p className="text-2xl font-bold">${Number(item.sellPrice).toFixed(2)}</p>
              </div>
              <Separator />
              <div>
                <p className="text-muted-foreground mb-1">Cost Price</p>
                <p className="font-medium">${Number(item.costPrice).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">Margin</p>
                <p className="font-medium text-green-600">
                  ${(Number(item.sellPrice) - Number(item.costPrice)).toFixed(2)}
                  {Number(item.costPrice) > 0 && (
                    <span className="text-xs text-muted-foreground ml-1">
                      ({Math.round(((Number(item.sellPrice) - Number(item.costPrice)) / Number(item.costPrice)) * 100)}%)
                    </span>
                  )}
                </p>
              </div>
              <Separator />
              <div>
                <p className="text-muted-foreground mb-1">Stock Value</p>
                <p className="font-semibold">${(item.quantity * Number(item.sellPrice)).toFixed(2)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 text-xs text-muted-foreground space-y-1">
              <p>Added {new Date(item.createdAt).toLocaleDateString()}</p>
              <p>Updated {new Date(item.updatedAt).toLocaleDateString()}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
