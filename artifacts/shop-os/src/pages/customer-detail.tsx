import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useGetCustomer, getGetCustomerQueryKey,
  useGetCustomerVehicles, getGetCustomerVehiclesQueryKey,
  useGetCustomerStatement, getGetCustomerStatementQueryKey,
  useDeleteCustomer, useUpdateCustomer,
  type UpdateCustomerInput,
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
import { ArrowLeft, Edit, Trash2, Phone, Mail, MapPin, Car, FileText, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AttachmentsPanel } from "@/components/attachments-panel";
import { ActivityTimeline } from "@/components/activity-timeline";
import { CustomerMessageThread } from "@/components/customer-message-thread";

export default function CustomerDetail() {
  const [match, params] = useRoute("/customers/:id");
  const id = match ? parseInt(params.id) : 0;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  type EditForm = Omit<UpdateCustomerInput, "categoryId"> & { categoryId: string };
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    notes: "",
    categoryId: "none",
    preferredChannel: "email",
    smsOptOut: "false",
  });

  const { data: customer, isLoading } = useGetCustomer(id, {
    query: { enabled: !!id, queryKey: getGetCustomerQueryKey(id) },
  });

  const { data: categories = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/customer-categories"],
    queryFn: () => fetch("/api/customer-categories").then(r => r.json()),
  });
  const customerCategoryName = customer?.categoryId
    ? categories.find(c => c.id === customer.categoryId)?.name
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
      categoryId: customer?.categoryId ? String(customer.categoryId) : "none",
      preferredChannel: (customer?.preferredChannel as "email" | "sms" | "both") ?? "email",
      smsOptOut: customer?.smsOptOut ?? "false",
    });
    setEditOpen(true);
  };

  const handleSave = () => {
    const { categoryId, ...rest } = editForm;
    const payload: UpdateCustomerInput = {
      ...rest,
      categoryId: categoryId && categoryId !== "none" ? Number(categoryId) : null,
    };
    updateCustomer.mutate({ id, data: payload }, {
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

  const handlePrint = () => {
    if (!customer) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const esc = (s: any) => String(s ?? "").replace(/</g, "&lt;");
    const vehicleRows = (vehicles || [])
      .map((v: any) => `<tr><td>${v.year ?? ""} ${esc(v.make)} ${esc(v.model)}</td><td>${esc(v.licensePlate)}</td><td>${esc(v.vin)}</td></tr>`)
      .join("");
    const stmt: any = statement || {};
    const stmtRows = (stmt.invoices || [])
      .map((i: any) => `<tr><td>${esc(i.invoiceNumber)}</td><td>${i.issuedAt ? new Date(i.issuedAt).toLocaleDateString() : ""}</td><td>${esc(i.status)}</td><td style="text-align:right">${formatCurrency(i.total ?? 0)}</td><td style="text-align:right">${formatCurrency(i.balance ?? 0)}</td></tr>`)
      .join("");
    w.document.write(`
      <html><head><title>Customer ${esc(customer.firstName)} ${esc(customer.lastName)}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;color:#111}
        h1{font-size:22px;margin:0 0 4px}
        h2{font-size:15px;margin:18px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px}
        .meta{color:#555;font-size:13px;margin-bottom:14px}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 20px;margin-bottom:14px;font-size:13px}
        .label{font-size:11px;color:#888;text-transform:uppercase}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th{background:#f0f0f0;text-align:left;padding:6px 8px;font-size:12px}
        td{padding:6px 8px;border-bottom:1px solid #eee}
        @media print{body{padding:0}}
      </style></head><body>
        <h1>${esc(customer.firstName)} ${esc(customer.lastName)}</h1>
        <div class="meta">Customer ID: ${customer.id}${customerCategoryName ? ` &bull; ${esc(customerCategoryName)}` : ""}</div>
        <h2>Contact</h2>
        <div class="grid">
          <div><div class="label">Phone</div>${esc(customer.phone) || "—"}</div>
          <div><div class="label">Email</div>${esc(customer.email) || "—"}</div>
          <div style="grid-column:1/-1"><div class="label">Address</div>${esc(customer.address) || "—"}${customer.city ? `, ${esc(customer.city)}` : ""}${customer.state ? ` ${esc(customer.state)}` : ""}${customer.zip ? ` ${esc(customer.zip)}` : ""}</div>
          ${customer.notes ? `<div style="grid-column:1/-1"><div class="label">Notes</div>${esc(customer.notes)}</div>` : ""}
        </div>
        <h2>Vehicles</h2>
        ${vehicleRows ? `<table><thead><tr><th>Vehicle</th><th>Plate</th><th>VIN</th></tr></thead><tbody>${vehicleRows}</tbody></table>` : `<div style="color:#888;font-size:13px">No vehicles.</div>`}
        <h2>Account Statement</h2>
        ${stmtRows ? `<table><thead><tr><th>Invoice #</th><th>Date</th><th>Status</th><th style="text-align:right">Total</th><th style="text-align:right">Balance</th></tr></thead><tbody>${stmtRows}</tbody></table>` : `<div style="color:#888;font-size:13px">No invoices.</div>`}
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

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
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
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

      {id > 0 && (
        <div id="messages">
          <CustomerMessageThread customerId={id} />
        </div>
      )}

      {id > 0 && (
        <AttachmentsPanel
          ownerType="customer"
          ownerId={id}
          title="Photos & Documents"
          description="Driver's license, insurance card, signed forms, or any related PDFs/photos."
        />
      )}

      {id > 0 && (
        <ActivityTimeline
          entityType="customer"
          entityId={id}
          description="Recent activity touching this customer's records."
        />
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label>First Name</Label>
              <Input value={editForm.firstName || ""} onChange={e => setEditForm(f => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name</Label>
              <Input value={editForm.lastName || ""} onChange={e => setEditForm(f => ({ ...f, lastName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={editForm.email || ""} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={editForm.phone || ""} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Street Address</Label>
              <Input value={editForm.address || ""} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={editForm.city || ""} onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input maxLength={2} value={editForm.state || ""} onChange={e => setEditForm(f => ({ ...f, state: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>ZIP</Label>
                <Input value={editForm.zip || ""} onChange={e => setEditForm(f => ({ ...f, zip: e.target.value }))} />
              </div>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Pricing Category</Label>
              <Select
                value={editForm.categoryId || "none"}
                onValueChange={v => setEditForm(f => ({ ...f, categoryId: v }))}
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
            <div className="col-span-2 grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Preferred Channel</Label>
                <Select
                  value={editForm.preferredChannel || "email"}
                  onValueChange={v => setEditForm(f => ({ ...f, preferredChannel: v as "email" | "sms" | "both" }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email only</SelectItem>
                    <SelectItem value="sms">SMS only</SelectItem>
                    <SelectItem value="both">Email + SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>SMS Status</Label>
                <Select
                  value={editForm.smsOptOut || "false"}
                  onValueChange={v => setEditForm(f => ({ ...f, smsOptOut: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="false">Subscribed</SelectItem>
                    <SelectItem value="true">Opted out</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                rows={3}
                value={editForm.notes || ""}
                onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
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
