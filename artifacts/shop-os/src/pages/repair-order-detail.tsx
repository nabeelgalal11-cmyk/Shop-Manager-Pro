import { useState, useRef, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRepairOrder, getGetRepairOrderQueryKey,
  useUpdateRepairOrderIntake,
  useCreateRepairOrderRevision,
  useCompleteRepairOrderWorkflow,
  useCancelRepairOrderWorkflow,
  useCreateRepairOrderFinalInvoice,
  usePerformRepairOrderWorkItem,
  useGetCustomer,
  useGetVehicle,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Printer, Trash2, Plus, Save, FileText, Receipt, CreditCard, ExternalLink, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ActivityTimeline } from "@/components/activity-timeline";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

function fmtUsd(n: number | string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));
}

export default function RepairOrderDetail() {
  const [match, params] = useRoute("/repair-orders/:id");
  const id = match ? parseInt(params.id) : 0;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);

  const { data: workflow, isLoading } = useGetRepairOrder(id, {
    query: { enabled: !!id, queryKey: getGetRepairOrderQueryKey(id) },
  });

  const { data: customer } = useGetCustomer(workflow?.repairOrder?.customerId as number, {
    query: { enabled: !!workflow?.repairOrder?.customerId }
  });

  const { data: vehicle } = useGetVehicle(workflow?.repairOrder?.vehicleId as number, {
    query: { enabled: !!workflow?.repairOrder?.vehicleId }
  });

  const updateIntake = useUpdateRepairOrderIntake();
  const createRevision = useCreateRepairOrderRevision();
  const completeWorkflow = useCompleteRepairOrderWorkflow();
  const cancelWorkflow = useCancelRepairOrderWorkflow();
  const createInvoice = useCreateRepairOrderFinalInvoice();
  const performWork = usePerformRepairOrderWorkItem();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<"normal" | "high" | "urgent">("normal");

  // Sync state when workflow loads
  useEffect(() => {
    if (workflow?.repairOrder) {
      setDiagnosis(workflow.repairOrder.diagnosis || "");
      setNotes(workflow.repairOrder.notes || "");
      setPriority(workflow.repairOrder.priority as any);
    }
  }, [workflow?.repairOrder]);

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!workflow) {
    return <div className="p-8 text-center">Repair Order not found</div>;
  }

  const { repairOrder, revisions, workItems, invoice } = workflow;
  const customerName = customer ? `${customer.firstName} ${customer.lastName}` : `Customer #${repairOrder.customerId}`;
  const vehicleName = vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : `Vehicle #${repairOrder.vehicleId}`;

  const handleSaveIntake = () => {
    updateIntake.mutate(
      {
        id,
        data: {
          version: repairOrder.version,
          diagnosis,
          notes,
          priority
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetRepairOrderQueryKey(id) });
          toast({ title: "Repair order updated" });
        },
        onError: (err: any) => toast({ title: "Failed to update", description: err.message, variant: "destructive" }),
      }
    );
  };

  const handleCreateRevision = () => {
    createRevision.mutate(
      { id, data: { kind: "estimate", taxRateBps: 850 } }, // Defaulting to 8.5%
      {
        onSuccess: (revision: any) => {
          toast({ title: "New revision created" });
          setLocation(`/estimates/${revision.id}`);
        },
        onError: (err: any) => toast({ title: "Failed to create revision", description: err.message, variant: "destructive" }),
      }
    );
  };

  const handleComplete = () => {
    if (!confirm("Are you sure you want to complete this repair order? All authorized work should be marked as performed.")) return;
    completeWorkflow.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRepairOrderQueryKey(id) });
        toast({ title: "Repair order completed" });
      },
      onError: (err: any) => toast({ title: "Failed to complete", description: err.message, variant: "destructive" }),
    });
  };

  const handleCancel = () => {
    if (!cancelReason.trim()) return toast({ title: "Reason required", variant: "destructive" });
    cancelWorkflow.mutate({ id, data: { reason: cancelReason } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRepairOrderQueryKey(id) });
        toast({ title: "Repair order cancelled" });
        setCancelOpen(false);
      },
      onError: (err: any) => toast({ title: "Failed to cancel", description: err.message, variant: "destructive" }),
    });
  };

  const handleCreateInvoice = () => {
    createInvoice.mutate({ id }, {
      onSuccess: (inv: any) => {
        queryClient.invalidateQueries({ queryKey: getGetRepairOrderQueryKey(id) });
        toast({ title: "Final invoice created" });
        setLocation(`/invoices/${inv.id}`);
      },
      onError: (err: any) => toast({ title: "Failed to create invoice", description: err.message, variant: "destructive" }),
    });
  };

  const handlePerformWork = (workItemId: number) => {
    performWork.mutate({ workItemId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRepairOrderQueryKey(id) });
        toast({ title: "Work marked as performed" });
      },
      onError: (err: any) => toast({ title: "Failed to perform work", description: err.message, variant: "destructive" }),
    });
  };


  const handlePrint = () => {
    const el = printRef.current;
    if (!el) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Repair Order ${repairOrder.orderNumber}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            h1 { font-size: 22px; margin-bottom: 4px; }
            h2 { font-size: 16px; margin: 16px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
            .meta { color: #555; font-size: 13px; margin-bottom: 16px; }
            .box { background: #f9f9f9; border: 1px solid #ddd; border-radius: 4px; padding: 12px; font-size: 13px; min-height: 60px; white-space: pre-wrap; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>${el.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); }, 300);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/repair-orders")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">RO: {repairOrder.orderNumber}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="capitalize">
                {repairOrder.status.replace("_", " ")}
              </Badge>
              <span className="text-sm text-muted-foreground">{customerName} &bull; {vehicleName}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
          {repairOrder.status !== "completed" && repairOrder.status !== "cancelled" && (
            <>
              <Button className="bg-green-600 hover:bg-green-700" onClick={handleComplete} disabled={completeWorkflow.isPending}>
                <CheckCircle2 className="h-4 w-4 mr-2" /> Complete RO
              </Button>
              <Button variant="destructive" onClick={() => setCancelOpen(true)} disabled={cancelWorkflow.isPending}>
                <XCircle className="h-4 w-4 mr-2" /> Cancel RO
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader className="bg-muted/20 border-b pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Estimates &amp; Revisions</CardTitle>
                </div>
                <Button size="sm" onClick={handleCreateRevision} disabled={createRevision.isPending}>
                  <Plus className="h-4 w-4 mr-1.5" /> New Estimate
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-5 space-y-5">
              {revisions.length > 0 ? (
                <div className="space-y-2">
                  {revisions.map((rev: any) => (
                    <button
                      key={rev.id}
                      type="button"
                      onClick={() => setLocation(`/estimates/${rev.id}`)}
                      className="w-full flex items-center justify-between gap-3 rounded-md border p-3 text-left hover:bg-muted/30"
                    >
                      <div>
                        <p className="font-medium text-sm capitalize">{rev.kind} #{rev.revisionNo}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="capitalize">
                          {rev.status.replace("_", " ")}
                        </Badge>
                        <span className="font-semibold text-sm">{fmtUsd(rev.total)}</span>
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No revisions yet. Create an estimate to begin.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="bg-muted/20 border-b pb-3">
              <CardTitle className="text-base">Authorized Work Items</CardTitle>
            </CardHeader>
            <CardContent className="pt-5 space-y-4">
              {workItems.length > 0 ? (
                <div className="space-y-3">
                  {workItems.map((item: any) => (
                    <div key={item.id} className="flex items-center justify-between border rounded p-3">
                      <div>
                        <p className="font-medium text-sm">{item.description}</p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {item.kind} &bull; Qty: {item.quantity} &bull; {fmtUsd(item.unitPrice)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={item.status === "performed" ? "default" : "outline"} className="capitalize">
                          {item.status}
                        </Badge>
                        {item.status === "authorized" && repairOrder.status !== "completed" && (
                          <Button size="sm" variant="outline" onClick={() => handlePerformWork(item.id)} disabled={performWork.isPending}>
                            <CheckCircle2 className="h-4 w-4 mr-1.5" /> Mark Performed
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No authorized work yet. Customer must approve an estimate.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="bg-muted/20 border-b pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">Final Invoice</CardTitle>
                {!invoice && repairOrder.status === "completed" && (
                  <Button size="sm" onClick={handleCreateInvoice} disabled={createInvoice.isPending}>
                    <Receipt className="h-4 w-4 mr-1.5" /> Create Final Invoice
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-5 space-y-5">
              {invoice ? (
                <button
                  type="button"
                  onClick={() => setLocation(`/invoices/${invoice.id}`)}
                  className="w-full flex items-center justify-between gap-3 rounded-md border p-3 text-left hover:bg-muted/30"
                >
                  <div>
                    <p className="font-medium text-sm">{invoice.invoiceNumber}</p>
                    <p className="text-xs text-muted-foreground">Balance: {fmtUsd(invoice.balance)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={invoice.status === "paid" ? "default" : "secondary"} className="capitalize">
                      {invoice.status}
                    </Badge>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {repairOrder.status === "completed"
                    ? "Repair order is completed. Create the final invoice to bill the customer."
                    : "Complete the repair order first to generate a final invoice."}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="bg-muted/20 border-b pb-3">
              <CardTitle className="text-base">Intake Details</CardTitle>
            </CardHeader>
            <CardContent className="pt-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Priority</label>
                <Select value={priority} onValueChange={(v: any) => setPriority(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Customer Complaint</label>
                <div className="p-3 bg-muted/30 rounded-md border text-sm min-h-[70px] whitespace-pre-wrap">
                  {repairOrder.complaint || <span className="text-muted-foreground">No complaint recorded.</span>}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Technician Diagnosis</label>
                <Textarea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Internal Notes</label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <Button className="w-full" onClick={handleSaveIntake} disabled={updateIntake.isPending}>
                <Save className="h-4 w-4 mr-2" /> {updateIntake.isPending ? "Saving..." : "Save Intake"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Repair Order</DialogTitle>
            <DialogDescription>
              Provide a reason for cancellation. This will halt all active workflows.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Textarea
                placeholder="Reason..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={cancelWorkflow.isPending}>
              Confirm Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ActivityTimeline
        entityType="repair_order"
        entityId={repairOrder.id}
        description="Workflow changes and events for this repair order."
      />

      <div ref={printRef} style={{ display: "none" }}>
        <h1>Repair Order: {repairOrder.orderNumber}</h1>
        <div className="meta">
          Customer ID: {repairOrder.customerId} &bull;
          Vehicle ID: {repairOrder.vehicleId} &bull;
          Status: {repairOrder.status}
        </div>
        <h2>Customer Complaint</h2>
        <div className="box">{repairOrder.complaint || "None"}</div>
        <h2>Diagnosis</h2>
        <div className="box">{repairOrder.diagnosis || "None"}</div>
      </div>
    </div>
  );
}
