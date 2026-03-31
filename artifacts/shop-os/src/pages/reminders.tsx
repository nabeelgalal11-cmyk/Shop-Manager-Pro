import { useGetReminders, getGetRemindersQueryKey } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function Reminders() {
  const { data, isLoading } = useGetReminders({ limit: 50 }, { query: { queryKey: getGetRemindersQueryKey({ limit: 50 }) } });
  const items = Array.isArray(data) ? data : data?.data || [];
  
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Reminders</h1>
          <p className="text-muted-foreground">Service reminders for customers.</p>
        </div>
      </div>
      <Card className="shadow-sm border-border">
        <Table>
          <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Vehicle</TableHead><TableHead>Service</TableHead><TableHead>Due Date</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(rem => (
              <TableRow key={rem.id} className="hover:bg-muted/50 transition-colors">
                <TableCell className="font-medium">{rem.customer?.firstName} {rem.customer?.lastName}</TableCell>
                <TableCell>{rem.vehicle?.year} {rem.vehicle?.make}</TableCell>
                <TableCell>{rem.serviceType}</TableCell>
                <TableCell>{new Date(rem.dueDate).toLocaleDateString()}</TableCell>
                <TableCell>{rem.sent ? <Badge variant="outline">Sent</Badge> : <Badge variant="secondary">Pending</Badge>}</TableCell>
              </TableRow>
            ))}
            {items.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No reminders found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}