import { useGetEstimates, getGetEstimatesQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function Estimates() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useGetEstimates({ limit: 50 }, { query: { queryKey: getGetEstimatesQueryKey({ limit: 50 }) } });
  const items = Array.isArray(data) ? data : data?.data || [];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Estimates</h1>
          <p className="text-muted-foreground">Manage repair estimates and revisions.</p>
        </div>
        <Button onClick={() => setLocation("/repair-orders/new")}><Plus className="mr-2 h-4 w-4" /> New Repair Order</Button>
      </div>
      <Card className="shadow-sm border-border">
        <Table>
          <TableHeader><TableRow><TableHead>RO #</TableHead><TableHead>Revision</TableHead><TableHead>Customer</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  <Skeleton className="h-8 w-full" />
                </TableCell>
              </TableRow>
            ) : items.map((est: any) => (
              <TableRow key={est.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setLocation(`/repair-orders/${est.repairOrderId}`)}>
                <TableCell className="font-mono">{est.repairOrderId}</TableCell>
                <TableCell className="font-medium capitalize">{est.kind} {est.revisionNo}</TableCell>
                <TableCell className="font-medium">{est.customerSnapshot?.firstName} {est.customerSnapshot?.lastName}</TableCell>
                <TableCell>${Number(est.total).toFixed(2)}</TableCell>
                <TableCell><Badge variant="outline" className="capitalize">{est.status.replace("_", " ")}</Badge></TableCell>
              </TableRow>
            ))}
            {items.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No estimates found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
