import { useGetTimeEntries, getGetTimeEntriesQueryKey } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function TimeEntries() {
  const { data, isLoading } = useGetTimeEntries({ limit: 50 }, { query: { queryKey: getGetTimeEntriesQueryKey({ limit: 50 }) } });
  const items = Array.isArray(data) ? data : data?.data || [];
  
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Time Entries</h1>
          <p className="text-muted-foreground">Employee timesheets.</p>
        </div>
      </div>
      <Card className="shadow-sm border-border">
        <Table>
          <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Clock In</TableHead><TableHead>Clock Out</TableHead><TableHead>Total Hours</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(entry => (
              <TableRow key={entry.id} className="hover:bg-muted/50 transition-colors">
                <TableCell className="font-medium">{entry.employee?.firstName} {entry.employee?.lastName}</TableCell>
                <TableCell>{new Date(entry.clockIn).toLocaleString()}</TableCell>
                <TableCell>{entry.clockOut ? new Date(entry.clockOut).toLocaleString() : <span className="italic text-muted-foreground">Active</span>}</TableCell>
                <TableCell className="font-semibold">{entry.totalHours || '-'}</TableCell>
              </TableRow>
            ))}
            {items.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No time entries found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}