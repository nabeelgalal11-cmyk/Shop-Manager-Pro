import { useState, useMemo, type FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Wrench } from "lucide-react";

export default function ResetPasswordPage() {
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token") || "";
  }, []);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const returnToSignIn = async () => {
    try {
      // If the reset link was opened in an already-authenticated browser,
      // clear that session so "/" consistently opens the sign-in screen.
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      window.location.replace("/");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!token) return setError("This reset link is missing its token. Request a new reset email.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to reset password.");
      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || "Unable to reset password.");
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4">
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader className="space-y-3 text-center"><div className="mx-auto h-14 w-14 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow"><Wrench className="h-7 w-7" /></div><CardTitle>Reset your password</CardTitle></CardHeader>
      <CardContent>
        {success ? <div className="space-y-4 text-center"><p className="text-sm" role="status">Your password has been reset successfully.</p><button type="button" onClick={returnToSignIn} className="text-primary hover:underline">Return to sign in</button></div> :
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="confirm-password">Confirm new password</Label><Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
            {error && <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded px-3 py-2" role="alert">{error}</div>}
            <Button type="submit" className="w-full" disabled={submitting}>{submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Reset password</Button>
             <button type="button" onClick={returnToSignIn} className="block w-full text-center text-sm text-primary hover:underline">Back to sign in</button>
          </form>}
      </CardContent>
    </Card>
  </div>;
}