import { useLocation } from "wouter";
import { useCreateRepairOrder, useGetCustomers, getGetCustomersQueryKey, useGetVehicles, getGetVehiclesQueryKey, useGetEmployees, getGetEmployeesQueryKey } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

const formSchema = z.object({
  customerId: z.coerce.number().min(1, "Customer is required"),
  vehicleId: z.coerce.number().min(1, "Vehicle is required"),
  assignedToId: z.coerce.number().optional(),
  status: z.enum(["pending", "in_progress", "waiting_parts", "completed", "delivered", "cancelled"]).default("pending"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  complaint: z.string().optional(),
  estimatedHours: z.coerce.number().optional(),
  mileageIn: z.coerce.number().optional(),
});

export default function RepairOrdersNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { data: customers } = useGetCustomers({ limit: 100 }, { query: { queryKey: getGetCustomersQueryKey({ limit: 100 }) } });
  const { data: vehicles } = useGetVehicles({ limit: 100 }, { query: { queryKey: getGetVehiclesQueryKey({ limit: 100 }) } });
  const { data: employees } = useGetEmployees({ role: 'technician' }, { query: { queryKey: getGetEmployeesQueryKey({ role: 'technician' }) } });
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customerId: 0,
      vehicleId: 0,
      status: "pending",
      priority: "normal",
      complaint: "",
    },
  });

  const createRepairOrder = useCreateRepairOrder();

  function onSubmit(values: z.infer<typeof formSchema>) {
    createRepairOrder.mutate(
      { data: values },
      {
        onSuccess: (data) => {
          toast({ title: "Repair order created" });
          setLocation(`/repair-orders/${data.id}`);
        },
        onError: () => {
          toast({ title: "Error", variant: "destructive" });
        }
      }
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/repair-orders")}><ArrowLeft className="h-5 w-5" /></Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New Repair Order</h1>
        </div>
      </div>
      <Card className="shadow-sm border-border">
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="customerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer</FormLabel>
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
                <FormField
                  control={form.control}
                  name="assignedToId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assign To (Technician)</FormLabel>
                      <Select onValueChange={(val) => field.onChange(Number(val))} value={field.value ? String(field.value) : undefined}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select a technician" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {Array.isArray(employees) ? employees.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>) : employees?.data?.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>)}
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

              <FormField control={form.control} name="complaint" render={({ field }) => (
                <FormItem><FormLabel>Customer Complaint</FormLabel><FormControl><Textarea className="min-h-[100px]" {...field} /></FormControl></FormItem>
              )} />

              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={createRepairOrder.isPending}>Create Repair Order</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}