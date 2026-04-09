import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClipboardCheck, Plus, Search, CheckCircle, XCircle, Pencil, Trash2, Printer } from "lucide-react";

const API = "/api/njmvc/inspections";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  if (r.status === 204) return null;
  return r.json();
}

export default function NjmvcInspections() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data, isLoading } = useQuery<any>({
    queryKey: [API, dateFrom, dateTo],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "200" });
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      return apiFetch(`${API}?${params}`);
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`${API}/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [API] }),
  });

  const inspections = (data?.data || []).filter((insp: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const vehicle = insp.vehicle;
    return (
      `${vehicle?.year} ${vehicle?.make} ${vehicle?.model}`.toLowerCase().includes(q) ||
      (insp.reportNumber || "").toLowerCase().includes(q) ||
      (insp.fleetUnitNumber || "").toLowerCase().includes(q) ||
      (insp.mechanicNamePrint || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <ClipboardCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">NJMVC Quarterly Inspections</h1>
            <p className="text-muted-foreground">NJ MVC Quarterly Vehicle Inspection Reports for your school bus fleet.</p>
          </div>
        </div>
        <Button onClick={() => setLocation("/njmvc/new")}>
          <Plus className="mr-2 h-4 w-4" /> New Inspection
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search vehicle, report #, mechanic..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground whitespace-nowrap">Date from</label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 h-9" />
          <label className="text-sm text-muted-foreground">to</label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 h-9" />
          {(dateFrom || dateTo) && (
            <button className="text-xs text-muted-foreground underline" onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear</button>
          )}
        </div>
      </div>

      <Card className="shadow-sm border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Fleet Unit #</TableHead>
              <TableHead>Report #</TableHead>
              <TableHead>Mechanic</TableHead>
              <TableHead>Miles</TableHead>
              <TableHead>Certified</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : inspections.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No inspections yet. Create your first NJMVC quarterly inspection.
                </TableCell>
              </TableRow>
            ) : inspections.map((insp: any) => (
              <TableRow
                key={insp.id}
                className="hover:bg-muted/50 cursor-pointer"
                onClick={() => setLocation(`/njmvc/${insp.id}`)}
              >
                <TableCell className="font-medium whitespace-nowrap">
                  {insp.inspectionDate
                    ? new Date(insp.inspectionDate + "T00:00:00").toLocaleDateString()
                    : new Date(insp.createdAt).toLocaleDateString()
                  }
                </TableCell>
                <TableCell>
                  <div className="font-medium">
                    {insp.vehicle?.year} {insp.vehicle?.make} {insp.vehicle?.model}
                  </div>
                  {insp.vin && <div className="text-xs text-muted-foreground font-mono">{insp.vin}</div>}
                </TableCell>
                <TableCell className="font-mono text-sm">{insp.fleetUnitNumber || "—"}</TableCell>
                <TableCell className="font-mono text-sm">{insp.reportNumber || "—"}</TableCell>
                <TableCell>{insp.mechanicNamePrint || "—"}</TableCell>
                <TableCell>{insp.mileage ? insp.mileage.toLocaleString() : "—"}</TableCell>
                <TableCell>
                  {insp.certifiedPassed ? (
                    <Badge className="bg-green-100 text-green-800 border-green-200 border">
                      <CheckCircle className="h-3 w-3 mr-1" /> Passed
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-red-50 text-red-700 border-red-200 border">
                      <XCircle className="h-3 w-3 mr-1" /> Not Certified
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" title="Print Report"
                      onClick={() => setLocation(`/njmvc/${insp.id}/print`)}>
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" title="Edit"
                      onClick={() => setLocation(`/njmvc/${insp.id}`)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                      onClick={() => confirm("Delete this inspection?") && remove.mutate(insp.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
