import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useUpload } from "@workspace/object-storage-web";
import {
  ArrowLeft, ShoppingCart, Plus, Trash2, FileText,
  Upload, Eye, Package, Car, AlertCircle, X
} from "lucide-react";
import { useGetInventory } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const API = "/api/purchases";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  if (r.status === 204) return null;
  return r.json();
}

interface LineItem {
  itemType: "inventory" | "used_car" | "other";
  inventoryId?: number | null;
  usedCarId?: number | null;
  description: string;
  quantity: number;
  unitCost: number;
  notes?: string;
}

const emptyForm = {
  supplier: "",
  supplierContact: "",
  supplierEmail: "",
  supplierPhone: "",
  invoiceNumber: "",
  amount: "",
  tax: "",
  shipping: "",
  status: "pending",
  purchaseDate: new Date().toISOString().split("T")[0],
  notes: "",
};

const emptyLineItem: LineItem = { itemType: "other", description: "", quantity: 1, unitCost: 0 };

export default function PurchasesNew() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = Boolean(id);
  const [form, setForm] = useState(emptyForm);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [invoiceFile, setInvoiceFile] = useState<{ path: string; name: string; type: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: [API, id],
    queryFn: () => apiFetch(`${API}/${id}`),
    enabled: isEdit,
  });

  const { data: inventoryData } = useGetInventory({ limit: 200 });
  const inventoryItems = Array.isArray(inventoryData) ? inventoryData : inventoryData?.data || [];

  const { data: usedCarsData } = useQuery({
    queryKey: ["/api/used-cars"],
    queryFn: () => apiFetch("/api/used-cars"),
  });
  const usedCars = usedCarsData?.data || [];

  const { uploadFile, isUploading, progress } = useUpload({
    onSuccess: async (response) => {
      const file = fileInputRef.current?.files?.[0];
      if (!file) return;
      const fileMeta = { path: response.objectPath, name: file.name, type: file.type };
      setInvoiceFile(fileMeta);
      // If editing, patch immediately
      if (isEdit && id) {
        await apiFetch(`${API}/${id}/invoice`, {
          method: "PATCH",
          body: JSON.stringify({ invoiceFilePath: fileMeta.path, invoiceFileName: fileMeta.name, invoiceFileType: fileMeta.type }),
        });
        qc.invalidateQueries({ queryKey: [API, id] });
        toast({ title: "Invoice uploaded", description: "The invoice file has been attached to this purchase." });
      }
    },
  });

  useEffect(() => {
    if (existing) {
      setForm({
        supplier: existing.supplier || "",
        supplierContact: existing.supplierContact || "",
        supplierEmail: existing.supplierEmail || "",
        supplierPhone: existing.supplierPhone || "",
        invoiceNumber: existing.invoiceNumber || "",
        amount: existing.amount || "",
        tax: existing.tax || "",
        shipping: existing.shipping || "",
        status: existing.status || "pending",
        purchaseDate: existing.purchaseDate || "",
        notes: existing.notes || "",
      });
      if (existing.invoiceFilePath) {
        setInvoiceFile({ path: existing.invoiceFilePath, name: existing.invoiceFileName || "invoice", type: existing.invoiceFileType || "" });
      }
      if (existing.lineItems?.length > 0) {
        setLineItems(existing.lineItems.map((item: any) => ({
          itemType: item.itemType,
          inventoryId: item.inventoryId || null,
          usedCarId: item.usedCarId || null,
          description: item.description,
          quantity: Number(item.quantity),
          unitCost: Number(item.unitCost),
          notes: item.notes || "",
        })));
      }
    }
  }, [existing]);

  const save = useMutation({
    mutationFn: (data: any) =>
      isEdit
        ? apiFetch(`${API}/${id}`, { method: "PUT", body: JSON.stringify(data) })
        : apiFetch(API, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: [API] });
      toast({ title: isEdit ? "Purchase updated" : "Purchase created", description: isEdit ? "Changes saved." : "New purchase order created." });
      setLocation(`/purchases/${data.id}`);
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  function set(key: keyof typeof emptyForm, val: string) {
    setForm(p => ({ ...p, [key]: val }));
  }

  function setLI(index: number, key: keyof LineItem, val: any) {
    setLineItems(items => items.map((item, i) => i === index ? { ...item, [key]: val } : item));
  }

  function addLineItem() {
    setLineItems(items => [...items, { ...emptyLineItem }]);
  }

  function removeLineItem(index: number) {
    setLineItems(items => items.filter((_, i) => i !== index));
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "File too large", description: "Please upload files under 20MB.", variant: "destructive" });
      return;
    }
    await uploadFile(file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate({
      ...form,
      amount: Number(form.amount) || 0,
      tax: Number(form.tax) || 0,
      shipping: Number(form.shipping) || 0,
      lineItems,
      invoiceFilePath: invoiceFile?.path || null,
      invoiceFileName: invoiceFile?.name || null,
      invoiceFileType: invoiceFile?.type || null,
    });
  }

  // Calculate totals
  const subtotal = Number(form.amount) || 0;
  const tax = Number(form.tax) || 0;
  const shipping = Number(form.shipping) || 0;
  const total = subtotal + tax + shipping;
  const lineTotal = lineItems.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);

  const invoiceUrl = invoiceFile ? `/api/storage${invoiceFile.path}` : null;
  const isImage = invoiceFile?.type?.startsWith("image/");
  const isPdf = invoiceFile?.type === "application/pdf";

  if (isEdit && loadingExisting) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/purchases")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <ShoppingCart className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">{isEdit ? "Edit Purchase" : "New Purchase"}</h1>
            <p className="text-muted-foreground">Record a supplier purchase with invoice details and items.</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Supplier & Order Info */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Supplier & Order Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 md:col-span-2">
              <Label>Supplier Name *</Label>
              <Input required placeholder="NAPA Auto Parts" value={form.supplier} onChange={e => set("supplier", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Contact Name</Label>
              <Input placeholder="John Smith" value={form.supplierContact} onChange={e => set("supplierContact", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Invoice Number</Label>
              <Input placeholder="INV-2024-001" value={form.invoiceNumber} onChange={e => set("invoiceNumber", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Supplier Email</Label>
              <Input type="email" placeholder="orders@supplier.com" value={form.supplierEmail} onChange={e => set("supplierEmail", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Supplier Phone</Label>
              <Input placeholder="(555) 123-4567" value={form.supplierPhone} onChange={e => set("supplierPhone", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Purchase Date *</Label>
              <Input type="date" required value={form.purchaseDate} onChange={e => set("purchaseDate", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="received">Received</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="returned">Returned</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Costs */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cost Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Subtotal *</Label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-muted-foreground text-sm">$</span>
                <Input type="number" min="0" step="0.01" required placeholder="0.00" className="pl-7"
                  value={form.amount} onChange={e => set("amount", e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Tax</Label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-muted-foreground text-sm">$</span>
                <Input type="number" min="0" step="0.01" placeholder="0.00" className="pl-7"
                  value={form.tax} onChange={e => set("tax", e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Shipping</Label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-muted-foreground text-sm">$</span>
                <Input type="number" min="0" step="0.01" placeholder="0.00" className="pl-7"
                  value={form.shipping} onChange={e => set("shipping", e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Total</Label>
              <div className="h-10 flex items-center px-3 rounded-md border bg-muted/50 font-semibold">
                ${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Invoice Upload */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> Invoice Document
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {invoiceFile ? (
              <div className="flex items-start gap-4">
                <div className="flex-1 flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
                  <FileText className="h-8 w-8 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{invoiceFile.name}</p>
                    <p className="text-xs text-muted-foreground">{invoiceFile.type}</p>
                  </div>
                  <div className="flex gap-2">
                    {(isImage || isPdf) && (
                      <Button type="button" size="sm" variant="outline" onClick={() => setShowPreview(true)}>
                        <Eye className="h-3.5 w-3.5 mr-1" /> View
                      </Button>
                    )}
                    <a href={invoiceUrl!} target="_blank" rel="noopener noreferrer">
                      <Button type="button" size="sm" variant="outline">Download</Button>
                    </a>
                    <Button type="button" size="sm" variant="ghost" className="text-destructive"
                      onClick={() => setInvoiceFile(null)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="font-medium text-sm">Upload Invoice</p>
                <p className="text-xs text-muted-foreground mt-1">PDF or image (JPG, PNG) — max 20MB</p>
                {isUploading && (
                  <div className="mt-3">
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Uploading... {progress}%</p>
                  </div>
                )}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={handleFileChange}
            />
            {!invoiceFile && (
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                <Upload className="h-3.5 w-3.5 mr-2" />
                {isUploading ? `Uploading ${progress}%...` : "Choose File"}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Line Items */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Line Items</CardTitle>
              <Button type="button" size="sm" variant="outline" onClick={addLineItem}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {lineItems.length === 0 ? (
              <div className="text-center py-6 border-2 border-dashed border-border rounded-lg">
                <Package className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No items yet. Add line items to link purchases to inventory or used cars.</p>
                <Button type="button" size="sm" variant="outline" className="mt-3" onClick={addLineItem}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add First Item
                </Button>
              </div>
            ) : lineItems.map((item, index) => (
              <div key={index} className="border border-border rounded-lg p-4 space-y-3 bg-card">
                <div className="flex items-start gap-3">
                  <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Type</label>
                      <Select value={item.itemType} onValueChange={v => {
                        setLI(index, "itemType", v);
                        setLI(index, "inventoryId", null);
                        setLI(index, "usedCarId", null);
                      }}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inventory">Parts / Inventory</SelectItem>
                          <SelectItem value="used_car">Used Car</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {item.itemType === "inventory" && (
                      <div className="space-y-1 col-span-2">
                        <label className="text-xs font-medium text-muted-foreground">Link to Inventory Item</label>
                        <Select
                          value={item.inventoryId ? String(item.inventoryId) : "none"}
                          onValueChange={v => {
                            const inv = inventoryItems.find((i: any) => String(i.id) === v);
                            setLI(index, "inventoryId", v === "none" ? null : Number(v));
                            if (inv && !item.description) setLI(index, "description", inv.partName || inv.name || "");
                            if (inv && !item.unitCost) setLI(index, "unitCost", Number(inv.cost || 0));
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select part..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None (manual entry)</SelectItem>
                            {inventoryItems.map((inv: any) => (
                              <SelectItem key={inv.id} value={String(inv.id)}>
                                <span className="flex items-center gap-1">
                                  <Package className="h-3 w-3" /> {inv.partName || inv.name} {inv.partNumber ? `(${inv.partNumber})` : ""}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {item.itemType === "used_car" && (
                      <div className="space-y-1 col-span-2">
                        <label className="text-xs font-medium text-muted-foreground">Link to Used Car</label>
                        <Select
                          value={item.usedCarId ? String(item.usedCarId) : "none"}
                          onValueChange={v => {
                            const car = usedCars.find((c: any) => String(c.id) === v);
                            setLI(index, "usedCarId", v === "none" ? null : Number(v));
                            if (car && !item.description) setLI(index, "description", `${car.year} ${car.make} ${car.model}`);
                            if (car && !item.unitCost) setLI(index, "unitCost", Number(car.purchasePrice || 0));
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select vehicle..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None (manual entry)</SelectItem>
                            {usedCars.map((car: any) => (
                              <SelectItem key={car.id} value={String(car.id)}>
                                <span className="flex items-center gap-1">
                                  <Car className="h-3 w-3" /> {car.year} {car.make} {car.model}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="space-y-1" style={{ gridColumn: item.itemType !== "other" ? undefined : "span 3" }}>
                      <label className="text-xs font-medium text-muted-foreground">Description *</label>
                      <Input
                        required
                        placeholder="Item description..."
                        className="h-8 text-sm"
                        value={item.description}
                        onChange={e => setLI(index, "description", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Qty</label>
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        className="h-8 text-sm"
                        value={item.quantity}
                        onChange={e => setLI(index, "quantity", Number(e.target.value))}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Unit Cost</label>
                      <div className="relative">
                        <span className="absolute left-2 top-1.5 text-muted-foreground text-xs">$</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          className="h-8 text-sm pl-5"
                          value={item.unitCost}
                          onChange={e => setLI(index, "unitCost", Number(e.target.value))}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Line Total</label>
                      <div className="h-8 flex items-center px-2 text-sm font-semibold bg-muted/50 rounded-md border">
                        ${(item.quantity * item.unitCost).toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <Button type="button" size="icon" variant="ghost" className="text-destructive h-8 w-8 mt-5 flex-shrink-0"
                    onClick={() => removeLineItem(index)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}

            {lineItems.length > 0 && (
              <div className="flex justify-end">
                <div className="text-sm font-semibold text-muted-foreground">
                  Items total: <span className="text-foreground">${lineTotal.toFixed(2)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notes */}
        <Card className="border-border">
          <CardHeader className="pb-3"><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              placeholder="Delivery instructions, special notes, return policy..."
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
              rows={3}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 pb-6">
          <Button type="button" variant="outline" onClick={() => setLocation("/purchases")}>Cancel</Button>
          <Button type="submit" disabled={save.isPending || isUploading}>
            {save.isPending ? "Saving..." : isEdit ? "Save Changes" : "Create Purchase"}
          </Button>
        </div>
      </form>

      {/* Invoice Preview Modal */}
      {showPreview && invoiceUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowPreview(false)}
        >
          <div
            className="bg-background rounded-xl shadow-2xl overflow-hidden max-w-4xl w-full max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                <span className="font-medium text-sm">{invoiceFile?.name}</span>
              </div>
              <div className="flex gap-2">
                <a href={invoiceUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline">Open in new tab</Button>
                </a>
                <Button size="sm" variant="ghost" onClick={() => setShowPreview(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {isImage ? (
                <img src={invoiceUrl} alt="Invoice" className="max-w-full h-auto mx-auto block" />
              ) : isPdf ? (
                <iframe src={invoiceUrl} className="w-full h-full min-h-[600px]" title="Invoice PDF" />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
