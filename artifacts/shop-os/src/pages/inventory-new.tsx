import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateInventoryItem, useGetInventory, getGetInventoryQueryKey } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Car } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { SupplierPicker } from "@/components/supplier-picker";

function localIsoDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const formSchema = z.object({
  partNumber: z.string().optional(),
  name: z.string().min(1, "Name is required"),
  // The custom-category input is stored separately from the select field.
  // Validate the final category in onSubmit so the form can submit when a
  // user chooses "Add new category".
  category: z.string(),
  costPrice: z.coerce.number().min(0, "Must be 0 or more"),
  sellPrice: z.coerce.number().min(0, "Must be 0 or more"),
  quantity: z.coerce.number().int("Must be a whole number").min(0, "Must be 0 or more"),
  minQuantity: z.coerce.number().int("Must be a whole number").min(0, "Must be 0 or more"),
  vendor: z.string().optional(),
  preferredSupplierId: z.number().nullable().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  compatibleVehicles: z.string().optional(),
  defaultWarrantyMonths: z.coerce.number().min(0).optional().nullable(),
  defaultWarrantyMiles: z.coerce.number().min(0).optional().nullable(),
});

const CUSTOM_KEY = "__custom__";

export default function InventoryNew() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [openingStockDate, setOpeningStockDate] = useState(localIsoDate);
  const [categoryMode, setCategoryMode] = useState<"select" | "custom">("select");
  const [customCategory, setCustomCategory] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: inventoryData } = useGetInventory(
    { limit: 200 },
    { query: { queryKey: getGetInventoryQueryKey({ limit: 200 }) } }
  );
  const allItems = Array.isArray(inventoryData) ? inventoryData : inventoryData?.data ?? [];
  const existingCategories = Array.from(new Set(allItems.map((i) => i.category).filter(Boolean))).sort();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      partNumber: "",
      category: "",
      costPrice: 0,
      sellPrice: 0,
      quantity: 0,
      minQuantity: 5,
      vendor: "",
      preferredSupplierId: null,
      location: "",
      notes: "",
      compatibleVehicles: "",
      defaultWarrantyMonths: null,
      defaultWarrantyMiles: null,
    },
  });

  const createItem = useCreateInventoryItem();

  function onSubmit(values: z.infer<typeof formSchema>) {
    setSaveError(null);
    const finalCategory = categoryMode === "custom" ? customCategory.trim() : values.category;
    if (!finalCategory) {
      toast({ title: "Category is required", variant: "destructive" });
      return;
    }
    createItem.mutate(
      { data: { ...values, category: finalCategory, ...(values.quantity > 0 ? { openingStockDate } : {}) } as any },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetInventoryQueryKey() });
          toast({ title: "Item added to inventory" });
          setLocation("/inventory");
        },
        onError: (error: any) => {
          const message = error?.status === 401
            ? "Your sign-in expired. Sign in again before adding inventory."
            : error?.status === 403
              ? "You don't have permission to add inventory items."
              : error?.data && typeof error.data === "object"
                ? error.data.error || error.data.message || "The inventory item could not be saved. Please try again."
                : "The inventory item could not be saved. Please try again.";
          setSaveError(message);
          toast({
            title: "Failed to add item",
            description: message,
            variant: "destructive",
          });
        },
      }
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/inventory")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Add Inventory Item</h1>
          <p className="text-sm text-muted-foreground">Add a new part or supply to stock.</p>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="bg-muted/20 border-b pb-3">
          <CardTitle className="text-base">Item Details</CardTitle>
        </CardHeader>
        <CardContent className="pt-5">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Part Name <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Premium Front Brake Pads" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="partNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Part Number</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. BRK-PAD-FRT" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="vendor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vendor / Supplier</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. AutoZone" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium">
                  Category <span className="text-destructive">*</span>
                </Label>
                {categoryMode === "select" ? (
                  <div className="flex gap-2">
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <Select
                            value={field.value}
                            onValueChange={(val) => {
                              if (val === CUSTOM_KEY) {
                                setCategoryMode("custom");
                                field.onChange("");
                              } else {
                                field.onChange(val);
                              }
                            }}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select a category..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {existingCategories.map((cat) => (
                                <SelectItem key={cat} value={cat}>
                                  {cat}
                                </SelectItem>
                              ))}
                              <SelectItem value={CUSTOM_KEY}>
                                <span className="flex items-center gap-1.5 text-primary">
                                  <Plus className="h-3.5 w-3.5" /> Add new category...
                                </span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      autoFocus
                      placeholder="Type new category name..."
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setCategoryMode("select");
                        setCustomCategory("");
                        form.setValue("category", "");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
                {categoryMode === "custom" && !customCategory.trim() && (
                  <p className="text-xs text-destructive">Category name is required</p>
                )}
              </div>

              <Separator />

              <FormField
                control={form.control}
                name="preferredSupplierId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Preferred Supplier</FormLabel>
                    <FormControl>
                      <SupplierPicker
                        value={field.value ?? null}
                        onChange={(id) => field.onChange(id)}
                        allowClear
                        placeholder="Select or create supplier..."
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Used to group items in the reorder report.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              {/* Vehicle Compatibility */}
              <FormField
                control={form.control}
                name="compatibleVehicles"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      <Car className="h-4 w-4" /> Compatible Vehicles
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={`e.g. Honda Accord 2015-2022, Toyota Camry 2016-2021, Ford F-150 2018+\n\nLeave blank if fits all vehicles (universal part).`}
                        className="resize-none min-h-[80px]"
                        {...field}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Used to surface this part when working on matching vehicles. Separate makes/models with commas.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <FormField
                  control={form.control}
                  name="costPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cost Price ($)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sellPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sell Price ($)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Opening Quantity</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="minQuantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Low Stock Alert</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-md">
                    <p className="text-sm font-semibold">Opening stock date</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      A positive opening quantity is recorded as an opening-balance movement on this date, not as a supplier purchase. Leave quantity at zero if the item has not arrived yet.
                    </p>
                  </div>
                  <div className="w-full sm:w-52">
                    <Label htmlFor="opening-stock-date" className="text-xs">Effective date</Label>
                     <Input id="opening-stock-date" type="date" value={openingStockDate} onChange={(event) => setOpeningStockDate(event.target.value)} className="mt-1.5" required={Number(form.watch("quantity") ?? 0) > 0} data-testid="input-opening-stock-date" />
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <p className="text-sm font-medium mb-2">Default Warranty (optional)</p>
                <p className="text-xs text-muted-foreground mb-3">
                  Auto-applied as the default warranty whenever this part is added to a repair order or invoice. Leave blank for no warranty.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="defaultWarrantyMonths"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Months</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" placeholder="e.g. 12"
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="defaultWarrantyMiles"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Miles</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" placeholder="e.g. 12000"
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Storage Location</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Shelf A2, Bin 14" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Input placeholder="Any additional notes..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setLocation("/inventory")}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createItem.isPending}>
                  {createItem.isPending ? "Saving..." : "Add to Inventory"}
                </Button>
              </div>
              {saveError && (
                <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {saveError}
                </p>
              )}
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
