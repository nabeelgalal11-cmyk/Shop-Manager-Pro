import { useState } from "react";
import {
  useGetReminders, getGetRemindersQueryKey,
  useCreateReminder, useUpdateReminder, useDeleteReminder,
  useGetCustomers, getGetCustomersQueryKey,
  useGetVehicles, getGetVehiclesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Bell, CheckCheck, Clock, AlertTriangle, Trash2, SendHorizonal } from "lucide-react";

const SERVICE_TYPES = [
  "Oil Change", "Tire Rotation", "Brake Inspection", "Air Filter Replacement",
  "Cabin Filter Replacement", "Transmission Service", "Coolant Flush",
  "Battery Check", "Spark Plug Replacement", "Timing Belt Service",
  "Alignment", "Multi-Point Inspection", "Other",
];

type FilterTab = "all" | "pending" | "overdue" | "sent";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function isOverdue(dueDate: string, sent: boolean) {
  return !sent && dueDate < todayStr();
}

function urgencyLabel(dueDate: string, sent: boolean) {
  if (sent) return null;
  const diff = Math.ceil((new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "Due today";
  if (diff <= 7) return `Due in ${diff}d`;
  return null;
}

export default function Reminders() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<FilterTab>("all");
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading } = useGetReminders(
    { limit: 200 },
    { query: { queryKey: getGetRemindersQueryKey({ limit: 200 }) } }
  );
  const { data: customersData } = useGetCustomers(
    { limit: 200 },
    { query: { queryKey: getGetCustomersQueryKey({ limit: 200 }) } }
  );
  const { data: vehiclesData } = useGetVehicles(
    { limit: 200 },
    { query: { queryKey: getGetVehiclesQueryKey({ limit: 200 }) } }
  );

  const createReminder = useCreateReminder();
  const updateReminder = useUpdateReminder();
  const deleteReminder = useDeleteReminder();

  const allItems: any[] = Array.isArray(data) ? data : data?.data ?? [];
  const today = todayStr();
  const pending = allItems.filter(r => !r.sent && r.dueDate >= today);
  const overdue = allItems.filter(r => !r.sent && r.dueDate < today);
  const sent = allItems.filter(r => r.sent);

  const displayed =
    tab === "pending" ? pending :
    tab === "overdue" ? overdue :
    tab === "sent"    ? sent    : allItems;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getGetRemindersQueryKey({ limit: 200 }) });
  }

  function markSent(r: any) {
    updateReminder.mutate(
      { id: r.id, data: { customerId: r.customerId, vehicleId: r.vehicleId, serviceType: r.serviceType, dueDate: r.dueDate, dueMileage: r.dueMileage, notes: r.notes, sent: true } },
      {
        onSuccess: () => { toast({ title: "Marked as sent" }); invalidate(); },
        onError: () => toast({ title: "Error", variant: "destructive" }),
      }
    );
  }

  function remove(id: number) {
    deleteReminder.mutate(
      { id },
      {
        onSuccess: () => { toast({ title: "Reminder deleted" }); invalidate(); },
        onError: () => toast({ title: "Error", variant: "destructive" }),
      }
    );
  }

  const tabBtn = (t: FilterTab, label: string, count?: number, countColor?: string) => (
    <button
      className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
        tab === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
      onClick={() => setTab(t)}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className={`ml-1.5 rounded-full px-1.5 text-xs ${countColor}`}>{count}</span>
      )}
    </button>
  );

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Reminders</h1>
          <p className="text-muted-foreground">
            Service reminders for customers. Auto-created when repair orders are completed.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Reminder
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<Bell className="h-5 w-5 text-muted-foreground" />} label="Total" value={allItems.length} />
        <StatCard icon={<Clock className="h-5 w-5 text-blue-500" />}      label="Pending" value={pending.length} valueClass="text-blue-600" />
        <StatCard icon={<AlertTriangle className="h-5 w-5 text-red-500" />} label="Overdue" value={overdue.length} valueClass="text-red-600" />
        <StatCard icon={<CheckCheck className="h-5 w-5 text-green-500" />} label="Sent"    value={sent.length}    valueClass="text-green-600" />
      </div>

      {/* Filter tabs */}
      <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
        {tabBtn("all",     "All")}
        {tabBtn("pending", "Pending", pending.length, "bg-blue-100 text-blue-700")}
        {tabBtn("overdue", "Overdue", overdue.length, "bg-red-100 text-red-700")}
        {tabBtn("sent",    "Sent")}
      </div>

      {/* Table */}
      <Card className="shadow-sm border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Due Mileage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayed.map(r => {
              const overdueBadge = isOverdue(r.dueDate, r.sent);
              const urgency = urgencyLabel(r.dueDate, r.sent);
              return (
                <TableRow key={r.id} className={overdueBadge ? "bg-red-50/50" : ""}>
                  <TableCell className="font-medium">
                    {r.customer?.firstName} {r.customer?.lastName}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {r.vehicle ? `${r.vehicle.year} ${r.vehicle.make} ${r.vehicle.model}` : "—"}
                  </TableCell>
                  <TableCell>{r.serviceType}</TableCell>
                  <TableCell>
                    <div>
                      <p>{r.dueDate}</p>
                      {urgency && (
                        <p className={`text-xs font-medium ${overdueBadge ? "text-red-600" : "text-orange-500"}`}>
                          {urgency}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.dueMileage ? `${Number(r.dueMileage).toLocaleString()} mi` : "—"}
                  </TableCell>
                  <TableCell>
                    {r.sent ? (
                      <Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100">
                        <CheckCheck className="h-3 w-3 mr-1" /> Sent
                      </Badge>
                    ) : overdueBadge ? (
                      <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">
                        <AlertTriangle className="h-3 w-3 mr-1" /> Overdue
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-blue-600 border-blue-200">
                        <Clock className="h-3 w-3 mr-1" /> Pending
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      {!r.sent && (
                        <Button
                          size="sm" variant="outline"
                          className="h-7 gap-1 text-xs"
                          onClick={() => markSent(r)}
                          disabled={updateReminder.isPending}
                        >
                          <SendHorizonal className="h-3 w-3" /> Mark Sent
                        </Button>
                      )}
                      <Button
                        size="icon" variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => remove(r.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {displayed.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  {tab === "overdue"
                    ? "No overdue reminders — you're all caught up!"
                    : "No reminders found"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <NewReminderModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        customers={customersData?.data ?? []}
        vehicles={vehiclesData?.data ?? []}
        onCreate={(payload) => {
          createReminder.mutate(
            { data: payload },
            {
              onSuccess: () => { toast({ title: "Reminder created" }); setModalOpen(false); invalidate(); },
              onError: () => toast({ title: "Error", variant: "destructive" }),
            }
          );
        }}
        isPending={createReminder.isPending}
      />
    </div>
  );
}

function StatCard({ icon, label, value, valueClass }: {
  icon: React.ReactNode; label: string; value: number; valueClass?: string;
}) {
  return (
    <Card className="p-4 shadow-sm">
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-2xl font-bold ${valueClass ?? ""}`}>{value}</p>
        </div>
      </div>
    </Card>
  );
}

function NewReminderModal({ open, onClose, customers, vehicles, onCreate, isPending }: {
  open: boolean; onClose: () => void;
  customers: any[]; vehicles: any[];
  onCreate: (p: any) => void; isPending: boolean;
}) {
  const [customerId, setCustomerId] = useState("");
  const [vehicleId, setVehicleId]   = useState("");
  const [serviceType, setServiceType] = useState("");
  const [customService, setCustomService] = useState("");
  const [dueDate, setDueDate]       = useState("");
  const [dueMileage, setDueMileage] = useState("");
  const [notes, setNotes]           = useState("");

  function reset() {
    setCustomerId(""); setVehicleId(""); setServiceType("");
    setCustomService(""); setDueDate(""); setDueMileage(""); setNotes("");
  }

  function submit() {
    const svc = serviceType === "Other" ? customService.trim() : serviceType;
    if (!customerId || !svc || !dueDate) return;
    onCreate({
      customerId: Number(customerId),
      vehicleId: vehicleId ? Number(vehicleId) : undefined,
      serviceType: svc,
      dueDate,
      dueMileage: dueMileage ? Number(dueMileage) : undefined,
      notes: notes || undefined,
    });
    reset();
  }

  const filteredVehicles = vehicles.filter(v =>
    !customerId || String(v.customerId) === customerId
  );

  const canSubmit = customerId && serviceType && dueDate &&
    (serviceType !== "Other" || customService.trim());

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); reset(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Reminder</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Customer *</Label>
            <Select value={customerId} onValueChange={v => { setCustomerId(v); setVehicleId(""); }}>
              <SelectTrigger><SelectValue placeholder="Select customer…" /></SelectTrigger>
              <SelectContent>
                {customers.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.firstName} {c.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Vehicle</Label>
            <Select value={vehicleId} onValueChange={setVehicleId} disabled={!customerId}>
              <SelectTrigger><SelectValue placeholder={customerId ? "Select vehicle (optional)…" : "Select customer first"} /></SelectTrigger>
              <SelectContent>
                {filteredVehicles.map(v => (
                  <SelectItem key={v.id} value={String(v.id)}>
                    {v.year} {v.make} {v.model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Service Type *</Label>
            <Select value={serviceType} onValueChange={setServiceType}>
              <SelectTrigger><SelectValue placeholder="Select service…" /></SelectTrigger>
              <SelectContent>
                {SERVICE_TYPES.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {serviceType === "Other" && (
              <Input
                className="mt-2"
                placeholder="Describe the service…"
                value={customService}
                onChange={e => setCustomService(e.target.value)}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Due Date *</Label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Due Mileage</Label>
              <Input
                type="number" placeholder="e.g. 85000"
                value={dueMileage} onChange={e => setDueMileage(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              placeholder="Any additional notes…" rows={2}
              value={notes} onChange={e => setNotes(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { onClose(); reset(); }}>Cancel</Button>
            <Button onClick={submit} disabled={isPending || !canSubmit}>
              Save Reminder
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
