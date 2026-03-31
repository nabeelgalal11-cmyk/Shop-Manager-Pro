import { useGetPayments, getGetPaymentsQueryKey } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Payments() {
  const { data, isLoading } = useGetPayments({ limit: 50 }, { query: { queryKey: getGetPaymentsQueryKey({ limit: 50 }) } });
  const items = Array.isArray(data) ? data : data?.data || [];
  
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Payments</h1>
          <p className="text-muted-foreground">Transaction history.</p>
        </div>
      </div>
      <Card className="shadow-sm border-border">
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Invoice ID</TableHead><TableHead>Method</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(pay => (
              <TableRow key={pay.id} className="hover:bg-muted/50 transition-colors">
                <TableCell>{new Date(pay.paidAt).toLocaleString()}</TableCell>
                <TableCell className="font-mono">{pay.invoiceId}</TableCell>
                <TableCell className="capitalize">{pay.method.replace('_', ' ')}</TableCell>
                <TableCell className="font-semibold">${pay.amount}</TableCell>
              </TableRow>
            ))}
            {items.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No payments found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}