import { useRoute, useLocation } from "wouter";
import { 
  useGetRepairOrder, getGetRepairOrderQueryKey,
  useUpdateRepairOrder, useDeleteRepairOrder
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Edit, Trash2, Printer, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export default function RepairOrderDetail() {
  const [match, params] = useRoute("/repair-orders/:id");
  const id = match ? parseInt(params.id) : 0;
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: ro, isLoading } = useGetRepairOrder(id, { 
    query: { enabled: !!id, queryKey: getGetRepairOrderQueryKey(id) } 
  });
  
  const updateRO = useUpdateRepairOrder();
  const deleteRO = useDeleteRepairOrder();

  const handleDelete = () => {
    deleteRO.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Repair order deleted" });
        setLocation("/repair-orders");
      }
    });
  };

  const updateStatus = (newStatus: any) => {
    updateRO.mutate({ id, data: { status: newStatus } }, {
      onSuccess: () => {
        toast({ title: "Status updated" });
      }
    });
  };

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!ro) {
    return <div className="p-8 text-center">Repair Order not found</div>;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/repair-orders")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">RO: {ro.orderNumber}</h1>
            <p className="text-muted-foreground">{ro.customer?.firstName} {ro.customer?.lastName} • {ro.vehicle?.year} {ro.vehicle?.make} {ro.vehicle?.model}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Select value={ro.status} onValueChange={updateStatus} disabled={updateRO.isPending}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="waiting_parts">Waiting Parts</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline"><Printer className="h-4 w-4 mr-2" /> Print</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card className="shadow-sm border-border">
            <CardHeader className="bg-muted/20 border-b">
              <CardTitle>Complaint & Diagnosis</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div>
                <h3 className="font-semibold mb-2">Customer Complaint</h3>
                <div className="p-4 bg-muted/30 rounded-md border text-sm min-h-[80px]">
                  {ro.complaint || "No complaint recorded."}
                </div>
              </div>
              <div>
                <h3 className="font-semibold mb-2">Technician Diagnosis</h3>
                <Textarea 
                  placeholder="Enter technician diagnosis..." 
                  defaultValue={ro.diagnosis || ""}
                  className="min-h-[120px]"
                />
                <div className="flex justify-end mt-2">
                  <Button size="sm">Save Diagnosis</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="shadow-sm border-border">
            <CardHeader className="bg-muted/20 border-b">
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Priority</p>
                <Badge variant={ro.priority === 'urgent' ? 'destructive' : 'secondary'} className="capitalize">{ro.priority}</Badge>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Assigned Technician</p>
                <p className="font-medium">{ro.assignedTo ? `${ro.assignedTo.firstName} ${ro.assignedTo.lastName}` : "Unassigned"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Mileage In</p>
                <p className="font-medium">{ro.mileageIn ? ro.mileageIn.toLocaleString() : "-"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Created At</p>
                <p className="font-medium">{new Date(ro.createdAt).toLocaleDateString()}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}