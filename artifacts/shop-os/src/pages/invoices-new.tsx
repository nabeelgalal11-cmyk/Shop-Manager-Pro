import { useLocation } from "wouter";
import { useCreateInvoice, useGetCustomers, getGetCustomersQueryKey, useGetVehicles, getGetVehiclesQueryKey } from "@workspace/api-client-react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Plus, Trash2 } from "lucide-react";

const lineItemSchema = z.object({
  type: z.enum(["labor", "part", "fee", "discount"]),
  description: z.string().min(1, "Required"),
  quantity: z.coerce.number().min(1),
  unitPrice: z.coerce.number().min(0),
});

const formSchema = z.object({
  customerId: z.coerce.number().min(1, "Customer is required"),
  vehicleId: z.coerce.number().optional(),
  status: z.enum(["draft", "sent", "paid", "overdue", "void"]).default("draft"),
  notes: z.string().optional(),
  taxRate: z.coerce.number().min(0).default(0),
  discountAmount: z.coerce.number().min(0).default(0),
  dueDate: z.string().optional(),
  lineItems: z.array(lineItemSchema).min(1, "At least one line item is required"),
});

export default function InvoicesNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { data: customers } = useGetCustomers({ limit: 100 }, { query: { queryKey: getGetCustomersQueryKey({ limit: 100 }) } });
  const { data: vehicles } = useGetVehicles({ limit: 100 }, { query: { queryKey: getGetVehiclesQueryKey({ limit: 100 }) } });
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customerId: 0,
      status: "draft",
      taxRate: 8.5,
      discountAmount: 0,
      lineItems: [{ type: "labor", description: "", quantity: 1, unitPrice: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lineItems",
  });

  const createInvoice = useCreateInvoice();

  function onSubmit(values: z.infer<typeof formSchema>) {
    createInvoice.mutate(
      { data: values },
      {
        onSuccess: (data) => {
          toast({ title: "Invoice created" });
          setLocation(`/invoices/${data.id}`);
        },
        onError: () => {
          toast({ title: "Error", variant: "destructive" });
        }
      }
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/invoices")}><ArrowLeft className="h-5 w-5" /></Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">New Invoice</h1>
        </div>
      </div>
      <Card className="shadow-sm border-border">
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="customerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer</FormLabel>
                      <Select onValueChange={(val) => field.onChange(Number(val))} value={field.value ? String(field.value) : undefined}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select a customer" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {customers?.data?.map(c => (
                            <SelectItem key={c.id} value={String(c.id)}>{c.firstName} {c.lastName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="vehicleId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vehicle (Optional)</FormLabel>
                      <Select onValueChange={(val) => field.onChange(Number(val))} value={field.value ? String(field.value) : undefined}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select a vehicle" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {vehicles?.data?.map(v => (
                            <SelectItem key={v.id} value={String(v.id)}>{v.year} {v.make} {v.model}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Line Items</h3>
                  <Button type="button" variant="outline" size="sm" onClick={() => append({ type: "part", description: "", quantity: 1, unitPrice: 0 })}>
                    <Plus className="h-4 w-4 mr-2" /> Add Item
                  </Button>
                </div>
                {fields.map((field, index) => (
                  <div key={field.id} className="flex items-start gap-4 p-4 border rounded-md bg-muted/20">
                    <FormField
                      control={form.control}
                      name={`lineItems.${index}.type`}
                      render={({ field }) => (
                        <FormItem className="w-[150px]">
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="labor">Labor</SelectItem>
                              <SelectItem value="part">Part</SelectItem>
                              <SelectItem value="fee">Fee</SelectItem>
                              <SelectItem value="discount">Discount</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`lineItems.${index}.description`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl><Input placeholder="Description" {...field} /></FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`lineItems.${index}.quantity`}
                      render={({ field }) => (
                        <FormItem className="w-[100px]">
                          <FormControl><Input type="number" placeholder="Qty" {...field} /></FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`lineItems.${index}.unitPrice`}
                      render={({ field }) => (
                        <FormItem className="w-[120px]">
                          <FormControl><Input type="number" placeholder="Price" {...field} /></FormControl>
                        </FormItem>
                      )}
                    />
                    <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField control={form.control} name="taxRate" render={({ field }) => (
                  <FormItem><FormLabel>Tax Rate (%)</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="discountAmount" render={({ field }) => (
                  <FormItem><FormLabel>Discount Amount ($)</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl></FormItem>
                )} />
              </div>

              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={createInvoice.isPending}>Save Invoice</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}