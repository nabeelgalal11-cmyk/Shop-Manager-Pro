import { useRoute, useLocation } from "wouter";
import { 
  useGetVehicle, getGetVehicleQueryKey, 
  useGetVehicleServiceHistory, getGetVehicleServiceHistoryQueryKey,
  useDeleteVehicle
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Edit, Trash2, Car as CarIcon, Wrench } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function VehicleDetail() {
  const [match, params] = useRoute("/vehicles/:id");
  const id = match ? parseInt(params.id) : 0;
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: vehicle, isLoading } = useGetVehicle(id, { 
    query: { enabled: !!id, queryKey: getGetVehicleQueryKey(id) } 
  });
  
  const { data: history } = useGetVehicleServiceHistory(id, {
    query: { enabled: !!id, queryKey: getGetVehicleServiceHistoryQueryKey(id) }
  });

  const deleteVehicle = useDeleteVehicle();

  const handleDelete = () => {
    deleteVehicle.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Vehicle deleted" });
        setLocation("/vehicles");
      }
    });
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!vehicle) {
    return <div className="p-8 text-center">Vehicle not found</div>;
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/vehicles")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{vehicle.year} {vehicle.make} {vehicle.model}</h1>
            <p className="text-muted-foreground">{vehicle.customer ? `${vehicle.customer.firstName} ${vehicle.customer.lastName}` : "No Owner"}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline"><Edit className="h-4 w-4 mr-2" /> Edit</Button>
          <Button variant="destructive" onClick={handleDelete}><Trash2 className="h-4 w-4 mr-2" /> Delete</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-sm border-border md:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Vehicle Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">VIN</p>
              <p className="font-mono">{vehicle.vin || "-"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">License Plate</p>
              <p className="font-mono">{vehicle.licensePlate || "-"}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Color</p>
                <p className="font-medium">{vehicle.color || "-"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Mileage</p>
                <p className="font-medium">{vehicle.mileage ? vehicle.mileage.toLocaleString() : "-"}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Engine</p>
                <p className="font-medium">{vehicle.engineType || "-"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Transmission</p>
                <p className="font-medium">{vehicle.transmissionType || "-"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Service History</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setLocation("/repair-orders/new")}><Wrench className="h-4 w-4 mr-2" /> New RO</Button>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Mileage</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history?.length ? history.map(entry => (
                <TableRow key={entry.id} className="cursor-pointer hover:bg-muted/50" onClick={() => entry.repairOrderId && setLocation(`/repair-orders/${entry.repairOrderId}`)}>
                  <TableCell className="font-medium">{new Date(entry.date).toLocaleDateString()}</TableCell>
                  <TableCell>{entry.serviceType}</TableCell>
                  <TableCell>{entry.mileage ? entry.mileage.toLocaleString() : '-'}</TableCell>
                  <TableCell className="text-right">{entry.cost ? formatCurrency(entry.cost) : '-'}</TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No service history.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}