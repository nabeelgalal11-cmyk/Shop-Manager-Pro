import { useGetAppointments, getGetAppointmentsQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const PAGE_SIZE = 50;

export default function Appointments() {
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(1);
  const { can } = useAuth();
  const { data, isLoading } = useGetAppointments({ limit: PAGE_SIZE, page }, { query: { queryKey: getGetAppointmentsQueryKey({ limit: PAGE_SIZE, page }) } });
  const items = Array.isArray(data) ? data : data?.data || [];
  const total = Array.isArray(data) ? items.length : (data?.total ?? items.length);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Appointments</h1>
          <p className="text-muted-foreground">Schedule and manage bookings.</p>
        </div>
        {can("appointments", "create") && <Button onClick={() => setLocation("/appointments/new")}><Plus className="mr-2 h-4 w-4" /> New Appointment</Button>}
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
                <TableCell>
                  <Badge
                    variant={apt.status === "pending" ? "default" : "outline"}
                    className={`capitalize ${apt.status === "pending" ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}`}
                  >
                    {apt.status === "pending" ? "🔔 Pending Web Request" : apt.status.replace('_', ' ')}
                  </Badge>
                </TableCell>
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
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">Page {page} of {totalPages} · {total} appointments</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || isLoading} onClick={() => setPage((current) => current - 1)}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Previous
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages || isLoading} onClick={() => setPage((current) => current + 1)}>
            Next <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}