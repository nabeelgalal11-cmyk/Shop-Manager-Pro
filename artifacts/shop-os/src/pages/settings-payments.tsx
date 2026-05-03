import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CreditCard, ExternalLink, Webhook } from "lucide-react";

interface PaymentSettings {
  publishableKey: string;
  secretKeySet: boolean;
  webhookSecretSet: boolean;
}

export default function SettingsPayments() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<PaymentSettings | null>(null);
  const [publishable, setPublishable] = useState("");
  const [secret, setSecret] = useState("");
  const [webhook, setWebhook] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/settings/payments");
      if (!r.ok) throw new Error("Unable to load payment settings");
      const d = (await r.json()) as PaymentSettings;
      setData(d);
      setPublishable(d.publishableKey);
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
      const body: Record<string, unknown> = { publishableKey: publishable };
      if (secret.trim()) body.secretKey = secret.trim();
      if (webhook.trim()) body.webhookSecret = webhook.trim();
      const r = await fetch("/api/settings/payments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Save failed");
      }
      toast({ title: "Stripe settings saved" });
      setSecret("");
      setWebhook("");
      load();
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const webhookUrl = `${window.location.origin}/api/stripe/webhook`;

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <CreditCard className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Payment Settings</h1>
          <p className="text-muted-foreground">Connect Stripe so customers can pay invoices online.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stripe API keys</CardTitle>
          <CardDescription>
            Find these in your Stripe dashboard under Developers → API keys.
            Keys are stored in the database and are masked in the browser after saving — only the last 4 characters are ever returned.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="pub">Publishable key</Label>
                <Input id="pub" placeholder="pk_live_…" value={publishable} onChange={(e) => setPublishable(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sec" className="flex items-center justify-between">
                  <span>Secret key</span>
                  {data?.secretKeySet && <Badge variant="secondary" className="font-normal">Saved</Badge>}
                </Label>
                <Input
                  id="sec"
                  type="password"
                  placeholder={data?.secretKeySet ? "•••••• (leave blank to keep)" : "sk_live_…"}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wh" className="flex items-center justify-between">
                  <span>Webhook signing secret</span>
                  {data?.webhookSecretSet && <Badge variant="secondary" className="font-normal">Saved</Badge>}
                </Label>
                <Input
                  id="wh"
                  type="password"
                  placeholder={data?.webhookSecretSet ? "•••••• (leave blank to keep)" : "whsec_…"}
                  value={webhook}
                  onChange={(e) => setWebhook(e.target.value)}
                />
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
          <CardTitle className="flex items-center gap-2"><Webhook className="h-4 w-4" /> Webhook endpoint</CardTitle>
          <CardDescription>
            In Stripe → Developers → Webhooks, add this endpoint and subscribe to
            <code className="mx-1 px-1.5 py-0.5 rounded bg-muted text-xs">checkout.session.completed</code>
            and
            <code className="mx-1 px-1.5 py-0.5 rounded bg-muted text-xs">payment_intent.payment_failed</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(webhookUrl);
                toast({ title: "Webhook URL copied" });
              }}
            >
              Copy
            </Button>
          </div>
          <a
            href="https://dashboard.stripe.com/webhooks"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary inline-flex items-center gap-1 hover:underline"
          >
            Open Stripe webhooks <ExternalLink className="h-3 w-3" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
