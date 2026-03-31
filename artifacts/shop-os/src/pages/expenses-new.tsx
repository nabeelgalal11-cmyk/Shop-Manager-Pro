import { useLocation } from "wouter";
import { useCreateExpense } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";

const formSchema = z.object({
  category: z.string().min(1, "Required"),
  description: z.string().min(1, "Required"),
  amount: z.coerce.number().min(0.01, "Must be positive"),
  vendor: z.string().optional(),
  expenseDate: z.string().min(1, "Date required"),
});

export default function ExpensesNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      category: "Supplies",
      description: "",
      amount: 0,
      expenseDate: new Date().toISOString().split('T')[0],
    },
  });

  const createExpense = useCreateExpense();

  function onSubmit(values: z.infer<typeof formSchema>) {
    createExpense.mutate(
      { data: { ...values, expenseDate: new Date(values.expenseDate).toISOString() } },
      {
        onSuccess: () => {
          toast({ title: "Expense recorded" });
          setLocation("/expenses");
        }
      }
    );
  }

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/expenses")}><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-3xl font-bold">New Expense</h1>
      </div>
      <Card className="shadow-sm border-border">
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="category" render={({ field }) => (
                  <FormItem><FormLabel>Category</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem><FormLabel>Amount ($)</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="vendor" render={({ field }) => (
                <FormItem><FormLabel>Vendor (Optional)</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="expenseDate" render={({ field }) => (
                <FormItem><FormLabel>Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={createExpense.isPending}>Save Expense</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}