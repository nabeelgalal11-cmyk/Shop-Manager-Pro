import { useGetRepairOrders, getGetRepairOrdersQueryKey, getRepairOrder } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, ChevronRight, AlertTriangle, Clock, CheckCircle2, Wrench, ChevronLeft, Printer } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 50;

const escapeHtml = (s: any) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDate = (v: any) => {
  if (!v) return "—";
  if (typeof v === "string") {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
  }
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
};

function buildOrderHtml(ro: any, isLast: boolean): string {
  const parts: Array<{ name: string; partNumber?: string; quantity: number; unitPrice: number | string }> =
    Array.isArray(ro.parts) ? ro.parts : [];
  const partsTotal = parts.reduce(
    (sum, p) => sum + Number(p.quantity || 0) * Number(p.unitPrice || 0),
    0
  );
  const tech = ro.assignedTo ? `${ro.assignedTo.firstName} ${ro.assignedTo.lastName}` : "Unassigned";
  const customer = ro.customer ? `${ro.customer.firstName} ${ro.customer.lastName}` : "—";
  const vehicle = ro.vehicle
    ? `${ro.vehicle.year} ${ro.vehicle.make} ${ro.vehicle.model}${ro.vehicle.licensePlate ? ` — Plate ${ro.vehicle.licensePlate}` : ""}`
    : "—";

  const partsTable =
    parts.length > 0
      ? `
      <h2>Parts Needed</h2>
      <table>
        <thead>
          <tr><th>Part Name</th><th>Part #</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr>
        </thead>
        <tbody>
          ${parts
            .map(
              (p) => `
              <tr>
                <td>${escapeHtml(p.name)}</td>
                <td>${escapeHtml(p.partNumber || "—")}</td>
                <td>${escapeHtml(p.quantity)}</td>
                <td>$${Number(p.unitPrice).toFixed(2)}</td>
                <td>$${(Number(p.quantity) * Number(p.unitPrice)).toFixed(2)}</td>
              </tr>`
            )
            .join("")}
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td colspan="4" style="text-align:right">Parts Total</td>
            <td>$${partsTotal.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>`
      : "";

  return `
    <section class="ro-page" ${isLast ? "" : 'style="page-break-after: always;"'}>
      <h1>Repair Order: ${escapeHtml(ro.orderNumber)}</h1>
      <p class="meta">
        Customer: ${escapeHtml(customer)} &bull;
        Vehicle: ${escapeHtml(vehicle)} &bull;
        Status: ${escapeHtml(String(ro.status || "").replace("_", " "))} &bull;
        Priority: ${escapeHtml(ro.priority)}
      </p>
      <div class="grid">
        <div><div class="label">Technician</div><div class="value">${escapeHtml(tech)}</div></div>
        <div><div class="label">Mileage In</div><div class="value">${
          ro.mileageIn != null ? Number(ro.mileageIn).toLocaleString() + " mi" : "—"
        }</div></div>
        <div><div class="label">Created</div><div class="value">${formatDate(ro.createdAt)}</div></div>
        <div><div class="label">Promised Date</div><div class="value">${formatDate(ro.promisedDate)}</div></div>
      </div>
      <h2>Customer Complaint</h2>
      <div class="box">${escapeHtml(ro.complaint || "No complaint recorded.")}</div>
      <h2>Technician Diagnosis</h2>
      <div class="box">${escapeHtml(ro.diagnosis || "No diagnosis recorded.")}</div>
      ${partsTable}
    </section>
  `;
}

export default function RepairOrders() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [printing, setPrinting] = useState(false);

  const { data, isLoading } = useGetRepairOrders(
    { limit: PAGE_SIZE, page },
    { query: { queryKey: getGetRepairOrdersQueryKey({ limit: PAGE_SIZE, page }) } }
  );

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const startIdx = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(page * PAGE_SIZE, total);
  const rows = data?.data ?? [];
  const pageIds = rows.map((r) => r.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPageSelected = pageIds.some((id) => selected.has(id));

  const toggleAllOnPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const printIds = async (ids: number[]) => {
    if (ids.length === 0) return;
    setPrinting(true);
    try {
      const orders = await Promise.all(ids.map((id) => getRepairOrder(id)));
      const sorted = ids.map((id) => orders.find((o: any) => o.id === id)).filter(Boolean);
      const body = sorted.map((ro: any, i: number) => buildOrderHtml(ro, i === sorted.length - 1)).join("");

      const w = window.open("", "_blank");
      if (!w) {
        toast({ title: "Pop-up blocked", description: "Allow pop-ups to print.", variant: "destructive" });
        return;
      }
      w.document.write(`
        <html>
          <head>
            <title>Repair Orders (${sorted.length})</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
              h1 { font-size: 22px; margin-bottom: 4px; }
              h2 { font-size: 16px; margin: 16px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
              .meta { color: #555; font-size: 13px; margin-bottom: 16px; }
              .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
              .label { font-size: 11px; color: #888; text-transform: uppercase; margin-bottom: 2px; }
              .value { font-size: 14px; }
              table { width: 100%; border-collapse: collapse; font-size: 13px; }
              th { background: #f0f0f0; text-align: left; padding: 6px 8px; font-size: 12px; }
              td { padding: 6px 8px; border-bottom: 1px solid #eee; }
              .total-row td { font-weight: bold; border-top: 2px solid #ddd; }
              .box { background: #f9f9f9; border: 1px solid #ddd; border-radius: 4px; padding: 12px; font-size: 13px; min-height: 60px; white-space: pre-wrap; }
              .ro-page { padding-bottom: 16px; }
              @media print { body { padding: 0; } }
            </style>
          </head>
          <body>${body}</body>
        </html>
      `);
      w.document.close();
      w.focus();
      setTimeout(() => { w.print(); }, 400);
    } catch (err: any) {
      toast({ title: "Failed to load orders for print", description: err?.message ?? "", variant: "destructive" });
    } finally {
      setPrinting(false);
    }
  };

  const printSelected = () => printIds(Array.from(selected));
  const printAllOnPage = () => printIds(pageIds);

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'pending': return <Badge variant="secondary" className="bg-muted text-muted-foreground"><Clock className="mr-1 h-3 w-3" /> Pending</Badge>;
      case 'in_progress': return <Badge className="bg-primary text-primary-foreground border-primary"><Wrench className="mr-1 h-3 w-3" /> In Progress</Badge>;
      case 'waiting_parts': return <Badge variant="outline" className="border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950/20"><AlertTriangle className="mr-1 h-3 w-3" /> Waiting Parts</Badge>;
      case 'completed': return <Badge className="bg-green-600 hover:bg-green-700 text-white"><CheckCircle2 className="mr-1 h-3 w-3" /> Completed</Badge>;
      default: return <Badge variant="outline">{status.replace('_', ' ')}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch(priority) {
      case 'urgent': return <span className="text-xs font-bold text-destructive flex items-center"><AlertTriangle className="mr-1 h-3 w-3" /> Urgent</span>;
      case 'high': return <span className="text-xs font-semibold text-orange-600 dark:text-orange-500">High</span>;
      case 'low': return <span className="text-xs text-muted-foreground">Low</span>;
      default: return <span className="text-xs text-muted-foreground">Normal</span>;
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Repair Orders</h1>
          <p className="text-muted-foreground mt-1">Manage active jobs and service history.</p>
        </div>
        <Button onClick={() => setLocation("/repair-orders/new")} className="shadow-sm font-medium">
          <Plus className="mr-2 h-4 w-4" /> New Repair Order
        </Button>
      </div>

      <Card className="shadow-sm border-border">
        <div className="p-4 border-b flex items-center justify-between gap-4 bg-muted/20 flex-wrap">
          <div className="relative flex-1 max-w-md min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search RO number, customer, vehicle..."
              className="pl-9 bg-background"
            />
          </div>
          <div className="flex gap-2 items-center">
            {selected.size > 0 && (
              <span className="text-sm text-muted-foreground">{selected.size} selected</span>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={selected.size === 0 || printing}
              onClick={printSelected}
            >
              <Printer className="h-4 w-4 mr-1.5" />
              {printing ? "Preparing…" : `Print Selected${selected.size > 0 ? ` (${selected.size})` : ""}`}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={rows.length === 0 || printing}
              onClick={printAllOnPage}
            >
              <Printer className="h-4 w-4 mr-1.5" /> Print Page
            </Button>
            {selected.size > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            )}
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={allOnPageSelected ? true : someOnPageSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAllOnPage}
                  aria-label="Select all on this page"
                />
              </TableHead>
              <TableHead className="w-[100px]">RO #</TableHead>
              <TableHead>Customer / Vehicle</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell></TableCell>
                </TableRow>
              ))
            ) : rows.length > 0 ? (
              rows.map((ro) => (
                <TableRow
                  key={ro.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setLocation(`/repair-orders/${ro.id}`)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(ro.id)}
                      onCheckedChange={() => toggleOne(ro.id)}
                      aria-label={`Select ${ro.orderNumber}`}
                    />
                  </TableCell>
                  <TableCell className="font-mono font-medium text-sm">
                    <div>{ro.orderNumber}</div>
                    <div className="text-[11px] text-muted-foreground font-sans font-normal mt-0.5">
                      {formatDate(ro.createdAt)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold text-foreground">
                      {ro.customer ? `${ro.customer.firstName} ${ro.customer.lastName}` : 'Unknown Customer'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {ro.vehicle ? `${ro.vehicle.year} ${ro.vehicle.make} ${ro.vehicle.model}${ro.vehicle.licensePlate ? ` — ${ro.vehicle.licensePlate}` : ""}` : 'Unknown Vehicle'}
                    </div>
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(ro.status)}
                  </TableCell>
                  <TableCell>
                    {getPriorityBadge(ro.priority)}
                  </TableCell>
                  <TableCell>
                    {ro.assignedTo ? (
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-xs font-bold border border-border">
                          {ro.assignedTo.firstName[0]}{ro.assignedTo.lastName[0]}
                        </div>
                        <span className="text-sm font-medium">{ro.assignedTo.firstName} {ro.assignedTo.lastName}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground italic">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  No repair orders found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {total > 0 && (
          <div className="flex items-center justify-between gap-4 px-4 py-3 border-t bg-muted/10 text-sm">
            <div className="text-muted-foreground">
              Showing <span className="font-medium text-foreground">{startIdx}</span>–<span className="font-medium text-foreground">{endIdx}</span> of <span className="font-medium text-foreground">{total}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || isLoading} onClick={() => setPage(p => Math.max(1, p - 1))}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <span className="text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages || isLoading} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
