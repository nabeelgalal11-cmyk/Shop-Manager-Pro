import { useState } from "react";
import { useLocation } from "wouter";
import { useCreateCustomer, useCreateVehicle } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Sparkles, Loader2, Plus } from "lucide-react";
import { CustomerCombobox } from "@/components/customer-combobox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const formSchema = z.object({
  customerId: z.coerce.number().min(1, "Customer is required"),
  year: z.coerce.number().min(1900, "Valid year required").max(new Date().getFullYear() + 1),
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  trim: z.string().optional().or(z.literal("")),
  licensePlate: z.string().optional().or(z.literal("")),
  vin: z.string().optional().or(z.literal("")),
  fleetNumber: z.string().optional().or(z.literal("")),
  color: z.string().optional().or(z.literal("")),
  mileage: z.coerce.number().optional().or(z.literal(0)),
  engineType: z.string().optional().or(z.literal("")),
  transmissionType: z.string().optional().or(z.literal("")),
});

export default function VehiclesNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customerId: 0,
      year: new Date().getFullYear(),
      make: "",
      model: "",
      trim: "",
      licensePlate: "",
      vin: "",
      fleetNumber: "",
      color: "",
      mileage: 0,
      engineType: "",
      transmissionType: "",
    },
  });

  const createVehicle = useCreateVehicle();
  const createCustomer = useCreateCustomer();
  const [decoding, setDecoding] = useState(false);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
  });

  async function decodeVin() {
    const vin = (form.getValues("vin") || "").trim();
    if (vin.length < 11 || vin.length > 17) {
      toast({ title: "Enter a VIN first", description: "VIN must be 11–17 characters.", variant: "destructive" });
      return;
    }
    setDecoding(true);
    try {
      const r = await fetch(`/api/vin/${encodeURIComponent(vin)}`);
      if (!r.ok) throw new Error((await r.json())?.error || "Decode failed");
      const d = await r.json();
      if (d.year) form.setValue("year", d.year, { shouldValidate: true });
      if (d.make) form.setValue("make", d.make, { shouldValidate: true });
      if (d.model) form.setValue("model", d.model, { shouldValidate: true });
      if (d.trim) form.setValue("trim", d.trim, { shouldValidate: true });
      if (d.engineType) form.setValue("engineType", d.engineType, { shouldValidate: true });
      if (d.transmissionType) {
        const t = String(d.transmissionType).toLowerCase();
        const mapped = t.includes("manual") ? "manual"
          : t.includes("cvt") || t.includes("continuously variable") ? "cvt"
          : t.includes("auto") ? "automatic"
          : "other";
        form.setValue("transmissionType", mapped, { shouldValidate: true });
      }
      toast({ title: "VIN decoded", description: [d.year, d.make, d.model, d.trim].filter(Boolean).join(" ") || "Filled what was available" });
    } catch (e: any) {
      toast({ title: "VIN decode failed", description: e.message, variant: "destructive" });
    } finally {
      setDecoding(false);
    }
  }

  function handleCreateCustomer() {
    const firstName = newCustomer.firstName.trim();
    const lastName = newCustomer.lastName.trim();
    if (!firstName || !lastName) {
      toast({
        title: "First and last name are required",
        variant: "destructive",
      });
      return;
    }

    createCustomer.mutate(
      {
        data: {
          firstName,
          lastName,
          phone: newCustomer.phone.trim(),
          email: newCustomer.email.trim(),
        } as any,
      },
      {
        onSuccess: (customer) => {
          queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
          form.setValue("customerId", Number(customer.id), {
            shouldDirty: true,
            shouldValidate: true,
          });
          setNewCustomer({ firstName: "", lastName: "", phone: "", email: "" });
          setNewCustomerOpen(false);
          toast({
            title: "Customer added",
            description: `${firstName} ${lastName} is now selected for this vehicle.`,
          });
        },
        onError: () => {
          toast({
            title: "Could not add customer",
            description: "Please check the customer information and try again.",
            variant: "destructive",
          });
        },
      },
    );
  }

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
                    <div className="flex items-center justify-between">
                      <FormLabel>Customer</FormLabel>
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto gap-1 p-0 text-xs"
                        onClick={() => setNewCustomerOpen(true)}
                      >
                        <Plus className="h-3.5 w-3.5" /> Add customer
                      </Button>
                    </div>
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
                  <FormItem>
                    <FormLabel>VIN</FormLabel>
                    <div className="flex gap-2">
                      <FormControl><Input placeholder="Paste VIN to auto-fill year/make/model" {...field} /></FormControl>
                      <Button type="button" variant="outline" onClick={decodeVin} disabled={decoding}>
                        {decoding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        <span className="ml-1 hidden sm:inline">Decode</span>
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
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
                <FormField control={form.control} name="trim" render={({ field }) => (
                  <FormItem><FormLabel>Trim</FormLabel><FormControl><Input placeholder="e.g. XLE" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField control={form.control} name="engineType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Engine</FormLabel>
                    <FormControl><Input placeholder="e.g. 2.0L I4" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="transmissionType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Transmission</FormLabel>
                    <Select value={field.value || ""} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="automatic">Automatic</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                        <SelectItem value="cvt">CVT</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
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

      <Dialog open={newCustomerOpen} onOpenChange={setNewCustomerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add customer</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-customer-first-name">First name</Label>
                <Input
                  id="new-customer-first-name"
                  autoFocus
                  value={newCustomer.firstName}
                  onChange={(event) =>
                    setNewCustomer((current) => ({
                      ...current,
                      firstName: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-customer-last-name">Last name</Label>
                <Input
                  id="new-customer-last-name"
                  value={newCustomer.lastName}
                  onChange={(event) =>
                    setNewCustomer((current) => ({
                      ...current,
                      lastName: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-customer-phone">Phone</Label>
              <Input
                id="new-customer-phone"
                type="tel"
                value={newCustomer.phone}
                onChange={(event) =>
                  setNewCustomer((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-customer-email">Email</Label>
              <Input
                id="new-customer-email"
                type="email"
                value={newCustomer.email}
                onChange={(event) =>
                  setNewCustomer((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNewCustomerOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleCreateCustomer} disabled={createCustomer.isPending}>
              {createCustomer.isPending ? "Adding…" : "Add customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}