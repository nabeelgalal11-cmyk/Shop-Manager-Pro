import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useGetCustomer, getGetCustomerQueryKey,
  useGetCustomerVehicles, getGetCustomerVehiclesQueryKey,
  useGetCustomerStatement, getGetCustomerStatementQueryKey,
  useDeleteCustomer, useUpdateCustomer,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Edit, Trash2, Phone, Mail, MapPin, Car, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function CustomerDetail() {
  const [match, params] = useRoute("/customers/:id");
  const id = match ? parseInt(params.id) : 0;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<any>({});

  const { data: customer, isLoading } = useGetCustomer(id, {
    query: { enabled: !!id, queryKey: getGetCustomerQueryKey(id) },
  });

  const { data: categories = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/customer-categories"],
    queryFn: () => fetch("/api/customer-categories").then(r => r.json()),
  });
  const customerCategoryName = (customer as any)?.categoryId
    ? categories.find(c => c.id === (customer as any).categoryId)?.name
    : null;

  const { data: vehicles } = useGetCustomerVehicles(id, {
    query: { enabled: !!id, queryKey: getGetCustomerVehiclesQueryKey(id) },
  });

  const { data: statement } = useGetCustomerStatement(id, {
    query: { enabled: !!id, queryKey: getGetCustomerStatementQueryKey(id) },
  });

  const deleteCustomer = useDeleteCustomer();
  const updateCustomer = useUpdateCustomer();

  const handleDelete = () => {
    deleteCustomer.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Customer deleted" });
        setLocation("/customers");
      },
    });
  };

  const openEdit = () => {
    setEditForm({
      firstName: customer?.firstName ?? "",
      lastName: customer?.lastName ?? "",
      email: customer?.email ?? "",
      phone: customer?.phone ?? "",
      address: customer?.address ?? "",
      city: customer?.city ?? "",
      state: customer?.state ?? "",
      zip: customer?.zip ?? "",
      notes: customer?.notes ?? "",
      categoryId: (customer as any)?.categoryId ? String((customer as any).categoryId) : "none",
    });
    setEditOpen(true);
  };

  const handleSave = () => {
    const { categoryId, ...rest } = editForm;
    const payload = {
      ...rest,
      categoryId: categoryId && categoryId !== "none" ? Number(categoryId) : null,
    };
    updateCustomer.mutate({ id, data: payload as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCustomerQueryKey(id) });
        toast({ title: "Customer updated" });
        setEditOpen(false);
      },
      onError: () => toast({ title: "Failed to update", variant: "destructive" }),
    });
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!customer) return <div className="p-8 text-center">Customer not found</div>;

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
          <Button variant="outline" onClick={openEdit}>
            <Edit className="h-4 w-4 mr-2" /> Edit
          </Button>
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
          <CardHeader><CardTitle className="text-lg">Contact Info</CardTitle></CardHeader>
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
                  {customer.city ? `${customer.city}, ` : ""}{customer.state} {customer.zip}
                </p>
              </div>
            </div>
            {customerCategoryName && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-sm font-semibold mb-1">Pricing Category</p>
                <Badge variant="secondary">{customerCategoryName}</Badge>
              </div>
            )}
            {customer.notes && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-sm font-semibold mb-1">Notes</p>
                <p className="text-sm text-muted-foreground">{customer.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border md:col-span-2">
          <CardHeader><CardTitle className="text-lg">Financial Overview</CardTitle></CardHeader>
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
              <Button size="sm" onClick={() => setLocation("/vehicles/new")}>
                <Car className="h-4 w-4 mr-2" /> Add Vehicle
              </Button>
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
                    <TableCell>{v.color || "-"}</TableCell>
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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label>First Name</Label>
              <Input value={editForm.firstName || ""} onChange={e => setEditForm((f: any) => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name</Label>
              <Input value={editForm.lastName || ""} onChange={e => setEditForm((f: any) => ({ ...f, lastName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={editForm.email || ""} onChange={e => setEditForm((f: any) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={editForm.phone || ""} onChange={e => setEditForm((f: any) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Street Address</Label>
              <Input value={editForm.address || ""} onChange={e => setEditForm((f: any) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={editForm.city || ""} onChange={e => setEditForm((f: any) => ({ ...f, city: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input maxLength={2} value={editForm.state || ""} onChange={e => setEditForm((f: any) => ({ ...f, state: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>ZIP</Label>
                <Input value={editForm.zip || ""} onChange={e => setEditForm((f: any) => ({ ...f, zip: e.target.value }))} />
              </div>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Pricing Category</Label>
              <Select
                value={editForm.categoryId || "none"}
                onValueChange={v => setEditForm((f: any) => ({ ...f, categoryId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a category..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {categories.map(cat => (
                    <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                rows={3}
                value={editForm.notes || ""}
                onChange={e => setEditForm((f: any) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={updateCustomer.isPending}>
              {updateCustomer.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
