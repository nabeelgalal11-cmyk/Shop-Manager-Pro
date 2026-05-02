import { useState, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Wrench, LogIn, Loader2 } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (e: any) {
      setErr(e?.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto h-14 w-14 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow">
            <Wrench className="h-7 w-7" />
          </div>
          <div>
            <CardTitle className="text-2xl">ShopOS</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Auto Repair Management</p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {err && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded px-3 py-2">
                {err}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={submitting || !username || !password}>
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LogIn className="h-4 w-4 mr-2" />}
              Sign In
            </Button>
            <p className="text-xs text-muted-foreground text-center pt-2">
              Need access? Contact your shop administrator.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
