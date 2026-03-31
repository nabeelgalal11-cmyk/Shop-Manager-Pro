import { useGetExpenses, getGetExpensesQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Expenses() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useGetExpenses({ limit: 50 }, { query: { queryKey: getGetExpensesQueryKey({ limit: 50 }) } });
  const items = Array.isArray(data) ? data : data?.data || [];
  
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Expenses</h1>
          <p className="text-muted-foreground">Shop expense tracking.</p>
        </div>
        <Button onClick={() => setLocation("/expenses/new")}><Plus className="mr-2 h-4 w-4" /> Add Expense</Button>
      </div>
      <Card className="shadow-sm border-border">
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead>Description</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(exp => (
              <TableRow key={exp.id} className="hover:bg-muted/50 transition-colors">
                <TableCell className="font-medium">{new Date(exp.expenseDate).toLocaleDateString()}</TableCell>
                <TableCell><Badge variant="secondary">{exp.category}</Badge></TableCell>
                <TableCell>{exp.description}</TableCell>
                <TableCell className="font-semibold">${exp.amount}</TableCell>
              </TableRow>
            ))}
            {items.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No expenses found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}