import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useCreateRepairOrder, useGetCustomers, getGetCustomersQueryKey, useGetVehicles, getGetVehiclesQueryKey, useGetEmployees, getGetEmployeesQueryKey } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Wrench } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

const formSchema = z.object({
  internal: z.boolean().default(false),
  customerId: z.coerce.number().optional(),
  vehicleId: z.coerce.number().optional(),
  usedCarId: z.coerce.number().optional(),
  assignedToId: z.coerce.number().optional(),
  status: z.enum(["pending", "in_progress", "waiting_parts", "completed", "delivered", "cancelled"]).default("pending"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  complaint: z.string().optional(),
  estimatedHours: z.coerce.number().optional(),
  mileageIn: z.coerce.number().min(0).optional(),
  promisedDate: z.string().optional(),
}).refine(v => v.internal ? !!v.usedCarId : (!!v.customerId && !!v.vehicleId), {
  message: "Pick a customer + vehicle, or check internal and pick a used car",
  path: ["customerId"],
});

export default function RepairOrdersNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: customers } = useGetCustomers({ limit: 100 }, { query: { queryKey: getGetCustomersQueryKey({ limit: 100 }) } });
  const { data: vehicles } = useGetVehicles({ limit: 100 }, { query: { queryKey: getGetVehiclesQueryKey({ limit: 100 }) } });
  const { data: employees } = useGetEmployees({ role: "technician" }, { query: { queryKey: getGetEmployeesQueryKey({ role: "technician" }) } });
  const { data: usedCarsData } = useQuery<{ data: any[] }>({
    queryKey: ["/api/used-cars"],
    queryFn: async () => {
      const r = await fetch("/api/used-cars");
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });
  const usedCars = (usedCarsData?.data ?? []).filter((c: any) => c.status !== "sold");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      internal: false,
      customerId: undefined,
      vehicleId: undefined,
      usedCarId: undefined,
      status: "pending",
      priority: "normal",
      complaint: "",
      mileageIn: undefined,
      promisedDate: "",
    },
  });

  const internal = form.watch("internal");
  const createRepairOrder = useCreateRepairOrder();

  // Local payload type — the OpenAPI spec hasn't yet been regenerated to model
  // `internal`/`usedCarId` and nullable customer/vehicle (tracked as a follow-up).
  type RepairOrderPayload = {
    internal: boolean;
    assignedToId: number | null | undefined;
    status: string;
    priority: string;
    complaint: string;
    estimatedHours: number | null | undefined;
    mileageIn: number | null | undefined;
    usedCarId?: number;
    customerId?: number;
    vehicleId?: number;
    promisedDate?: string;
  };

  function onSubmit(values: z.infer<typeof formSchema>) {
    const payload: RepairOrderPayload = {
      internal: values.internal,
      assignedToId: values.assignedToId,
      status: values.status,
      priority: values.priority,
      complaint: values.complaint,
      estimatedHours: values.estimatedHours,
      mileageIn: values.mileageIn,
    };
    if (values.internal) {
      payload.usedCarId = values.usedCarId;
    } else {
      payload.customerId = values.customerId;
      payload.vehicleId = values.vehicleId;
    }
    if (values.promisedDate) payload.promisedDate = new Date(values.promisedDate).toISOString();
    createRepairOrder.mutate(
      // Cast at the boundary to the generated client; see RepairOrderPayload note above.
      { data: payload as unknown as Parameters<typeof createRepairOrder.mutate>[0]["data"] },
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
              <FormField
                control={form.control}
                name="internal"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3 bg-muted/20">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5" /> Internal job for used-car inventory</FormLabel>
                      <p className="text-xs text-muted-foreground">Reconditioning work on a vehicle in your used-car inventory. No customer notification.</p>
                    </div>
                  </FormItem>
                )}
              />

              {internal ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <FormField
                    control={form.control}
                    name="usedCarId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Used Car <span className="text-destructive">*</span></FormLabel>
                        <Select onValueChange={(val) => field.onChange(Number(val))} value={field.value ? String(field.value) : undefined}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select inventory vehicle" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {usedCars.length === 0
                              ? <div className="px-2 py-1.5 text-sm text-muted-foreground">No available used cars.</div>
                              : usedCars.map((c: any) => (
                                <SelectItem key={c.id} value={String(c.id)}>
                                  {c.year} {c.make} {c.model}{c.vin ? ` — ${c.vin.slice(-6)}` : ""}
                                </SelectItem>
                              ))}
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
                </div>
              ) : (
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
                            {vehicles?.data?.map(v => <SelectItem key={v.id} value={String(v.id)}>{v.year} {v.make} {v.model}{v.licensePlate ? ` — ${v.licensePlate}` : ""}</SelectItem>)}
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
              )}

              <FormField
                control={form.control}
                name="complaint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{internal ? "Work Description" : "Customer Complaint"}</FormLabel>
                    <FormControl>
                      <Textarea placeholder={internal ? "Describe the recon work to be done..." : "Describe what the customer reported..."} className="min-h-[90px]" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {!internal && (
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
                )}
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
                      <FormLabel>{internal ? "Target Date" : "Promised Date"}</FormLabel>
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
