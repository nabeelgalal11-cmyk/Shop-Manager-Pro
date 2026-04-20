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
import { Plus, CheckCircle, Edit, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RoleMultiSelect, formatRole } from "@/components/role-multiselect";

export default function Employees() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useGetEmployees({}, { query: { queryKey: getGetEmployeesQueryKey() } });
  const items = Array.isArray(data) ? data : (data as any)?.data || [];

  const clockIn = useClockIn();
  const clockOut = useClockOut();
  const updateEmployee = useUpdateEmployee();
  const deleteEmployee = useDeleteEmployee();

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetEmployeesQueryKey() });

  const handleClockIn = (id: number) => {
    clockIn.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Clocked in successfully" });
        refresh();
      }
    });
  };

  const handleClockOut = (id: number) => {
    clockOut.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Clocked out successfully" });
        refresh();
      }
    });
  };

  const openEdit = (emp: any) => {
    setEditId(emp.id);
    const rolesValue: string[] = Array.isArray(emp.roles) && emp.roles.length > 0
      ? emp.roles
      : (emp.role ? [emp.role] : []);
    setEditForm({
      firstName: emp.firstName ?? "",
      lastName: emp.lastName ?? "",
      email: emp.email ?? "",
      phone: emp.phone ?? "",
      roles: rolesValue,
      hourlyRate: emp.hourlyRate ?? "",
      active: emp.active ?? true,
    });
    setEditOpen(true);
  };

  const handleSave = () => {
    if (editId == null) return;
    if (!editForm.roles || editForm.roles.length === 0) {
      toast({ title: "Pick at least one role", variant: "destructive" });
      return;
    }
    const payload = {
      ...editForm,
      role: editForm.roles[0],
      hourlyRate: editForm.hourlyRate === "" ? undefined : Number(editForm.hourlyRate),
    };
    updateEmployee.mutate({ id: editId, data: payload }, {
      onSuccess: () => {
        toast({ title: "Employee updated" });
        setEditOpen(false);
        refresh();
      },
      onError: () => toast({ title: "Failed to update", variant: "destructive" }),
    });
  };

  const handleDelete = (id: number) => {
    deleteEmployee.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Employee deleted" });
        refresh();
      },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    });
  };

  const rolesOf = (emp: any): string[] =>
    Array.isArray(emp.roles) && emp.roles.length > 0 ? emp.roles : (emp.role ? [emp.role] : []);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Employees</h1>
          <p className="text-muted-foreground mt-1">Manage staff and time tracking.</p>
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
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((emp: any) => {
              const roles = rolesOf(emp);
              return (
                <TableRow key={emp.id} className="hover:bg-muted/50 transition-colors">
                  <TableCell className="font-medium">{emp.firstName} {emp.lastName}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {roles.length > 0 ? roles.map((r: string) => (
                        <Badge key={r} variant="secondary" className="font-normal">
                          {formatRole(r)}
                        </Badge>
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
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No employees found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Employee</DialogTitle>
          </DialogHeader>
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
            <div className="space-y-1.5 col-span-2">
              <Label>Roles <span className="text-xs text-muted-foreground font-normal">(an employee can hold more than one)</span></Label>
              <RoleMultiSelect
                value={editForm.roles || []}
                onChange={(roles) => setEditForm((f: any) => ({ ...f, roles }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hourly Rate ($)</Label>
              <Input
                type="number"
                step="0.5"
                value={editForm.hourlyRate ?? ""}
                onChange={e => setEditForm((f: any) => ({ ...f, hourlyRate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <div className="flex items-center gap-2 h-10">
                <input
                  id="active-toggle"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={!!editForm.active}
                  onChange={e => setEditForm((f: any) => ({ ...f, active: e.target.checked }))}
                />
                <Label htmlFor="active-toggle" className="cursor-pointer font-normal">
                  Active
                </Label>
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
    </div>
  );
}
