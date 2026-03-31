import { useLocation } from "wouter";
import { useCreateAppointment, useGetCustomers, getGetCustomersQueryKey, useGetVehicles, getGetVehiclesQueryKey } from "@workspace/api-client-react";
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

const formSchema = z.object({
  customerId: z.coerce.number().min(1, "Customer required"),
  vehicleId: z.coerce.number().optional(),
  serviceType: z.string().min(1, "Service type required"),
  scheduledAt: z.string().min(1, "Date required"),
  estimatedDuration: z.coerce.number().optional(),
  notes: z.string().optional(),
});

export default function AppointmentsNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { data: customers } = useGetCustomers({ limit: 100 }, { query: { queryKey: getGetCustomersQueryKey({ limit: 100 }) } });
  const { data: vehicles } = useGetVehicles({ limit: 100 }, { query: { queryKey: getGetVehiclesQueryKey({ limit: 100 }) } });
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      serviceType: "Oil Change",
      scheduledAt: new Date().toISOString().slice(0, 16),
      estimatedDuration: 60,
    },
  });

  const createAppointment = useCreateAppointment();

  function onSubmit(values: z.infer<typeof formSchema>) {
    createAppointment.mutate(
      { data: { ...values, scheduledAt: new Date(values.scheduledAt).toISOString() } },
      {
        onSuccess: () => {
          toast({ title: "Appointment booked" });
          setLocation("/appointments");
        }
      }
    );
  }

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/appointments")}><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-3xl font-bold">New Appointment</h1>
      </div>
      <Card className="shadow-sm border-border">
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                    <FormLabel>Vehicle (Optional)</FormLabel>
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
              <FormField control={form.control} name="serviceType" render={({ field }) => (
                <FormItem><FormLabel>Service Type</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="scheduledAt" render={({ field }) => (
                  <FormItem><FormLabel>Date & Time</FormLabel><FormControl><Input type="datetime-local" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="estimatedDuration" render={({ field }) => (
                  <FormItem><FormLabel>Est. Duration (mins)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={createAppointment.isPending}>Book Appointment</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}