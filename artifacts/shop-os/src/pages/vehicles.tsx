import { useGetVehicles, getGetVehiclesQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, ChevronRight, Car as CarIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Vehicles() {
  const [, setLocation] = useLocation();
  
  const { data, isLoading } = useGetVehicles(
    { limit: 50 },
    { query: { queryKey: getGetVehiclesQueryKey({ limit: 50 }) } }
  );

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Vehicles</h1>
          <p className="text-muted-foreground mt-1">All customer vehicles in the system.</p>
        </div>
        <Button onClick={() => setLocation("/vehicles/new")} className="shadow-sm font-medium">
          <Plus className="mr-2 h-4 w-4" /> Add Vehicle
        </Button>
      </div>

      <Card className="shadow-sm border-border">
        <div className="p-4 border-b flex items-center gap-4 bg-muted/20">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by VIN, plate, make, model..."
              className="pl-9 bg-background"
            />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Vehicle</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Identifiers</TableHead>
              <TableHead className="text-right">Mileage</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                  <TableCell></TableCell>
                </TableRow>
              ))
            ) : data?.data && data.data.length > 0 ? (
              data.data.map((vehicle) => (
                <TableRow 
                  key={vehicle.id} 
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setLocation(`/vehicles/${vehicle.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded bg-secondary flex items-center justify-center text-secondary-foreground border border-border">
                        <CarIcon className="h-5 w-5 opacity-50" />
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">
                          {vehicle.year} {vehicle.make} {vehicle.model}
                        </div>
                        {vehicle.color && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {vehicle.color} • {vehicle.engineType || 'Unknown Engine'}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {vehicle.customer ? (
                      <span className="font-medium">{vehicle.customer.firstName} {vehicle.customer.lastName}</span>
                    ) : (
                      <span className="text-muted-foreground italic">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {vehicle.licensePlate && (
                        <Badge variant="outline" className="font-mono text-xs px-1.5 py-0 rounded border-primary/20 text-primary bg-primary/5 mr-2">
                          {vehicle.licensePlate}
                        </Badge>
                      )}
                      {vehicle.vin && (
                        <div className="text-xs font-mono text-muted-foreground truncate max-w-[150px]" title={vehicle.vin}>
                          {vehicle.vin}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {vehicle.mileage ? vehicle.mileage.toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  No vehicles found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}