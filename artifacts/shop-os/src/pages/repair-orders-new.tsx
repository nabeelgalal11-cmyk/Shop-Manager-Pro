import { useLocation } from "wouter";
import { useCreateRepairOrder, useGetCustomers, getGetCustomersQueryKey, useGetVehicles, getGetVehiclesQueryKey, useGetEmployees, getGetEmployeesQueryKey } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

const formSchema = z.object({
  customerId: z.coerce.number().min(1, "Customer is required"),
  vehicleId: z.coerce.number().min(1, "Vehicle is required"),
  assignedToId: z.coerce.number().optional(),
  status: z.enum(["pending", "in_progress", "waiting_parts", "completed", "delivered", "cancelled"]).default("pending"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  complaint: z.string().optional(),
  estimatedHours: z.coerce.number().optional(),
  mileageIn: z.coerce.number().min(0).optional(),
  promisedDate: z.string().optional(),
});

export default function RepairOrdersNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: customers } = useGetCustomers({ limit: 100 }, { query: { queryKey: getGetCustomersQueryKey({ limit: 100 }) } });
  const { data: vehicles } = useGetVehicles({ limit: 100 }, { query: { queryKey: getGetVehiclesQueryKey({ limit: 100 }) } });
  const { data: employees } = useGetEmployees({ role: "technician" }, { query: { queryKey: getGetEmployeesQueryKey({ role: "technician" }) } });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customerId: 0,
      vehicleId: 0,
      status: "pending",
      priority: "normal",
      complaint: "",
      mileageIn: undefined,
      promisedDate: "",
    },
  });

  const createRepairOrder = useCreateRepairOrder();

  function onSubmit(values: z.infer<typeof formSchema>) {
    const payload: any = { ...values };
    if (values.promisedDate) payload.promisedDate = new Date(values.promisedDate).toISOString();
    createRepairOrder.mutate(
      { data: payload },
      {
        onSuccess: (data) => {
          toast({ title: "Repair order created" });
          setLocation(`/repair-orders/${data.id}`);
        },
        onError: () => {
          toast({ title: "Error creating repair order", variant: "destructive" });
        },
      }
    );
  }

  const empList = Array.isArray(employees) ? employees : employees?.data ?? [];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/repair-orders")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Repair Order</h1>
          <p className="text-sm text-muted-foreground">Create a new job card for the shop floor.</p>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="bg-muted/20 border-b pb-3">
          <CardTitle className="text-base">Job Details</CardTitle>
        </CardHeader>
        <CardContent className="pt-5">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <FormField
                  control={form.control}
                  name="customerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer <span className="text-destructive">*</span></FormLabel>
                      <Select onValueChange={(val) => field.onChange(Number(val))} value={field.value ? String(field.value) : undefined}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select a customer" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {customers?.data?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.firstName} {c.lastName}</SelectItem>)}
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
                      <FormLabel>Vehicle <span className="text-destructive">*</span></FormLabel>
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
                <FormField
                  control={form.control}
                  name="assignedToId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assign To (Technician)</FormLabel>
                      <Select onValueChange={(val) => field.onChange(Number(val))} value={field.value ? String(field.value) : undefined}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select a technician" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {empList.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priority</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="normal">Normal</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="urgent">Urgent</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="complaint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Customer Complaint</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Describe what the customer reported..." className="min-h-[90px]" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <FormField
                  control={form.control}
                  name="mileageIn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mileage In</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="e.g. 62400"
                          min={0}
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="estimatedHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estimated Hours</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="e.g. 2.5"
                          step={0.5}
                          min={0}
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="promisedDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Promised Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setLocation("/repair-orders")}>Cancel</Button>
                <Button type="submit" disabled={createRepairOrder.isPending}>
                  {createRepairOrder.isPending ? "Creating..." : "Create Repair Order"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
