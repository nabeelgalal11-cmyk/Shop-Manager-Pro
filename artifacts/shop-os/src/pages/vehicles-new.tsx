import { useLocation } from "wouter";
import { useCreateVehicle } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import { CustomerCombobox } from "@/components/customer-combobox";

const formSchema = z.object({
  customerId: z.coerce.number().min(1, "Customer is required"),
  year: z.coerce.number().min(1900, "Valid year required").max(new Date().getFullYear() + 1),
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  licensePlate: z.string().optional().or(z.literal("")),
  vin: z.string().optional().or(z.literal("")),
  fleetNumber: z.string().optional().or(z.literal("")),
  color: z.string().optional().or(z.literal("")),
  mileage: z.coerce.number().optional().or(z.literal(0)),
});

export default function VehiclesNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customerId: 0,
      year: new Date().getFullYear(),
      make: "",
      model: "",
      licensePlate: "",
      vin: "",
      fleetNumber: "",
      color: "",
      mileage: 0,
    },
  });

  const createVehicle = useCreateVehicle();

  function onSubmit(values: z.infer<typeof formSchema>) {
    createVehicle.mutate(
      { data: values },
      {
        onSuccess: (data) => {
          toast({ title: "Vehicle created" });
          setLocation(`/vehicles/${data.id}`);
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
        <Button variant="ghost" size="icon" onClick={() => setLocation("/vehicles")}><ArrowLeft className="h-5 w-5" /></Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">New Vehicle</h1>
        </div>
      </div>
      <Card className="shadow-sm border-border">
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <FormField
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Customer</FormLabel>
                    <FormControl>
                      <CustomerCombobox
                        value={field.value || null}
                        onChange={(id) => field.onChange(id)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FormField control={form.control} name="year" render={({ field }) => (
                  <FormItem><FormLabel>Year</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="make" render={({ field }) => (
                  <FormItem><FormLabel>Make</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="model" render={({ field }) => (
                  <FormItem><FormLabel>Model</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField control={form.control} name="licensePlate" render={({ field }) => (
                  <FormItem><FormLabel>License Plate</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="vin" render={({ field }) => (
                  <FormItem><FormLabel>VIN</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="fleetNumber" render={({ field }) => (
                  <FormItem><FormLabel>Fleet # <span className="text-xs text-muted-foreground font-normal">(leave blank if not a fleet vehicle)</span></FormLabel><FormControl><Input placeholder="e.g. 042" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="color" render={({ field }) => (
                  <FormItem><FormLabel>Color</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="mileage" render={({ field }) => (
                  <FormItem><FormLabel>Mileage</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="flex justify-end pt-4">
                <Button type="button" variant="outline" onClick={() => setLocation("/vehicles")} className="mr-2">Cancel</Button>
                <Button type="submit" disabled={createVehicle.isPending}>Save Vehicle</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}