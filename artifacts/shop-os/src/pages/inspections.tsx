import { useGetInspections, getGetInspectionsQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Inspections() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useGetInspections({ limit: 50 }, { query: { queryKey: getGetInspectionsQueryKey({ limit: 50 }) } });
  const items = Array.isArray(data) ? data : data?.data || [];
  
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Inspections</h1>
          <p className="text-muted-foreground">Vehicle health checks.</p>
        </div>
        <Button onClick={() => setLocation("/inspections/new")}><Plus className="mr-2 h-4 w-4" /> New Inspection</Button>
      </div>
      <Card className="shadow-sm border-border">
        <Table>
          <TableHeader><TableRow><TableHead>Vehicle</TableHead><TableHead>Type</TableHead><TableHead>Condition</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(insp => (
              <TableRow key={insp.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setLocation(`/inspections/${insp.id}`)}>
                <TableCell className="font-medium">{insp.vehicle?.year} {insp.vehicle?.make} {insp.vehicle?.model}</TableCell>
                <TableCell>{insp.type}</TableCell>
                <TableCell>
                  <Badge variant={insp.overallCondition === 'poor' ? 'destructive' : insp.overallCondition === 'fair' ? 'secondary' : 'default'} className="capitalize">
                    {insp.overallCondition}
                  </Badge>
                </TableCell>
                <TableCell>{new Date(insp.createdAt).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
            {items.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No inspections found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}