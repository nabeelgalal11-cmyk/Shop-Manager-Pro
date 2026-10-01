import { useLocation } from "wouter";
import { useCreateExpense } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";

const expenseCategories = [
  "Rent",
  "Electricity",
  "Natural Gas",
  "Water & Sewer",
  "Internet & Phone",
  "Insurance",
  "Fuel & Vehicle",
  "Shop Supplies & Consumables",
  "Repairs & Maintenance",
  "Software & Subscriptions",
  "Licenses & Taxes",
  "Bank & Payment Fees",
  "Other",
] as const;

function localIsoDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const formSchema = z.object({
  category: z.string().min(1, "Required"),
  description: z.string().trim().min(1, "Required"),
  amount: z.coerce.number().min(0.01, "Must be positive"),
  vendor: z.string().optional(),
  receiptNumber: z.string().optional(),
  expenseDate: z.string().min(1, "Date required"),
  notes: z.string().optional(),
});

export default function ExpensesNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      category: "",
      description: "",
      amount: 0,
      vendor: "",
      receiptNumber: "",
      expenseDate: localIsoDate(),
      notes: "",
    },
  });

  const createExpense = useCreateExpense();

  function onSubmit(values: z.infer<typeof formSchema>) {
    const payload = {
      ...values,
      vendor: values.vendor?.trim() || undefined,
      receiptNumber: values.receiptNumber?.trim() || undefined,
      notes: values.notes?.trim() || undefined,
    };
    createExpense.mutate(
      { data: payload },
      {
        onSuccess: () => {
          toast({ title: "Expense recorded" });
          setLocation("/expenses");
        },
        onError: (error) => toast({
          title: "Expense could not be saved",
          description: error instanceof Error ? error.message : "Check your connection and try again.",
          variant: "destructive",
        }),
      }
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/expenses")}><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-3xl font-bold">New Expense</h1>
      </div>
      <Card className="shadow-sm border-border">
        <CardContent className="pt-6">
          <p className="mb-5 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            Record operating bills here. Record stock-tracked supplies through Purchases, then link them to the repair where they are used. If the owner pays a shop bill personally, record the bill here and the loan or contribution separately in Owner Funding.
          </p>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField control={form.control} name="category" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Choose a category" /></SelectTrigger></FormControl>
                      <SelectContent>{expenseCategories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem><FormLabel>Amount ($)</FormLabel><FormControl><Input type="number" min="0.01" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Description</FormLabel><FormControl><Input placeholder="e.g. October internet service or shop rent" maxLength={200} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField control={form.control} name="vendor" render={({ field }) => (
                  <FormItem><FormLabel>Vendor (Optional)</FormLabel><FormControl><Input placeholder="Utility provider or landlord" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="receiptNumber" render={({ field }) => (
                  <FormItem><FormLabel>Receipt or invoice # (Optional)</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField control={form.control} name="expenseDate" render={({ field }) => (
                  <FormItem><FormLabel>Bill date</FormLabel><FormControl><Input type="date" required {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem><FormLabel>Notes (Optional)</FormLabel><FormControl><Textarea rows={2} maxLength={1000} placeholder="Billing period, payment method, or context" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={createExpense.isPending}>{createExpense.isPending ? "Saving…" : "Save Expense"}</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}