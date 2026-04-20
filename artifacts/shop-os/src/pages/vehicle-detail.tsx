import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetVehicle, getGetVehicleQueryKey,
  useGetVehicleServiceHistory, getGetVehicleServiceHistoryQueryKey,
  useDeleteVehicle, useUpdateVehicle,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Edit, Trash2, Wrench } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function VehicleDetail() {
  const [match, params] = useRoute("/vehicles/:id");
  const id = match ? parseInt(params.id) : 0;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<any>({});

  const { data: vehicle, isLoading } = useGetVehicle(id, {
    query: { enabled: !!id, queryKey: getGetVehicleQueryKey(id) },
  });

  const { data: history } = useGetVehicleServiceHistory(id, {
    query: { enabled: !!id, queryKey: getGetVehicleServiceHistoryQueryKey(id) },
  });

  const deleteVehicle = useDeleteVehicle();
  const updateVehicle = useUpdateVehicle();

  const handleDelete = () => {
    deleteVehicle.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Vehicle deleted" });
        setLocation("/vehicles");
      },
    });
  };

  const openEdit = () => {
    setEditForm({
      year: vehicle?.year ?? new Date().getFullYear(),
      make: vehicle?.make ?? "",
      model: vehicle?.model ?? "",
      color: vehicle?.color ?? "",
      vin: vehicle?.vin ?? "",
      licensePlate: vehicle?.licensePlate ?? "",
      fleetNumber: vehicle?.fleetNumber ?? "",
      mileage: vehicle?.mileage ?? "",
      engineType: vehicle?.engineType ?? "",
      transmissionType: vehicle?.transmissionType ?? "",
    });
    setEditOpen(true);
  };

  const handleSave = () => {
    updateVehicle.mutate({ id, data: editForm }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetVehicleQueryKey(id) });
        toast({ title: "Vehicle updated" });
        setEditOpen(false);
      },
      onError: () => toast({ title: "Failed to update", variant: "destructive" }),
    });
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!vehicle) return <div className="p-8 text-center">Vehicle not found</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/vehicles")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h1>
            <p className="text-muted-foreground">
              {vehicle.customer ? `${vehicle.customer.firstName} ${vehicle.customer.lastName}` : "No Owner"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openEdit}>
            <Edit className="h-4 w-4 mr-2" /> Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive"><Trash2 className="h-4 w-4 mr-2" /> Delete</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Vehicle</AlertDialogTitle>
                <AlertDialogDescription>Are you sure? This action cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-sm border-border md:col-span-1">
          <CardHeader><CardTitle className="text-lg">Vehicle Details</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-muted-foreground mb-1">VIN</p>
              <p className="font-mono">{vehicle.vin || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">License Plate</p>
              <p className="font-mono">{vehicle.licensePlate || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Fleet #</p>
              {vehicle.fleetNumber
                ? <Badge variant="secondary" className="font-mono">{vehicle.fleetNumber}</Badge>
                : <p className="font-medium text-muted-foreground">—</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-muted-foreground mb-1">Color</p>
                <p className="font-medium">{vehicle.color || "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">Mileage</p>
                <p className="font-medium">{vehicle.mileage ? vehicle.mileage.toLocaleString() + " mi" : "—"}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-muted-foreground mb-1">Engine</p>
                <p className="font-medium">{vehicle.engineType || "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">Transmission</p>
                <p className="font-medium">{vehicle.transmissionType || "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Service History</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setLocation("/repair-orders/new")}>
              <Wrench className="h-4 w-4 mr-2" /> New RO
            </Button>
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
                <TableRow
                  key={entry.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => entry.repairOrderId && setLocation(`/repair-orders/${entry.repairOrderId}`)}
                >
                  <TableCell className="font-medium">{new Date(entry.date).toLocaleDateString()}</TableCell>
                  <TableCell>{entry.serviceType}</TableCell>
                  <TableCell>{entry.mileage ? entry.mileage.toLocaleString() + " mi" : "—"}</TableCell>
                  <TableCell className="text-right">{entry.cost ? formatCurrency(entry.cost) : "—"}</TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No service history.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Vehicle</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Year</Label>
              <Input
                type="number"
                value={editForm.year || ""}
                onChange={e => setEditForm((f: any) => ({ ...f, year: Number(e.target.value) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Make</Label>
              <Input value={editForm.make || ""} onChange={e => setEditForm((f: any) => ({ ...f, make: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Model</Label>
              <Input value={editForm.model || ""} onChange={e => setEditForm((f: any) => ({ ...f, model: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <Input value={editForm.color || ""} onChange={e => setEditForm((f: any) => ({ ...f, color: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Mileage</Label>
              <Input
                type="number"
                value={editForm.mileage || ""}
                onChange={e => setEditForm((f: any) => ({ ...f, mileage: Number(e.target.value) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>License Plate</Label>
              <Input value={editForm.licensePlate || ""} onChange={e => setEditForm((f: any) => ({ ...f, licensePlate: e.target.value }))} />
            </div>
            <div className="col-span-3 space-y-1.5">
              <Label>VIN</Label>
              <Input value={editForm.vin || ""} onChange={e => setEditForm((f: any) => ({ ...f, vin: e.target.value }))} />
            </div>
            <div className="col-span-3 space-y-1.5">
              <Label>Fleet # <span className="text-xs text-muted-foreground font-normal">(leave blank if not a fleet vehicle)</span></Label>
              <Input placeholder="e.g. 042" value={editForm.fleetNumber || ""} onChange={e => setEditForm((f: any) => ({ ...f, fleetNumber: e.target.value }))} />
            </div>
            <div className="space-y-1.5 col-span-1">
              <Label>Engine Type</Label>
              <Input placeholder="e.g. 2.0L I4" value={editForm.engineType || ""} onChange={e => setEditForm((f: any) => ({ ...f, engineType: e.target.value }))} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Transmission</Label>
              <Select value={editForm.transmissionType || ""} onValueChange={val => setEditForm((f: any) => ({ ...f, transmissionType: val }))}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="automatic">Automatic</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="cvt">CVT</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={updateVehicle.isPending}>
              {updateVehicle.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
