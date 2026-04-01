import { useState } from "react";
import { useLocation } from "wouter";
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

const formSchema = z.object({
  partNumber: z.string().optional(),
  name: z.string().min(1, "Name is required"),
  category: z.string().min(1, "Category is required"),
  costPrice: z.coerce.number().min(0, "Must be 0 or more"),
  sellPrice: z.coerce.number().min(0, "Must be 0 or more"),
  quantity: z.coerce.number().min(0, "Must be 0 or more"),
  minQuantity: z.coerce.number().min(0, "Must be 0 or more"),
  vendor: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  compatibleVehicles: z.string().optional(),
});

const CUSTOM_KEY = "__custom__";

export default function InventoryNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [categoryMode, setCategoryMode] = useState<"select" | "custom">("select");
  const [customCategory, setCustomCategory] = useState("");

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
      location: "",
      notes: "",
      compatibleVehicles: "",
    },
  });

  const createItem = useCreateInventoryItem();

  function onSubmit(values: z.infer<typeof formSchema>) {
    const finalCategory = categoryMode === "custom" ? customCategory.trim() : values.category;
    if (!finalCategory) {
      toast({ title: "Category is required", variant: "destructive" });
      return;
    }
    createItem.mutate(
      { data: { ...values, category: finalCategory } as any },
      {
        onSuccess: () => {
          toast({ title: "Item added to inventory" });
          setLocation("/inventory");
        },
        onError: () => {
          toast({ title: "Failed to add item", variant: "destructive" });
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
                      <FormLabel>Current Stock</FormLabel>
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
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
