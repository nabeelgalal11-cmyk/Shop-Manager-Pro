import { useGetInvoices, getGetInvoicesQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Invoices() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useGetInvoices({ limit: 50 }, { query: { queryKey: getGetInvoicesQueryKey({ limit: 50 }) } });
  const items = Array.isArray(data) ? data : data?.data || [];
  
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Invoices</h1>
          <p className="text-muted-foreground">Manage customer invoices.</p>
        </div>
        <Button onClick={() => setLocation("/invoices/new")}><Plus className="mr-2 h-4 w-4" /> New Invoice</Button>
      </div>
      <Card className="shadow-sm border-border">
        <Table>
          <TableHeader><TableRow><TableHead>Invoice #</TableHead><TableHead>Customer</TableHead><TableHead>Total</TableHead><TableHead>Balance</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(inv => (
              <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setLocation(`/invoices/${inv.id}`)}>
                <TableCell className="font-mono">{inv.invoiceNumber}</TableCell>
                <TableCell className="font-medium">{inv.customer?.firstName} {inv.customer?.lastName}</TableCell>
                <TableCell>${inv.total}</TableCell>
                <TableCell className={inv.balance > 0 ? "font-semibold text-destructive" : ""}>${inv.balance}</TableCell>
                <TableCell><Badge variant={inv.status === 'paid' ? 'default' : inv.status === 'overdue' ? 'destructive' : 'secondary'} className="capitalize">{inv.status}</Badge></TableCell>
              </TableRow>
            ))}
            {items.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No invoices found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}