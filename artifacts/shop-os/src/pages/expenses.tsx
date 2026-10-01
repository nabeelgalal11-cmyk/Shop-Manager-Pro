import { useGetExpenses, getGetExpensesQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

function formatExpenseDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

export default function Expenses() {
  const [, setLocation] = useLocation();
  const { data, isLoading, isError, refetch } = useGetExpenses({ limit: 50 }, { query: { queryKey: getGetExpensesQueryKey({ limit: 50 }) } });
  const items = Array.isArray(data) ? data : data?.data || [];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Expenses</h1>
          <p className="text-muted-foreground">Track rent, utilities, supplies, and other shop operating bills.</p>
        </div>
        <Button onClick={() => setLocation("/expenses/new")}><Plus className="mr-2 h-4 w-4" /> Add Expense</Button>
      </div>
      <Card className="shadow-sm border-border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead>Description</TableHead><TableHead>Vendor</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map(exp => (
                <TableRow key={exp.id} className="hover:bg-muted/50 transition-colors">
                  <TableCell className="whitespace-nowrap font-medium">{formatExpenseDate(exp.expenseDate)}</TableCell>
                  <TableCell><Badge variant="secondary">{exp.category}</Badge></TableCell>
                  <TableCell className="min-w-48">{exp.description}{exp.notes && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{exp.notes}</p>}</TableCell>
                  <TableCell>{exp.vendor || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold">${Number(exp.amount).toFixed(2)}</TableCell>
                </TableRow>
              ))}
              {isLoading && <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">Loading expenses…</TableCell></TableRow>}
              {isError && <TableRow><TableCell colSpan={5} className="h-24 text-center text-destructive">Could not load expenses. <Button variant="link" onClick={() => refetch()}>Retry</Button></TableCell></TableRow>}
              {items.length === 0 && !isLoading && !isError && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No expenses recorded yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}