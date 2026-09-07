import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetRepairOrders,
  getGetRepairOrdersQueryKey,
  useGetEmployees,
  getGetEmployeesQueryKey,
  useGetBoardPreference,
  useUpdateBoardPreference,
  getGetBoardPreferenceQueryKey,
  type RepairOrder,
  type Employee,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Plus, AlertTriangle, Clock, Wrench, CheckCircle2, ThumbsUp, List, LayoutGrid, Users, UserX, Settings2, GripVertical, FileSearch, ShieldCheck, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

type Status = "open" | "diagnosing" | "awaiting_approval" | "authorized" | "in_progress" | "completed" | "cancelled";
type GroupMode = "status" | "technician";

type BoardOrder = RepairOrder & { status: Status };
type LaneCells = Record<Status, BoardOrder[]>;
type Lane = {
  key: string;
  title: string;
  tech: Employee | null;
  cells: LaneCells;
  total: number;
};

type ColumnDef = { key: Status; title: string; icon: React.ReactNode; tone: string };

const ALL_COLUMNS: ColumnDef[] = [
  { key: "open",               title: "Open",               icon: <Clock className="h-3.5 w-3.5" />,         tone: "border-t-muted-foreground/40" },
  { key: "diagnosing",         title: "Diagnosing",         icon: <FileSearch className="h-3.5 w-3.5" />,    tone: "border-t-blue-500" },
  { key: "awaiting_approval",  title: "Awaiting Approval",  icon: <AlertTriangle className="h-3.5 w-3.5" />, tone: "border-t-orange-500" },
  { key: "authorized",         title: "Authorized",         icon: <ShieldCheck className="h-3.5 w-3.5" />,   tone: "border-t-purple-500" },
  { key: "in_progress",        title: "In Progress",        icon: <Wrench className="h-3.5 w-3.5" />,        tone: "border-t-primary" },
  { key: "completed",          title: "Completed",          icon: <CheckCircle2 className="h-3.5 w-3.5" />,  tone: "border-t-green-600" },
  { key: "cancelled",          title: "Cancelled",          icon: <XCircle className="h-3.5 w-3.5" />,       tone: "border-t-destructive" },
];

const ALL_KEYS = ALL_COLUMNS.map(c => c.key);
const COLUMN_BY_KEY: Record<Status, ColumnDef> = ALL_COLUMNS.reduce(
  (acc, c) => { acc[c.key] = c; return acc; },
  {} as Record<Status, ColumnDef>,
);
const BOARD_KEY = "repair-orders-v2";

const UNASSIGNED_KEY = "unassigned";

function isStatus(s: string): s is Status {
  return (ALL_KEYS as string[]).includes(s);
}

function reconcileOrder(saved: string[]): Status[] {
  const seen = new Set<Status>();
  const out: Status[] = [];
  for (const k of saved) {
    if (isStatus(k) && !seen.has(k)) {
      out.push(k);
      seen.add(k);
    }
  }
  for (const k of ALL_KEYS) {
    if (!seen.has(k)) out.push(k);
  }
  return out;
}

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
  const [groupMode, setGroupMode] = useState<GroupMode>(() => {
    try {
      const v = localStorage.getItem("repairOrdersBoardGroup");
      return v === "technician" ? "technician" : "status";
    } catch { return "status"; }
  });

  const [columnDragOverKey, setColumnDragOverKey] = useState<Status | null>(null);
  const draggingColumnRef = useRef<Status | null>(null);

  const { data: prefData } = useGetBoardPreference(BOARD_KEY, {
    query: { queryKey: getGetBoardPreferenceQueryKey(BOARD_KEY) },
  });
  const updatePref = useUpdateBoardPreference();

  const [columnOrder, setColumnOrder] = useState<Status[]>(ALL_KEYS);
  const [hiddenColumns, setHiddenColumns] = useState<Set<Status>>(new Set());
  const prefHydratedRef = useRef(false);
  const userEditedRef = useRef(false);

  useEffect(() => {
    if (!prefData || prefHydratedRef.current || userEditedRef.current) return;
    prefHydratedRef.current = true;
    setColumnOrder(reconcileOrder(prefData.columnOrder ?? []));
    setHiddenColumns(
      new Set((prefData.hiddenColumns ?? []).filter(isStatus)),
    );
  }, [prefData]);

  function savePref(nextOrder: Status[], nextHidden: Set<Status>) {
    userEditedRef.current = true;
    updatePref.mutate(
      {
        boardKey: BOARD_KEY,
        data: {
          columnOrder: nextOrder,
          hiddenColumns: Array.from(nextHidden),
        },
      },
      {
        onError: () => {
          toast({ title: "Failed to save board layout", variant: "destructive" });
        },
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetBoardPreferenceQueryKey(BOARD_KEY) });
        },
      },
    );
  }

  const visibleColumns = useMemo<ColumnDef[]>(() => {
    return columnOrder
      .filter(k => !hiddenColumns.has(k))
      .map(k => COLUMN_BY_KEY[k]);
  }, [columnOrder, hiddenColumns]);

  function toggleColumnVisibility(key: Status, visible: boolean) {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (visible) next.delete(key);
      else next.add(key);
      savePref(columnOrder, next);
      return next;
    });
  }

  function onColumnHeaderDragStart(e: React.DragEvent, key: Status) {
    draggingColumnRef.current = key;
    e.dataTransfer.setData("text/board-col", key);
    e.dataTransfer.effectAllowed = "move";
  }

  function onColumnHeaderDragOver(e: React.DragEvent, key: Status) {
    if (!draggingColumnRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (columnDragOverKey !== key) setColumnDragOverKey(key);
  }

  function onColumnHeaderDrop(e: React.DragEvent, targetKey: Status) {
    e.preventDefault();
    e.stopPropagation();
    const fromKey = draggingColumnRef.current ?? (e.dataTransfer.getData("text/board-col") as Status);
    draggingColumnRef.current = null;
    setColumnDragOverKey(null);
    if (!fromKey || !isStatus(fromKey) || fromKey === targetKey) return;

    setColumnOrder(prev => {
      const next = prev.filter(k => k !== fromKey);
      const targetIdx = next.indexOf(targetKey);
      if (targetIdx === -1) next.push(fromKey);
      else next.splice(targetIdx, 0, fromKey);
      savePref(next, hiddenColumns);
      return next;
    });
  }

  const { data, isLoading } = useGetRepairOrders(
    { limit: 200, page: 1 },
    { query: { queryKey: getGetRepairOrdersQueryKey({ limit: 200, page: 1 }) } }
  );

  const { data: techData } = useGetEmployees(
    { role: "technician" },
    { query: { queryKey: getGetEmployeesQueryKey({ role: "technician" }) } }
  );

  const allTechs = useMemo<Employee[]>(() => {
    const list: Employee[] = Array.isArray(techData) ? techData : [];
    return list.filter(t => t.active !== false);
  }, [techData]);

  const setGroup = (mode: GroupMode) => {
    setGroupMode(mode);
    try { localStorage.setItem("repairOrdersBoardGroup", mode); } catch {}
  };

  const orders = useMemo<BoardOrder[]>(() => {
    return (data?.data ?? []).map((ro): BoardOrder => {
      // Coerce unknown statuses
      const status = isStatus(ro.status) ? ro.status as Status : "open";
      return { ...ro, status };
    });
  }, [data]);

  const groupedByStatus = useMemo(() => {
    const groups: Record<Status, BoardOrder[]> = {
      open: [], diagnosing: [], awaiting_approval: [], authorized: [], in_progress: [], completed: [], cancelled: [],
    };
    for (const ro of orders) {
      groups[ro.status].push(ro);
    }
    return groups;
  }, [orders]);

  const swimlanes = useMemo<Lane[]>(() => {
    const techMap = new Map<number, Employee>();
    for (const t of allTechs) techMap.set(t.id, t);
    for (const ro of orders) {
      if (ro.assignedToId != null && !techMap.has(ro.assignedToId) && ro.assignedTo) {
        techMap.set(ro.assignedToId, ro.assignedTo);
      }
    }
    const techs = Array.from(techMap.values()).sort((a, b) =>
      (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName)
    );

    const emptyCells = (): LaneCells => ({
      open: [], diagnosing: [], awaiting_approval: [], authorized: [], in_progress: [], completed: [], cancelled: [],
    });

    const lanes: Lane[] = [
      { key: UNASSIGNED_KEY, title: "Unassigned", tech: null, cells: emptyCells(), total: 0 },
      ...techs.map((t): Lane => ({ key: `t-${t.id}`, title: `${t.firstName} ${t.lastName}`, tech: t, cells: emptyCells(), total: 0 })),
    ];
    const byKey = new Map(lanes.map(l => [l.key, l]));

    for (const ro of orders) {
      const key = ro.assignedToId != null ? `t-${ro.assignedToId}` : UNASSIGNED_KEY;
      const lane = byKey.get(key);
      if (!lane) continue;
      lane.cells[ro.status].push(ro);
      lane.total += 1;
    }
    return lanes;
  }, [orders, allTechs]);

  function renderCard(ro: BoardOrder) {
    return (
      <Card
        key={ro.id}
        onClick={() => setLocation(`/repair-orders/${ro.id}`)}
        className="p-3 shadow-sm hover:shadow-md transition-all cursor-pointer"
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
    );
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Repair Orders</h1>
          <p className="text-muted-foreground mt-1">
            Status board is read-only. Click a card to advance its workflow.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center rounded-md border bg-background p-0.5">
            <Button
              variant={groupMode === "status" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => setGroup("status")}
              data-testid="button-group-status"
            >
              <LayoutGrid className="h-4 w-4 mr-1.5" /> Status
            </Button>
            <Button
              variant={groupMode === "technician" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => setGroup("technician")}
              data-testid="button-group-technician"
            >
              <Users className="h-4 w-4 mr-1.5" /> By Technician
            </Button>
          </div>
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
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 px-2" data-testid="button-customize-columns">
                <Settings2 className="h-4 w-4 mr-1.5" /> Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64" align="end">
              <div className="text-xs font-semibold text-muted-foreground mb-2">
                Show / hide columns
              </div>
              <div className="space-y-2">
                {ALL_COLUMNS.map(col => {
                  const visible = !hiddenColumns.has(col.key);
                  return (
                    <label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={visible}
                        onCheckedChange={(v) => toggleColumnVisibility(col.key, !!v)}
                        data-testid={`toggle-col-${col.key}`}
                      />
                      <span className="flex items-center gap-1.5">{col.icon}{col.title}</span>
                    </label>
                  );
                })}
              </div>
              <div className="text-[11px] text-muted-foreground mt-3 leading-snug">
                Drag a column header on the board to reorder. Your layout is saved per user.
              </div>
            </PopoverContent>
          </Popover>
          <Button onClick={() => setLocation("/repair-orders/new")} className="shadow-sm font-medium">
            <Plus className="mr-2 h-4 w-4" /> New Repair Order
          </Button>
        </div>
      </div>

      {visibleColumns.length === 0 ? (
        <div className="rounded-lg border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
          All columns are hidden. Use the Columns menu to show one.
        </div>
      ) : groupMode === "status" ? (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(220px, 1fr))` }}
          data-testid="board-columns"
        >
          {visibleColumns.map(col => {
            const items = groupedByStatus[col.key];
            const isColDragOver = columnDragOverKey === col.key;
            return (
              <div
                key={col.key}
                className={`rounded-lg border-t-4 ${col.tone} bg-muted/20 flex flex-col min-h-[200px] transition-colors ${isColDragOver ? "ring-2 ring-primary" : ""}`}
                data-testid={`board-column-${col.key}`}
              >
                <div
                  className="px-3 py-2.5 flex items-center justify-between border-b bg-background/40 rounded-t-md cursor-grab active:cursor-grabbing select-none"
                  draggable
                  onDragStart={(e) => onColumnHeaderDragStart(e, col.key)}
                  onDragEnd={() => { draggingColumnRef.current = null; setColumnDragOverKey(null); }}
                  onDragOver={(e) => onColumnHeaderDragOver(e, col.key)}
                  onDrop={(e) => onColumnHeaderDrop(e, col.key)}
                  data-testid={`board-column-header-${col.key}`}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-sm">
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
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
                    items.map(renderCard)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[1100px] space-y-3">
            <div className="grid gap-3" style={{ gridTemplateColumns: `180px repeat(${visibleColumns.length}, minmax(0, 1fr))` }}>
              <div />
              {visibleColumns.map(col => {
                const isColDragOver = columnDragOverKey === col.key;
                return (
                  <div
                    key={col.key}
                    className={`rounded-md border-t-4 ${col.tone} bg-background/40 px-3 py-2 flex items-center gap-1.5 font-semibold text-sm cursor-grab active:cursor-grabbing select-none ${isColDragOver ? "ring-2 ring-primary" : ""}`}
                    draggable
                    onDragStart={(e) => onColumnHeaderDragStart(e, col.key)}
                    onDragEnd={() => { draggingColumnRef.current = null; setColumnDragOverKey(null); }}
                    onDragOver={(e) => onColumnHeaderDragOver(e, col.key)}
                    onDrop={(e) => onColumnHeaderDrop(e, col.key)}
                    data-testid={`board-column-header-${col.key}`}
                  >
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
                    {col.icon} {col.title}
                  </div>
                );
              })}
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map(i => (
                  <div key={i} className="grid gap-3" style={{ gridTemplateColumns: `180px repeat(${visibleColumns.length}, minmax(0, 1fr))` }}>
                    <Skeleton className="h-24 w-full" />
                    {visibleColumns.map(c => <Skeleton key={c.key} className="h-24 w-full" />)}
                  </div>
                ))}
              </div>
            ) : (
              swimlanes.map(lane => (
                <div
                  key={lane.key}
                  className="grid gap-3"
                  style={{ gridTemplateColumns: `180px repeat(${visibleColumns.length}, minmax(0, 1fr))` }}
                  data-testid={`lane-${lane.key}`}
                >
                  <div className="rounded-md border bg-background/60 p-3 flex flex-col justify-between min-h-[120px]">
                    <div className="flex items-center gap-2">
                      {lane.tech ? (
                        <div className="h-7 w-7 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-xs font-bold border border-border">
                          {lane.tech.firstName[0]}{lane.tech.lastName[0]}
                        </div>
                      ) : (
                        <div className="h-7 w-7 rounded-full bg-muted text-muted-foreground flex items-center justify-center border border-border">
                          <UserX className="h-3.5 w-3.5" />
                        </div>
                      )}
                      <div className="text-sm font-semibold leading-tight truncate">{lane.title}</div>
                    </div>
                    <Badge variant="secondary" className="h-5 px-1.5 text-xs self-start mt-2">{lane.total}</Badge>
                  </div>

                  {visibleColumns.map(col => {
                    const items = lane.cells[col.key];
                    return (
                      <div
                        key={col.key}
                        className="rounded-md border bg-muted/20 p-2 space-y-2 min-h-[120px] transition-colors"
                        data-testid={`cell-${lane.key}-${col.key}`}
                      >
                        {items.length === 0 ? (
                          <div className="text-center text-[11px] text-muted-foreground/70 py-6">—</div>
                        ) : (
                          items.map(renderCard)
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}