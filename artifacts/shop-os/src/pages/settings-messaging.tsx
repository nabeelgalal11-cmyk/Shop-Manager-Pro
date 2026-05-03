import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Webhook } from "lucide-react";

interface MessagingSettings {
  accountSid: string;
  authTokenSet: boolean;
  fromNumber: string;
}

export default function SettingsMessaging() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<MessagingSettings | null>(null);
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [fromNumber, setFromNumber] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/settings/messaging");
      if (!r.ok) throw new Error("Unable to load messaging settings");
      const d = (await r.json()) as MessagingSettings;
      setData(d);
      setAccountSid(d.accountSid);
      setFromNumber(d.fromNumber);
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { accountSid, fromNumber };
      if (authToken.trim()) body.authToken = authToken.trim();
      const r = await fetch("/api/settings/messaging", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Save failed");
      }
      toast({ title: "Twilio settings saved" });
      setAuthToken("");
      load();
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const inboundUrl = `${window.location.origin}/api/twilio/inbound`;
  const statusUrl = `${window.location.origin}/api/twilio/status`;

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <MessageSquare className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Messaging (SMS)</h1>
          <p className="text-muted-foreground">Connect Twilio to send and receive customer text messages.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Twilio credentials</CardTitle>
          <CardDescription>
            Find these in your Twilio Console → Account Info. The auth token is stored in the database and never returned to the browser after saving.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="sid">Account SID</Label>
                <Input id="sid" placeholder="AC…" value={accountSid} onChange={(e) => setAccountSid(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tok" className="flex items-center justify-between">
                  <span>Auth token</span>
                  {data?.authTokenSet && <Badge variant="secondary" className="font-normal">Saved</Badge>}
                </Label>
                <Input
                  id="tok"
                  type="password"
                  placeholder={data?.authTokenSet ? "•••••• (leave blank to keep)" : "your auth token"}
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="from">Sending phone number</Label>
                <Input
                  id="from"
                  placeholder="+15551234567"
                  value={fromNumber}
                  onChange={(e) => setFromNumber(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Use E.164 format with leading <code>+</code> and country code.</p>
              </div>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Webhook className="h-4 w-4" /> Twilio webhooks</CardTitle>
          <CardDescription>
            In Twilio Console → your phone number → Messaging Configuration: set <strong>"A message comes in"</strong> webhook to the inbound URL below (HTTP POST). For delivery receipts, set the <strong>Status callback</strong> URL on your Messaging Service or per-send to the status URL. This is auto-included when <code>PUBLIC_BASE_URL</code> is set on the server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Inbound URL</Label>
            <div className="flex gap-2">
              <Input readOnly value={inboundUrl} className="font-mono text-xs" />
              <Button variant="outline" onClick={() => { navigator.clipboard.writeText(inboundUrl); toast({ title: "Copied" }); }}>Copy</Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Status callback URL</Label>
            <div className="flex gap-2">
              <Input readOnly value={statusUrl} className="font-mono text-xs" />
              <Button variant="outline" onClick={() => { navigator.clipboard.writeText(statusUrl); toast({ title: "Copied" }); }}>Copy</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
