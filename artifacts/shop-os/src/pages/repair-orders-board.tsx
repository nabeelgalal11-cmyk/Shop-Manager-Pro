import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetRepairOrders,
  getGetRepairOrdersQueryKey,
  useUpdateRepairOrder,
  type UpdateRepairOrderInputStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, AlertTriangle, Clock, Wrench, CheckCircle2, ThumbsUp, List, LayoutGrid } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

type Status = "pending" | "in_progress" | "waiting_parts" | "awaiting_approval" | "completed";

const COLUMNS: Array<{ key: Status; title: string; icon: React.ReactNode; tone: string }> = [
  { key: "pending",            title: "Pending",            icon: <Clock className="h-3.5 w-3.5" />,         tone: "border-t-muted-foreground/40" },
  { key: "in_progress",        title: "In Progress",        icon: <Wrench className="h-3.5 w-3.5" />,        tone: "border-t-primary" },
  { key: "waiting_parts",      title: "Awaiting Parts",     icon: <AlertTriangle className="h-3.5 w-3.5" />, tone: "border-t-orange-500" },
  { key: "awaiting_approval",  title: "Awaiting Approval",  icon: <ThumbsUp className="h-3.5 w-3.5" />,      tone: "border-t-purple-500" },
  { key: "completed",          title: "Completed",          icon: <CheckCircle2 className="h-3.5 w-3.5" />,  tone: "border-t-green-600" },
];

const formatDate = (v: any) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

const priorityDot = (priority: string) => {
  switch (priority) {
    case "urgent": return "bg-destructive";
    case "high": return "bg-orange-500";
    case "low": return "bg-muted-foreground/40";
    default: return "bg-muted-foreground/60";
  }
};

export default function RepairOrdersBoard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const canEdit = can("repair_orders", "edit");
  const [dragOver, setDragOver] = useState<Status | null>(null);
  // Optimistic status overrides keyed by RO id (cleared once the server response refetches).
  const [optimistic, setOptimistic] = useState<Record<number, Status>>({});

  // Pull a generous page so the board is useful for typical shops; not a full virtualized board.
  const { data, isLoading } = useGetRepairOrders(
    { limit: 200, page: 1 },
    { query: { queryKey: getGetRepairOrdersQueryKey({ limit: 200, page: 1 }) } }
  );

  const updateRO = useUpdateRepairOrder();

  const grouped = useMemo(() => {
    const groups: Record<Status, any[]> = {
      pending: [], in_progress: [], waiting_parts: [], awaiting_approval: [], completed: [],
    };
    for (const ro of data?.data ?? []) {
      const status = (optimistic[ro.id] ?? ro.status) as Status;
      if (status in groups) groups[status].push({ ...ro, status });
    }
    return groups;
  }, [data, optimistic]);

  function onDragStart(e: React.DragEvent, ro: any) {
    if (!canEdit) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("text/ro-id", String(ro.id));
    e.dataTransfer.setData("text/ro-status", String(ro.status));
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: React.DragEvent, status: Status) {
    if (!canEdit) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOver !== status) setDragOver(status);
  }

  function onDrop(e: React.DragEvent, status: Status) {
    e.preventDefault();
    setDragOver(null);
    if (!canEdit) return;
    const idStr = e.dataTransfer.getData("text/ro-id");
    const fromStatus = e.dataTransfer.getData("text/ro-status") as Status;
    const id = Number(idStr);
    if (!id || fromStatus === status) return;

    setOptimistic(prev => ({ ...prev, [id]: status }));
    updateRO.mutate(
      { id, data: { status: status as UpdateRepairOrderInputStatus } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["/api/repair-orders"] });
          qc.invalidateQueries({ queryKey: getGetRepairOrdersQueryKey({ limit: 200, page: 1 }) });
          setOptimistic(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        },
        onError: () => {
          setOptimistic(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          toast({ title: "Failed to update status", variant: "destructive" });
        },
      }
    );
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Repair Orders</h1>
          <p className="text-muted-foreground mt-1">Drag a card to change its status.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-md border bg-background p-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-muted-foreground"
              onClick={() => {
                try { localStorage.setItem("repairOrdersView", "list"); } catch {}
                setLocation("/repair-orders");
              }}
            >
              <List className="h-4 w-4 mr-1.5" /> List
            </Button>
            <Button variant="default" size="sm" className="h-8 px-2">
              <LayoutGrid className="h-4 w-4 mr-1.5" /> Board
            </Button>
          </div>
          <Button onClick={() => setLocation("/repair-orders/new")} className="shadow-sm font-medium">
            <Plus className="mr-2 h-4 w-4" /> New Repair Order
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {COLUMNS.map(col => {
          const items = grouped[col.key];
          const isOver = dragOver === col.key;
          return (
            <div
              key={col.key}
              onDragOver={(e) => onDragOver(e, col.key)}
              onDragLeave={() => setDragOver(prev => (prev === col.key ? null : prev))}
              onDrop={(e) => onDrop(e, col.key)}
              className={`rounded-lg border-t-4 ${col.tone} bg-muted/20 flex flex-col min-h-[200px] transition-colors ${isOver ? "bg-primary/5 ring-2 ring-primary/30" : ""}`}
            >
              <div className="px-3 py-2.5 flex items-center justify-between border-b bg-background/40 rounded-t-md">
                <div className="flex items-center gap-1.5 font-semibold text-sm">
                  {col.icon} {col.title}
                </div>
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">{items.length}</Badge>
              </div>
              <div className="p-2 space-y-2 flex-1">
                {isLoading ? (
                  <>
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-20 w-full" />
                  </>
                ) : items.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-8">No repair orders</div>
                ) : (
                  items.map(ro => (
                    <Card
                      key={ro.id}
                      draggable={canEdit}
                      onDragStart={(e) => onDragStart(e, ro)}
                      onClick={() => setLocation(`/repair-orders/${ro.id}`)}
                      className={`p-3 shadow-sm hover:shadow-md transition-all cursor-pointer ${canEdit ? "active:cursor-grabbing" : ""} ${optimistic[ro.id] ? "opacity-70" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-mono text-xs font-semibold">{ro.orderNumber}</span>
                        <span className={`h-2 w-2 rounded-full ${priorityDot(ro.priority)}`} title={`Priority: ${ro.priority}`} />
                      </div>
                      <div className="text-sm font-medium leading-tight">
                        {ro.customer ? `${ro.customer.firstName} ${ro.customer.lastName}` : ro.usedCar ? `Internal · ${ro.usedCar.year} ${ro.usedCar.make} ${ro.usedCar.model}` : "Unknown"}
                      </div>
                      {ro.vehicle && (
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {ro.vehicle.year} {ro.vehicle.make} {ro.vehicle.model}
                        </div>
                      )}
                      {ro.complaint && (
                        <div className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{ro.complaint}</div>
                      )}
                      <div className="flex items-center justify-between mt-2 pt-2 border-t text-xs text-muted-foreground">
                        <span>{formatDate(ro.createdAt)}</span>
                        {ro.assignedTo ? (
                          <div className="flex items-center gap-1.5">
                            <div className="h-5 w-5 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-[10px] font-bold border border-border">
                              {ro.assignedTo.firstName[0]}{ro.assignedTo.lastName[0]}
                            </div>
                          </div>
                        ) : (
                          <span className="italic">Unassigned</span>
                        )}
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
