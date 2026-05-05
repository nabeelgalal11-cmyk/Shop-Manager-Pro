import { useState, useEffect } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAppointment, getGetAppointmentQueryKey,
  useUpdateAppointment,
  useDeleteAppointment,
  getGetAppointmentsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Calendar, Clock, User, Car, Wrench, Save, Trash2, ExternalLink } from "lucide-react";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "pending", label: "Pending Web Request" },
  { value: "scheduled", label: "Scheduled" },
  { value: "confirmed", label: "Confirmed" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No Show" },
];

function statusBadgeClass(s: string) {
  switch (s) {
    case "pending": return "bg-amber-500 hover:bg-amber-600 text-white";
    case "confirmed":
    case "scheduled": return "bg-blue-500 hover:bg-blue-600 text-white";
    case "in_progress": return "bg-indigo-500 hover:bg-indigo-600 text-white";
    case "completed": return "bg-emerald-600 hover:bg-emerald-700 text-white";
    case "cancelled":
    case "no_show": return "bg-zinc-400 hover:bg-zinc-500 text-white";
    default: return "";
  }
}

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AppointmentDetail() {
  const [match, params] = useRoute("/appointments/:id");
  const id = match ? parseInt(params.id) : 0;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: appointment, isLoading, isError } = useGetAppointment(id, {
    query: { queryKey: getGetAppointmentQueryKey(id), enabled: id > 0 },
  });

  const [status, setStatus] = useState<string>("");
  const [serviceType, setServiceType] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [estimatedDuration, setEstimatedDuration] = useState<string>("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!appointment) return;
    setStatus(appointment.status);
    setServiceType(appointment.serviceType);
    setScheduledAt(toLocalInput(appointment.scheduledAt));
    setEstimatedDuration(appointment.estimatedDuration != null ? String(appointment.estimatedDuration) : "");
    setDescription(appointment.description ?? "");
    setNotes(appointment.notes ?? "");
  }, [appointment]);

  const updateMutation = useUpdateAppointment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Appointment updated" });
        queryClient.invalidateQueries({ queryKey: getGetAppointmentQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetAppointmentsQueryKey() });
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to update appointment";
        toast({ title: message, variant: "destructive" });
      },
    },
  });

  const deleteMutation = useDeleteAppointment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Appointment deleted" });
        queryClient.invalidateQueries({ queryKey: getGetAppointmentsQueryKey() });
        setLocation("/appointments");
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to delete appointment";
        toast({ title: message, variant: "destructive" });
      },
    },
  });

  const handleSave = () => {
    if (!appointment) return;
    const dur = estimatedDuration.trim() === "" ? undefined : Number(estimatedDuration);
    updateMutation.mutate({
      id,
      data: {
        customerId: appointment.customerId,
        vehicleId: appointment.vehicleId,
        assignedToId: appointment.assignedToId,
        status,
        serviceType,
        description: description || undefined,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : appointment.scheduledAt,
        estimatedDuration: dur,
        notes: notes || undefined,
      },
    });
  };

  const quickSetStatus = (next: string) => {
    if (!appointment) return;
    updateMutation.mutate({
      id,
      data: {
        customerId: appointment.customerId,
        vehicleId: appointment.vehicleId,
        assignedToId: appointment.assignedToId,
        status: next,
        serviceType: appointment.serviceType,
        description: appointment.description ?? undefined,
        scheduledAt: appointment.scheduledAt,
        estimatedDuration: appointment.estimatedDuration ?? undefined,
        notes: appointment.notes ?? undefined,
      },
    });
    setStatus(next);
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !appointment) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/appointments")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to appointments
        </Button>
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            Appointment not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  const customerName = [appointment.customer?.firstName, appointment.customer?.lastName].filter(Boolean).join(" ") || "Unknown customer";
  const vehicleLabel = appointment.vehicle
    ? [appointment.vehicle.year, appointment.vehicle.make, appointment.vehicle.model].filter(Boolean).join(" ")
    : null;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/appointments")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Appointment #{appointment.id}</h1>
            <p className="text-sm text-muted-foreground">
              Created {new Date(appointment.createdAt).toLocaleString()}
            </p>
          </div>
        </div>
        <Badge className={`capitalize ${statusBadgeClass(status || appointment.status)}`}>
          {(status || appointment.status).replace("_", " ")}
        </Badge>
      </div>

      {appointment.status === "pending" && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="pt-6 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="font-medium text-amber-900">Pending web request</p>
              <p className="text-sm text-amber-800">
                Confirm to send the customer an email confirmation, or cancel to decline.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => quickSetStatus("confirmed")}
                disabled={updateMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700">
                Confirm
              </Button>
              <Button
                variant="outline"
                onClick={() => quickSetStatus("cancelled")}
                disabled={updateMutation.isPending}>
                Decline
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <User className="h-3 w-3" /> Customer
              </label>
              {appointment.customer ? (
                <Link href={`/customers/${appointment.customer.id}`}>
                  <span className="inline-flex items-center gap-1 font-medium hover:underline cursor-pointer">
                    {customerName} <ExternalLink className="h-3 w-3" />
                  </span>
                </Link>
              ) : <span className="text-muted-foreground">—</span>}
              {appointment.customer?.phone && (
                <p className="text-sm text-muted-foreground">{appointment.customer.phone}</p>
              )}
              {appointment.customer?.email && (
                <p className="text-sm text-muted-foreground">{appointment.customer.email}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Car className="h-3 w-3" /> Vehicle
              </label>
              {appointment.vehicle ? (
                <Link href={`/vehicles/${appointment.vehicle.id}`}>
                  <span className="inline-flex items-center gap-1 font-medium hover:underline cursor-pointer">
                    {vehicleLabel} <ExternalLink className="h-3 w-3" />
                  </span>
                </Link>
              ) : <span className="text-muted-foreground">Not specified</span>}
              {appointment.vehicle?.licensePlate && (
                <p className="text-sm text-muted-foreground">Plate: {appointment.vehicle.licensePlate}</p>
              )}
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Wrench className="h-3 w-3" /> Service Type
              </label>
              <Input value={serviceType} onChange={e => setServiceType(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Date &amp; Time
              </label>
              <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" /> Estimated Duration (mins)
              </label>
              <Input
                type="number"
                value={estimatedDuration}
                onChange={e => setEstimatedDuration(e.target.value)}
                placeholder="e.g. 60"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What's the customer asking about?"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Internal Notes</label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Notes for the team (not shown to the customer)"
              rows={3}
            />
          </div>

          <div className="flex justify-between items-center pt-2">
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4 mr-2" /> Delete
            </Button>
            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              <Save className="h-4 w-4 mr-2" />
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this appointment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove appointment #{appointment.id}. This action can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate({ id })}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
