import { useRoute, useLocation } from "wouter";
import { 
  useGetCustomer, getGetCustomerQueryKey, 
  useGetCustomerVehicles, getGetCustomerVehiclesQueryKey,
  useGetCustomerStatement, getGetCustomerStatementQueryKey,
  useDeleteCustomer
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Edit, Trash2, Phone, Mail, MapPin, Car, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function CustomerDetail() {
  const [match, params] = useRoute("/customers/:id");
  const id = match ? parseInt(params.id) : 0;
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: customer, isLoading } = useGetCustomer(id, { 
    query: { enabled: !!id, queryKey: getGetCustomerQueryKey(id) } 
  });
  
  const { data: vehicles } = useGetCustomerVehicles(id, {
    query: { enabled: !!id, queryKey: getGetCustomerVehiclesQueryKey(id) }
  });

  const { data: statement } = useGetCustomerStatement(id, {
    query: { enabled: !!id, queryKey: getGetCustomerStatementQueryKey(id) }
  });

  const deleteCustomer = useDeleteCustomer();

  const handleDelete = () => {
    deleteCustomer.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Customer deleted" });
        setLocation("/customers");
      }
    });
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!customer) {
    return <div className="p-8 text-center">Customer not found</div>;
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/customers")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{customer.firstName} {customer.lastName}</h1>
            <p className="text-muted-foreground">Customer ID: {customer.id}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline"><Edit className="h-4 w-4 mr-2" /> Edit</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive"><Trash2 className="h-4 w-4 mr-2" /> Delete</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Customer</AlertDialogTitle>
                <AlertDialogDescription>Are you sure? This action cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-sm border-border md:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Contact Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <Phone className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="font-medium">{customer.phone || "No phone"}</p>
                <p className="text-xs text-muted-foreground">Primary</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="font-medium">{customer.email || "No email"}</p>
                <p className="text-xs text-muted-foreground">Email</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="font-medium">{customer.address || "No address"}</p>
                <p className="text-xs text-muted-foreground">
                  {customer.city ? `${customer.city}, ` : ''}{customer.state} {customer.zip}
                </p>
              </div>
            </div>
            {customer.notes && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-sm font-semibold mb-1">Notes</p>
                <p className="text-sm text-muted-foreground">{customer.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border md:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Financial Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-muted/20 rounded-lg border">
                <p className="text-sm text-muted-foreground mb-1">Total Billed</p>
                <p className="text-2xl font-bold">{formatCurrency(statement?.totalBilled || 0)}</p>
              </div>
              <div className="p-4 bg-muted/20 rounded-lg border">
                <p className="text-sm text-muted-foreground mb-1">Total Paid</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(statement?.totalPaid || 0)}</p>
              </div>
              <div className="p-4 bg-muted/20 rounded-lg border">
                <p className="text-sm text-muted-foreground mb-1">Outstanding Balance</p>
                <p className={`text-2xl font-bold ${(statement?.balance || 0) > 0 ? "text-destructive" : ""}`}>
                  {formatCurrency(statement?.balance || 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="vehicles" className="w-full">
        <TabsList className="w-full justify-start border-b rounded-none h-12 bg-transparent p-0">
          <TabsTrigger value="vehicles" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none shadow-none bg-transparent">
            <Car className="h-4 w-4 mr-2" /> Vehicles
          </TabsTrigger>
          <TabsTrigger value="invoices" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none shadow-none bg-transparent">
            <FileText className="h-4 w-4 mr-2" /> Invoices
          </TabsTrigger>
        </TabsList>
        <TabsContent value="vehicles" className="mt-6">
          <Card className="shadow-sm border-border">
            <div className="p-4 border-b flex justify-between items-center bg-muted/20">
              <h3 className="font-semibold">Customer Vehicles</h3>
              <Button size="sm" onClick={() => setLocation("/vehicles/new")}><Car className="h-4 w-4 mr-2" /> Add Vehicle</Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>VIN / Plate</TableHead>
                  <TableHead>Color</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles?.length ? vehicles.map(v => (
                  <TableRow key={v.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/vehicles/${v.id}`)}>
                    <TableCell className="font-medium">{v.year} {v.make} {v.model}</TableCell>
                    <TableCell>
                      {v.licensePlate && <Badge variant="outline" className="mr-2">{v.licensePlate}</Badge>}
                      <span className="text-xs text-muted-foreground">{v.vin}</span>
                    </TableCell>
                    <TableCell>{v.color || '-'}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No vehicles found.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
        <TabsContent value="invoices" className="mt-6">
          <Card className="shadow-sm border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statement?.invoices?.length ? statement.invoices.map(inv => (
                  <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/invoices/${inv.id}`)}>
                    <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                    <TableCell>{new Date(inv.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>{formatCurrency(inv.total)}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{inv.status}</Badge></TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No invoices found.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}