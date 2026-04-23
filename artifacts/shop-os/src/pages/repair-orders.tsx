import { useGetRepairOrders, getGetRepairOrdersQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, ChevronRight, AlertTriangle, Clock, CheckCircle2, Wrench, ChevronLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const PAGE_SIZE = 50;

export default function RepairOrders() {
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useGetRepairOrders(
    { limit: PAGE_SIZE, page },
    { query: { queryKey: getGetRepairOrdersQueryKey({ limit: PAGE_SIZE, page }) } }
  );

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const startIdx = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(page * PAGE_SIZE, total);

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'pending': return <Badge variant="secondary" className="bg-muted text-muted-foreground"><Clock className="mr-1 h-3 w-3" /> Pending</Badge>;
      case 'in_progress': return <Badge className="bg-primary text-primary-foreground border-primary"><Wrench className="mr-1 h-3 w-3" /> In Progress</Badge>;
      case 'waiting_parts': return <Badge variant="outline" className="border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950/20"><AlertTriangle className="mr-1 h-3 w-3" /> Waiting Parts</Badge>;
      case 'completed': return <Badge className="bg-green-600 hover:bg-green-700 text-white"><CheckCircle2 className="mr-1 h-3 w-3" /> Completed</Badge>;
      default: return <Badge variant="outline">{status.replace('_', ' ')}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch(priority) {
      case 'urgent': return <span className="text-xs font-bold text-destructive flex items-center"><AlertTriangle className="mr-1 h-3 w-3" /> Urgent</span>;
      case 'high': return <span className="text-xs font-semibold text-orange-600 dark:text-orange-500">High</span>;
      case 'low': return <span className="text-xs text-muted-foreground">Low</span>;
      default: return <span className="text-xs text-muted-foreground">Normal</span>;
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Repair Orders</h1>
          <p className="text-muted-foreground mt-1">Manage active jobs and service history.</p>
        </div>
        <Button onClick={() => setLocation("/repair-orders/new")} className="shadow-sm font-medium">
          <Plus className="mr-2 h-4 w-4" /> New Repair Order
        </Button>
      </div>

      <Card className="shadow-sm border-border">
        <div className="p-4 border-b flex items-center justify-between gap-4 bg-muted/20">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search RO number, customer, vehicle..."
              className="pl-9 bg-background"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">Kanban View</Button>
            <Button variant="secondary" size="sm">List View</Button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[100px]">RO #</TableHead>
              <TableHead>Customer / Vehicle</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell></TableCell>
                </TableRow>
              ))
            ) : data?.data && data.data.length > 0 ? (
              data.data.map((ro) => (
                <TableRow 
                  key={ro.id} 
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setLocation(`/repair-orders/${ro.id}`)}
                >
                  <TableCell className="font-mono font-medium text-sm">
                    {ro.orderNumber}
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold text-foreground">
                      {ro.customer ? `${ro.customer.firstName} ${ro.customer.lastName}` : 'Unknown Customer'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {ro.vehicle ? `${ro.vehicle.year} ${ro.vehicle.make} ${ro.vehicle.model}` : 'Unknown Vehicle'}
                    </div>
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(ro.status)}
                  </TableCell>
                  <TableCell>
                    {getPriorityBadge(ro.priority)}
                  </TableCell>
                  <TableCell>
                    {ro.assignedTo ? (
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-xs font-bold border border-border">
                          {ro.assignedTo.firstName[0]}{ro.assignedTo.lastName[0]}
                        </div>
                        <span className="text-sm font-medium">{ro.assignedTo.firstName} {ro.assignedTo.lastName}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground italic">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  No repair orders found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {total > 0 && (
          <div className="flex items-center justify-between gap-4 px-4 py-3 border-t bg-muted/10 text-sm">
            <div className="text-muted-foreground">
              Showing <span className="font-medium text-foreground">{startIdx}</span>–<span className="font-medium text-foreground">{endIdx}</span> of <span className="font-medium text-foreground">{total}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || isLoading} onClick={() => setPage(p => Math.max(1, p - 1))}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <span className="text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages || isLoading} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}