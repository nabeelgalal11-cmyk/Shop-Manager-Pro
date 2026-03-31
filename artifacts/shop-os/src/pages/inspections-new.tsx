import { useLocation } from "wouter";
import { useCreateInspection, useGetVehicles, getGetVehiclesQueryKey } from "@workspace/api-client-react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

const itemSchema = z.object({
  label: z.string().min(1, "Required"),
  status: z.enum(["ok", "needs_attention", "urgent", "na"]).default("ok"),
  notes: z.string().optional(),
});

const formSchema = z.object({
  vehicleId: z.coerce.number().min(1, "Vehicle required"),
  type: z.string().min(1, "Type required"),
  overallCondition: z.enum(["good", "fair", "poor"]).default("good"),
  items: z.array(itemSchema).min(1, "Add at least one item"),
});

export default function InspectionsNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { data: vehicles } = useGetVehicles({ limit: 100 }, { query: { queryKey: getGetVehiclesQueryKey({ limit: 100 }) } });
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: "Multi-Point Inspection",
      overallCondition: "good",
      items: [
        { label: "Brakes", status: "ok" },
        { label: "Tires", status: "ok" },
        { label: "Fluids", status: "ok" },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  const createInspection = useCreateInspection();

  function onSubmit(values: z.infer<typeof formSchema>) {
    createInspection.mutate(
      { data: values },
      {
        onSuccess: (data) => {
          toast({ title: "Inspection created" });
          setLocation(`/inspections/${data.id}`);
        }
      }
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/inspections")}><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-3xl font-bold">New Inspection</h1>
      </div>
      <Card className="shadow-sm border-border">
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="vehicleId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vehicle</FormLabel>
                      <Select onValueChange={(val) => field.onChange(Number(val))} value={field.value ? String(field.value) : undefined}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select a vehicle" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {vehicles?.data?.map(v => <SelectItem key={v.id} value={String(v.id)}>{v.year} {v.make} {v.model}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField control={form.control} name="type" render={({ field }) => (
                  <FormItem><FormLabel>Inspection Type</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField
                  control={form.control}
                  name="overallCondition"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Overall Condition</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="good">Good</SelectItem>
                          <SelectItem value="fair">Fair</SelectItem>
                          <SelectItem value="poor">Poor</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-4 pt-4 border-t">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Checklist Items</h3>
                  <Button type="button" variant="outline" size="sm" onClick={() => append({ label: "", status: "ok" })}><Plus className="h-4 w-4 mr-2" /> Add Item</Button>
                </div>
                {fields.map((field, index) => (
                  <div key={field.id} className="flex items-start gap-4 p-4 border rounded-md">
                    <FormField control={form.control} name={`items.${index}.label`} render={({ field }) => (
                      <FormItem className="flex-1"><FormControl><Input placeholder="Item (e.g. Battery)" {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name={`items.${index}.status`} render={({ field }) => (
                      <FormItem className="w-[180px]">
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="ok">OK</SelectItem>
                            <SelectItem value="needs_attention">Needs Attention</SelectItem>
                            <SelectItem value="urgent">Urgent</SelectItem>
                            <SelectItem value="na">N/A</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                    <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={createInspection.isPending}>Save Inspection</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}