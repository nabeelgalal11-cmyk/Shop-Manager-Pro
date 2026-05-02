import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Shield, Eye, Plus, Pencil, Trash2, Printer, Lock } from "lucide-react";

interface MatrixData {
  matrix: Record<string, Record<string, string[]>>;
  roles: string[];
  resources: string[];
  actions: string[];
}

async function api(url: string, opts?: RequestInit) {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...opts,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

const RESOURCE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  repair_orders: "Repair Orders",
  estimates: "Estimates",
  invoices: "Invoices",
  appointments: "Appointments",
  inspections: "Inspections",
  njmvc: "NJMVC Quarterly",
  njmvc_template: "NJMVC Template",
  customers: "Customers",
  vehicles: "Vehicles",
  inventory: "Inventory",
  payments: "Payments",
  used_cars: "Used Cars",
  purchases: "Purchases",
  reports: "Reports",
  employees: "Employees",
  time_entries: "Time Entries",
  expenses: "Expenses",
  reminders: "Reminders",
  customer_categories: "Customer Categories",
  users: "Users (Admin)",
  permissions: "Permissions (Admin)",
};

const ACTION_ICONS: Record<string, any> = {
  view: Eye, create: Plus, edit: Pencil, delete: Trash2, print: Printer,
};

export default function PermissionsPage() {
  const { can, refresh } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<MatrixData | null>(null);
  const [activeRole, setActiveRole] = useState<string>("admin");
  const [saving, setSaving] = useState<string | null>(null);

  const reload = async () => {
    try {
      const d = await api("/api/permissions");
      setData(d);
    } catch (e: any) {
      toast({ title: "Failed to load permissions", description: e.message, variant: "destructive" });
    }
  };

  useEffect(() => { reload(); }, []);

  const canEdit = can("permissions", "edit");

  const togglePerm = async (role: string, resource: string, action: string, enabled: boolean) => {
    if (!data || !canEdit) return;
    if (role === "admin") {
      toast({ title: "Admin role permissions cannot be changed", variant: "destructive" });
      return;
    }
    const key = `${role}:${resource}:${action}`;
    setSaving(key);

    // optimistic
    const prev = data;
    const nextMatrix = { ...data.matrix };
    nextMatrix[role] = { ...nextMatrix[role] };
    const cur = new Set(nextMatrix[role][resource] || []);
    if (enabled) cur.add(action); else cur.delete(action);
    nextMatrix[role][resource] = Array.from(cur);
    setData({ ...data, matrix: nextMatrix });

    try {
      await api("/api/permissions", {
        method: "PUT",
        body: JSON.stringify({ role, resource, action, enabled }),
      });
      refresh(); // update current user's perms (in case they changed their own role)
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
      setData(prev);
    } finally {
      setSaving(null);
    }
  };

  if (!data) return <div className="p-8 text-center text-muted-foreground">Loading permissions…</div>;

  const summary = (role: string) => {
    let count = 0;
    for (const r of data.resources) count += (data.matrix[role]?.[r] || []).length;
    return count;
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Permissions</h1>
          <p className="text-muted-foreground">Per-role permissions for every page and action. Users get the union of all their roles' permissions.</p>
        </div>
      </div>

      {!canEdit && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <Lock className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>You can view permissions but not edit them. Ask an admin to change role permissions.</span>
        </div>
      )}

      <Tabs value={activeRole} onValueChange={setActiveRole}>
        <TabsList className="flex-wrap h-auto">
          {data.roles.map((r) => (
            <TabsTrigger key={r} value={r} className="capitalize">
              {r}
              <Badge variant="secondary" className="ml-2 text-[10px]">{summary(r)}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>

        {data.roles.map((role) => (
          <TabsContent key={role} value={role}>
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-semibold">Page / Resource</th>
                      {data.actions.map((a) => {
                        const Icon = ACTION_ICONS[a] || Eye;
                        return (
                          <th key={a} className="px-3 py-2.5 font-semibold text-center capitalize">
                            <div className="flex items-center justify-center gap-1.5">
                              <Icon className="h-3.5 w-3.5" />
                              {a}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {data.resources.map((resource, i) => (
                      <tr key={resource} className={i % 2 ? "bg-muted/10" : ""}>
                        <td className="px-4 py-2 font-medium">
                          {RESOURCE_LABELS[resource] || resource}
                          <div className="text-[10px] text-muted-foreground font-mono">{resource}</div>
                        </td>
                        {data.actions.map((action) => {
                          const enabled = (data.matrix[role]?.[resource] || []).includes(action);
                          const key = `${role}:${resource}:${action}`;
                          return (
                            <td key={action} className="px-3 py-2 text-center">
                              <Switch
                                checked={enabled}
                                disabled={!canEdit || role === "admin" || saving === key}
                                onCheckedChange={(v) => togglePerm(role, resource, action, v)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            {role === "admin" && (
              <p className="text-xs text-muted-foreground mt-2 italic">Admin role always has full access; toggles are locked.</p>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
