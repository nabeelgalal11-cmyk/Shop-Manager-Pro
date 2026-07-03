import { useState } from "react";
import {
  useGetEmployees, getGetEmployeesQueryKey,
  useClockIn, useClockOut,
  useUpdateEmployee, useDeleteEmployee,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, CheckCircle, Edit, Trash2, KeyRound, ShieldOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RoleMultiSelect, formatRole } from "@/components/role-multiselect";

const ROLES = ["admin", "manager", "technician", "inspector", "viewer"] as const;

async function userApi(url: string, opts?: RequestInit) {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...opts,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.status === 204 ? null : r.json();
}

export default function Employees() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();

  const { data, isLoading } = useGetEmployees({}, { query: { queryKey: getGetEmployeesQueryKey() } });
  const items = Array.isArray(data) ? data : (data as any)?.data || [];

  const clockIn = useClockIn();
  const clockOut = useClockOut();
  const updateEmployee = useUpdateEmployee();
  const deleteEmployee = useDeleteEmployee();

  // Employee edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  // Login access state
  const [accessOpen, setAccessOpen] = useState(false);
  const [accessEmp, setAccessEmp] = useState<any>(null);
  const [accessMode, setAccessMode] = useState<"grant" | "edit">("grant");
  const [accessForm, setAccessForm] = useState({
    username: "", password: "", roles: ["viewer"] as string[], active: true,
  });
  const [accessSaving, setAccessSaving] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetEmployeesQueryKey() });

  const canManageUsers = can("users", "create") || can("users", "edit");
  const canRevokeUsers = can("users", "delete");

  // Clock in/out
  const handleClockIn = (id: number) => {
    clockIn.mutate({ id }, {
      onSuccess: () => { toast({ title: "Clocked in successfully" }); refresh(); }
    });
  };
  const handleClockOut = (id: number) => {
    clockOut.mutate({ id }, {
      onSuccess: () => { toast({ title: "Clocked out successfully" }); refresh(); }
    });
  };

  // Employee edit
  const openEdit = (emp: any) => {
    setEditId(emp.id);
    setEditForm({
      firstName: emp.firstName ?? "",
      lastName: emp.lastName ?? "",
      email: emp.email ?? "",
      phone: emp.phone ?? "",
      hourlyRate: emp.hourlyRate ?? "",
      active: emp.active ?? true,
    });
    setEditOpen(true);
  };

  const handleSave = () => {
    if (editId == null) return;
    const payload = {
      ...editForm,
      hourlyRate: editForm.hourlyRate === "" ? undefined : Number(editForm.hourlyRate),
    };
    updateEmployee.mutate({ id: editId, data: payload }, {
      onSuccess: () => { toast({ title: "Employee updated" }); setEditOpen(false); refresh(); },
      onError: () => toast({ title: "Failed to update", variant: "destructive" }),
    });
  };

  const handleDelete = (id: number) => {
    deleteEmployee.mutate({ id }, {
      onSuccess: () => { toast({ title: "Employee deleted" }); refresh(); },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    });
  };

  // Login access management
  const openGrantAccess = (emp: any) => {
    setAccessEmp(emp);
    setAccessMode("grant");
    setAccessForm({
      username: "",
      password: "",
      roles: Array.isArray(emp.roles) && emp.roles.length > 0 ? emp.roles : ["viewer"],
      active: true,
    });
    setAccessOpen(true);
  };

  const openEditAccess = (emp: any) => {
    setAccessEmp(emp);
    setAccessMode("edit");
    setAccessForm({
      username: emp.username ?? "",
      password: "",
      roles: Array.isArray(emp.roles) && emp.roles.length > 0 ? emp.roles : ["viewer"],
      active: emp.active ?? true,
    });
    setAccessOpen(true);
  };

  const saveAccess = async () => {
    if (!accessEmp) return;
    setAccessSaving(true);
    try {
      if (accessMode === "grant") {
        await userApi("/api/users", {
          method: "POST",
          body: JSON.stringify({
            employeeId: accessEmp.id,
            username: accessForm.username,
            password: accessForm.password,
            roles: accessForm.roles,
          }),
        });
        toast({ title: "Login access granted", description: `${accessEmp.firstName} can now sign in as "${accessForm.username}".` });
      } else {
        const payload: any = { roles: accessForm.roles, active: accessForm.active };
        if (accessForm.username) payload.username = accessForm.username;
        if (accessForm.password.length >= 6) payload.password = accessForm.password;
        await userApi(`/api/users/${accessEmp.id}`, { method: "PUT", body: JSON.stringify(payload) });
        toast({ title: "Login access updated" });
      }
      setAccessOpen(false);
      refresh();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setAccessSaving(false);
    }
  };

  const revokeAccess = async (emp: any) => {
    try {
      await userApi(`/api/users/${emp.id}`, { method: "DELETE" });
      toast({ title: "Login access revoked", description: `${emp.firstName} ${emp.lastName} can no longer sign in.` });
      refresh();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  const rolesOf = (emp: any): string[] =>
    Array.isArray(emp.roles) && emp.roles.length > 0 ? emp.roles : (emp.role ? [emp.role] : []);

  const isGrantValid = accessMode === "grant"
    ? accessForm.username.length >= 2 && accessForm.password.length >= 6 && accessForm.roles.length > 0
    : accessForm.roles.length > 0;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Employees</h1>
          <p className="text-muted-foreground mt-1">Manage staff, time tracking, and login access.</p>
        </div>
        <Button onClick={() => setLocation("/employees/new")} className="shadow-sm font-medium">
          <Plus className="mr-2 h-4 w-4" /> Add Employee
        </Button>
      </div>

      <Card className="shadow-sm border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Clock Status</TableHead>
              <TableHead>Login Access</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((emp: any) => {
              const roles = rolesOf(emp);
              const hasAccess = !!emp.username;
              return (
                <TableRow key={emp.id} className="hover:bg-muted/50 transition-colors">
                  <TableCell>
                    <div className="font-medium">{emp.firstName} {emp.lastName}</div>
                    {emp.email && <div className="text-xs text-muted-foreground">{emp.email}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {roles.length > 0 ? roles.map((r: string) => (
                        <Badge key={r} variant="secondary" className="font-normal">{formatRole(r)}</Badge>
                      )) : <span className="text-muted-foreground text-sm">—</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {emp.clockedIn ? (
                      <Badge className="bg-green-600 hover:bg-green-600"><CheckCircle className="mr-1 h-3 w-3" /> Clocked In</Badge>
                    ) : (
                      <Badge variant="secondary">Clocked Out</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {hasAccess ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <KeyRound className="h-3 w-3 text-primary" />
                          <span className="text-sm font-mono">{emp.username}</span>
                          {!emp.active && <Badge variant="destructive" className="text-[10px] py-0 px-1">Inactive</Badge>}
                        </div>
                        <div className="flex gap-1">
                          {canManageUsers && (
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => openEditAccess(emp)}>
                              <Edit className="h-3 w-3 mr-1" /> Edit
                            </Button>
                          )}
                          {canRevokeUsers && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive hover:text-destructive">
                                  <ShieldOff className="h-3 w-3 mr-1" /> Revoke
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Revoke login access?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {emp.firstName} {emp.lastName} will no longer be able to sign in. Their employee record stays intact.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => revokeAccess(emp)}>
                                    Revoke
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </div>
                    ) : (
                      canManageUsers ? (
                        <Button size="sm" variant="outline" onClick={() => openGrantAccess(emp)}>
                          <KeyRound className="h-3.5 w-3.5 mr-1.5" /> Grant Access
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-sm">No access</span>
                      )
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {emp.clockedIn ? (
                        <Button variant="outline" size="sm" onClick={() => handleClockOut(emp.id)} disabled={clockOut.isPending}>Clock Out</Button>
                      ) : (
                        <Button variant="default" size="sm" onClick={() => handleClockIn(emp.id)} disabled={clockIn.isPending}>Clock In</Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => openEdit(emp)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {emp.firstName} {emp.lastName}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently removes the employee record. Time entries and any past assignments will remain in the database.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(emp.id)}
                              className="bg-destructive text-destructive-foreground"
                            >Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {items.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No employees found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Edit employee dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Edit Profile</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label>First Name</Label>
              <Input value={editForm.firstName || ""} onChange={e => setEditForm((f: any) => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name</Label>
              <Input value={editForm.lastName || ""} onChange={e => setEditForm((f: any) => ({ ...f, lastName: e.target.value }))} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Email</Label>
              <Input type="email" value={editForm.email || ""} onChange={e => setEditForm((f: any) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Phone</Label>
              <Input value={editForm.phone || ""} onChange={e => setEditForm((f: any) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Hourly Rate ($)</Label>
              <Input
                type="number" step="0.5"
                value={editForm.hourlyRate ?? ""}
                onChange={e => setEditForm((f: any) => ({ ...f, hourlyRate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <div className="flex items-center gap-2 h-10">
                <input
                  id="active-toggle" type="checkbox" className="h-4 w-4"
                  checked={!!editForm.active}
                  onChange={e => setEditForm((f: any) => ({ ...f, active: e.target.checked }))}
                />
                <Label htmlFor="active-toggle" className="cursor-pointer font-normal">Active</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={updateEmployee.isPending}>
              {updateEmployee.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Login access dialog */}
      <Dialog open={accessOpen} onOpenChange={(o) => { if (!o) setAccessOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {accessMode === "grant" ? "Grant Login Access" : "Edit Login Access"} — {accessEmp?.firstName} {accessEmp?.lastName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input
                value={accessForm.username}
                onChange={e => setAccessForm(f => ({ ...f, username: e.target.value.toLowerCase().trim() }))}
                placeholder="e.g. jsmith"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                {accessMode === "grant" ? "Password" : "New Password"}
                {accessMode === "edit" && <span className="text-xs text-muted-foreground font-normal ml-1">(leave blank to keep current)</span>}
              </Label>
              <Input
                type="password"
                value={accessForm.password}
                onChange={e => setAccessForm(f => ({ ...f, password: e.target.value }))}
                placeholder="At least 6 characters"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Roles</Label>
              <div className="flex flex-wrap gap-2">
                {ROLES.map(r => (
                  <button
                    key={r} type="button"
                    onClick={() => {
                      const has = accessForm.roles.includes(r);
                      const next = has ? accessForm.roles.filter(x => x !== r) : [...accessForm.roles, r];
                      if (next.length > 0) setAccessForm(f => ({ ...f, roles: next }));
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      accessForm.roles.includes(r)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted border-border hover:bg-muted/70"
                    }`}
                  >{r}</button>
                ))}
              </div>
            </div>
            {accessMode === "edit" && (
              <div className="flex items-center gap-3">
                <Switch
                  checked={accessForm.active}
                  onCheckedChange={v => setAccessForm(f => ({ ...f, active: v }))}
                />
                <Label className="font-normal cursor-pointer" onClick={() => setAccessForm(f => ({ ...f, active: !f.active }))}>
                  Account active
                </Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccessOpen(false)}>Cancel</Button>
            <Button onClick={saveAccess} disabled={accessSaving || !isGrantValid}>
              {accessSaving ? "Saving…" : accessMode === "grant" ? "Grant Access" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
