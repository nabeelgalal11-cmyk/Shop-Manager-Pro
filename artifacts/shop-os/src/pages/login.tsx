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
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotIdentifier, setForgotIdentifier] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);
  const [forgotErr, setForgotErr] = useState<string | null>(null);

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

  const onForgotSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setForgotErr(null);
    setForgotSubmitting(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: forgotIdentifier.trim() }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Unable to submit request");
      }
      setForgotSuccess(true);
    } catch (error: any) {
      setForgotErr(error?.message || "Unable to submit request");
    } finally {
      setForgotSubmitting(false);
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
            <CardTitle className="text-2xl">915motors</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Auto Repair Management</p>
          </div>
        </CardHeader>
        <CardContent>
          {forgotOpen ? (
            <form onSubmit={onForgotSubmit} className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Forgot password?</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter your username or email and our staff will review your request.
                </p>
              </div>
              {forgotSuccess ? (
                <div className="text-sm bg-primary/10 border border-primary/20 rounded px-3 py-3" role="status">
                  If an account matches the information provided, an administrator will review the request.
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="forgot-identifier">Username or email</Label>
                    <Input
                      id="forgot-identifier"
                      type="text"
                      autoComplete="username"
                      value={forgotIdentifier}
                      onChange={(e) => setForgotIdentifier(e.target.value)}
                      required
                    />
                  </div>
                  {forgotErr && (
                    <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded px-3 py-2" role="alert">
                      {forgotErr}
                    </div>
                  )}
                  <Button type="submit" className="w-full" disabled={forgotSubmitting || !forgotIdentifier.trim()}>
                    {forgotSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Request password reset
                  </Button>
                </>
              )}
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setForgotOpen(false);
                  setForgotSuccess(false);
                  setForgotErr(null);
                }}
              >
                Back to sign in
              </Button>
            </form>
          ) : (
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
            <button
              type="button"
              className="w-full text-sm text-primary hover:underline"
              onClick={() => {
                setForgotOpen(true);
                setErr(null);
              }}
            >
              Forgot password?
            </button>
          </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
