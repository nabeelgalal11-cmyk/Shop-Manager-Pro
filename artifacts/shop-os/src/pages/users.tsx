import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { UserCircle, Plus, KeyRound, Shield, Trash2, Pencil } from "lucide-react";

const ROLES = ["admin", "manager", "technician", "inspector", "viewer"] as const;
type Role = (typeof ROLES)[number];

interface User {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
  email: string | null;
  role: string;
  roles: string[];
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

async function api(url: string, opts?: RequestInit) {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...opts,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.status === 204 ? null : r.json();
}

export default function UsersPage() {
  const { can } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [pwUserId, setPwUserId] = useState<number | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ firstName: "", lastName: "", email: "", username: "" });

  // create form
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", username: "", password: "",
    roles: ["viewer"] as Role[],
  });

  const reload = async () => {
    setLoading(true);
    try {
      const rows = await api("/api/users");
      setUsers(rows);
    } catch (e: any) {
      toast({ title: "Failed to load users", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const toggleFormRole = (role: Role) => {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(role) ? f.roles.filter((r) => r !== role) : [...f.roles, role],
    }));
  };

  const createUser = async () => {
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify(form) });
      toast({ title: "User created" });
      setShowCreate(false);
      setForm({ firstName: "", lastName: "", email: "", username: "", password: "", roles: ["viewer"] });
      reload();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  const setUserRoles = async (id: number, roles: string[]) => {
    try {
      await api(`/api/users/${id}`, { method: "PUT", body: JSON.stringify({ roles }) });
      reload();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  const setActive = async (id: number, active: boolean) => {
    try {
      await api(`/api/users/${id}`, { method: "PUT", body: JSON.stringify({ active }) });
      reload();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  const resetPassword = async () => {
    if (!pwUserId || pwValue.length < 6) return;
    try {
      await api(`/api/users/${pwUserId}`, { method: "PUT", body: JSON.stringify({ password: pwValue }) });
      toast({ title: "Password reset" });
      setPwUserId(null);
      setPwValue("");
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  const openEdit = (u: User) => {
    setEditUser(u);
    setEditForm({ firstName: u.firstName, lastName: u.lastName, email: u.email || "", username: u.username });
  };

  const saveEdit = async () => {
    if (!editUser) return;
    try {
      await api(`/api/users/${editUser.id}`, { method: "PUT", body: JSON.stringify(editForm) });
      toast({ title: "User updated" });
      setEditUser(null);
      reload();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  const removeUser = async (id: number) => {
    if (!confirm("Revoke this user's login? Their employee record stays.")) return;
    try {
      await api(`/api/users/${id}`, { method: "DELETE" });
      reload();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  const canCreate = can("users", "create");
  const canEdit = can("users", "edit");
  const canDelete = can("users", "delete");

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <UserCircle className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Users</h1>
            <p className="text-muted-foreground">Manage logins and assign roles. Permissions per role are configured in <strong>Permissions</strong>.</p>
          </div>
        </div>
        {canCreate && (
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" /> New User</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create User</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>First Name</Label>
                  <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Last Name</Label>
                  <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label>Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Username</Label>
                  <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Password</Label>
                  <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label>Roles</Label>
                  <div className="flex flex-wrap gap-2">
                    {ROLES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => toggleFormRole(r)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          form.roles.includes(r)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted border-border hover:bg-muted/70"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button onClick={createUser} disabled={!form.username || form.password.length < 6 || !form.firstName || !form.lastName}>
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">All Users</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
              ) : users.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No users yet.</TableCell></TableRow>
              ) : users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.firstName} {u.lastName}</div>
                    <div className="text-xs text-muted-foreground">{u.email || "—"}</div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{u.username}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {ROLES.map((r) => {
                        const has = u.roles.includes(r);
                        return (
                          <button
                            key={r}
                            type="button"
                            disabled={!canEdit}
                            onClick={() => {
                              const next = has ? u.roles.filter((x) => x !== r) : [...u.roles, r];
                              if (next.length === 0) { toast({ title: "User must have at least one role", variant: "destructive" }); return; }
                              setUserRoles(u.id, next);
                            }}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                              has ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-border hover:bg-muted/70"
                            } ${!canEdit ? "opacity-60 cursor-not-allowed" : ""}`}
                          >{r}</button>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                  </TableCell>
                  <TableCell>
                    <Switch checked={u.active} disabled={!canEdit} onCheckedChange={(v) => setActive(u.id, v)} />
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => openEdit(u)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                      </Button>
                    )}
                    <Dialog open={pwUserId === u.id} onOpenChange={(o) => { if (!o) { setPwUserId(null); setPwValue(""); } }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => setPwUserId(u.id)}>
                          <KeyRound className="h-3.5 w-3.5 mr-1" /> Reset
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Reset Password — {u.firstName} {u.lastName}</DialogTitle></DialogHeader>
                        <div className="space-y-2">
                          <Label>New password</Label>
                          <Input type="password" value={pwValue} onChange={(e) => setPwValue(e.target.value)} placeholder="At least 6 characters" />
                        </div>
                        <DialogFooter>
                          <Button variant="ghost" onClick={() => { setPwUserId(null); setPwValue(""); }}>Cancel</Button>
                          <Button disabled={pwValue.length < 6} onClick={resetPassword}>Set Password</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    {canDelete && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeUser(u.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit user dialog */}
      <Dialog open={!!editUser} onOpenChange={(o) => { if (!o) setEditUser(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit User — {editUser?.firstName} {editUser?.lastName}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>First Name</Label>
              <Input value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Last Name</Label>
              <Input value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Email</Label>
              <Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Username</Label>
              <Input value={editForm.username} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={!editForm.firstName || !editForm.lastName || !editForm.username}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 flex items-start gap-2">
        <Shield className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div>
          A user can have <strong>multiple roles</strong>; effective permissions are the union across those roles. Edit per-role permissions in the <strong>Permissions</strong> page.
        </div>
      </div>
    </div>
  );
}
