import { useGetAppointments, getGetAppointmentsQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Appointments() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useGetAppointments({ limit: 50 }, { query: { queryKey: getGetAppointmentsQueryKey({ limit: 50 }) } });
  const items = Array.isArray(data) ? data : data?.data || [];
  
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Appointments</h1>
          <p className="text-muted-foreground">Schedule and manage bookings.</p>
        </div>
        <Button onClick={() => setLocation("/appointments/new")}><Plus className="mr-2 h-4 w-4" /> New Appointment</Button>
      </div>
      <Card className="shadow-sm border-border">
        <Table>
          <TableHeader><TableRow><TableHead>Date/Time</TableHead><TableHead>Customer</TableHead><TableHead>Service</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(apt => (
              <TableRow key={apt.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setLocation(`/appointments/${apt.id}`)}>
                <TableCell className="font-medium">{new Date(apt.scheduledAt).toLocaleString()}</TableCell>
                <TableCell>{apt.customer?.firstName} {apt.customer?.lastName}</TableCell>
                <TableCell>{apt.serviceType}</TableCell>
                <TableCell><Badge variant="outline" className="capitalize">{apt.status.replace('_', ' ')}</Badge></TableCell>
              </TableRow>
            ))}
            {items.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No appointments found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}