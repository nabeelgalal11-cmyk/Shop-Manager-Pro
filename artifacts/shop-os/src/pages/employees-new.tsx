import { useLocation } from "wouter";
import { useCreateEmployee } from "@workspace/api-client-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import { RoleMultiSelect } from "@/components/role-multiselect";

const formSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  email: z.string().email().optional().or(z.literal("")),
  roles: z.array(z.string()).min(1, "Pick at least one role"),
  hourlyRate: z.coerce.number().optional(),
});

export default function EmployeesNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      roles: ["technician"],
    },
  });

  const createEmployee = useCreateEmployee();

  function onSubmit(values: z.infer<typeof formSchema>) {
    createEmployee.mutate(
      { data: { ...values, role: values.roles[0] } as any },
      {
        onSuccess: () => {
          toast({ title: "Employee created" });
          setLocation("/employees");
        },
        onError: () => toast({ title: "Failed to create", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/employees")}><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-3xl font-bold">New Employee</h1>
      </div>
      <Card className="shadow-sm border-border">
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="firstName" render={({ field }) => (
                  <FormItem><FormLabel>First Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="lastName" render={({ field }) => (
                  <FormItem><FormLabel>Last Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <Controller
                control={form.control}
                name="roles"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Roles <span className="text-xs text-muted-foreground font-normal">(an employee can hold more than one)</span></FormLabel>
                    <RoleMultiSelect value={field.value || []} onChange={field.onChange} />
                    {fieldState.error && (
                      <p className="text-sm text-destructive">{fieldState.error.message}</p>
                    )}
                  </FormItem>
                )}
              />
              <FormField control={form.control} name="hourlyRate" render={({ field }) => (
                <FormItem><FormLabel>Hourly Rate ($)</FormLabel><FormControl><Input type="number" step="0.5" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="flex justify-end pt-4 gap-2">
                <Button type="button" variant="outline" onClick={() => setLocation("/employees")}>Cancel</Button>
                <Button type="submit" disabled={createEmployee.isPending}>Save Employee</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
