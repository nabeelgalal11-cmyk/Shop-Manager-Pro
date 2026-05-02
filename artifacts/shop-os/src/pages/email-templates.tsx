import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Mail, Save, Send, Eye } from "lucide-react";

interface Template {
  id: number;
  key: string;
  name: string;
  subject: string;
  bodyHtml: string;
  fromName: string | null;
  fromEmail: string | null;
  enabled: string;
  updatedAt: string;
}

const VARIABLES = [
  { name: "customerName", desc: "Customer's full name" },
  { name: "customerEmail", desc: "Customer's email" },
  { name: "shopName", desc: "Your shop name" },
  { name: "appointmentDateTime", desc: "Scheduled date & time" },
  { name: "serviceType", desc: "Service requested" },
  { name: "vehicleInfo", desc: "Year, make, model, plate" },
  { name: "notes", desc: "Appointment notes" },
];

async function api(url: string, opts?: RequestInit) {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...opts,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

function renderPreview(tpl: string): string {
  const sample: Record<string, string> = {
    customerName: "Jane Smith",
    customerEmail: "jane@example.com",
    shopName: "Your Shop",
    appointmentDateTime: new Date().toLocaleString(),
    serviceType: "Brake Inspection",
    vehicleInfo: "2018 Bluebird Vision (BUS-99)",
    notes: "Please check brakes too.",
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => sample[k] ?? `{{${k}}}`);
}

export default function EmailTemplates() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [active, setActive] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    api("/api/email-templates")
      .then((rows: Template[]) => {
        setTemplates(rows);
        if (rows.length > 0) setActive(rows[0]);
      })
      .catch((e) => toast({ title: "Failed to load", description: e.message, variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!active) return;
    setSaving(true);
    try {
      const updated = await api(`/api/email-templates/${active.key}`, {
        method: "PUT",
        body: JSON.stringify(active),
      });
      setActive(updated);
      setTemplates((ts) => ts.map((t) => (t.key === updated.key ? updated : t)));
      toast({ title: "Saved", description: "Template updated successfully." });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!active || !testEmail) return;
    try {
      await api(`/api/email-templates/${active.key}/test`, {
        method: "POST",
        body: JSON.stringify({ to: testEmail }),
      });
      toast({ title: "Test sent", description: `Sent to ${testEmail}` });
    } catch (e: any) {
      toast({ title: "Send failed", description: e.message, variant: "destructive" });
    }
  };

  const insertVar = (varName: string) => {
    if (!active) return;
    setActive({ ...active, bodyHtml: active.bodyHtml + `{{${varName}}}` });
  };

  if (loading) return <div className="p-8">Loading…</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Mail className="h-7 w-7 text-amber-500" />
        <div>
          <h1 className="text-3xl font-bold">Email Templates</h1>
          <p className="text-muted-foreground">Edit messages sent automatically to customers.</p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Template list */}
        <Card className="col-span-3">
          <CardHeader><CardTitle className="text-sm">Templates</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {templates.map((t) => (
              <button
                key={t.key}
                onClick={() => { setActive(t); setShowPreview(false); }}
                className={`w-full text-left px-3 py-2 rounded text-sm transition ${
                  active?.key === t.key ? "bg-amber-100 text-amber-900 font-medium" : "hover:bg-muted"
                }`}
              >
                {t.name}
                <div className="text-xs text-muted-foreground">{t.enabled === "true" ? "Active" : "Disabled"}</div>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Editor */}
        {active && (
          <Card className="col-span-9">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{active.name}</CardTitle>
                <div className="flex items-center gap-2">
                  <Label htmlFor="enabled" className="text-sm">Enabled</Label>
                  <Switch
                    id="enabled"
                    checked={active.enabled === "true"}
                    onCheckedChange={(v) => setActive({ ...active, enabled: v ? "true" : "false" })}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>From Name</Label>
                  <Input
                    value={active.fromName || ""}
                    onChange={(e) => setActive({ ...active, fromName: e.target.value })}
                    placeholder="ShopOS"
                  />
                </div>
                <div>
                  <Label>From Email</Label>
                  <Input
                    value={active.fromEmail || ""}
                    onChange={(e) => setActive({ ...active, fromEmail: e.target.value })}
                    placeholder="onboarding@resend.dev"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Use <code>onboarding@resend.dev</code> until you verify your own domain at resend.com.
                  </p>
                </div>
              </div>

              <div>
                <Label>Subject</Label>
                <Input
                  value={active.subject}
                  onChange={(e) => setActive({ ...active, subject: e.target.value })}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>Body (HTML)</Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowPreview(!showPreview)}>
                    <Eye className="h-3 w-3 mr-1" />
                    {showPreview ? "Edit" : "Preview"}
                  </Button>
                </div>
                {showPreview ? (
                  <div
                    className="border rounded p-4 bg-white min-h-[400px]"
                    dangerouslySetInnerHTML={{ __html: renderPreview(active.bodyHtml) }}
                  />
                ) : (
                  <Textarea
                    rows={18}
                    className="font-mono text-xs"
                    value={active.bodyHtml}
                    onChange={(e) => setActive({ ...active, bodyHtml: e.target.value })}
                  />
                )}
              </div>

              <div>
                <Label className="text-sm">Available Variables (click to insert)</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {VARIABLES.map((v) => (
                    <button
                      key={v.name}
                      onClick={() => insertVar(v.name)}
                      className="text-xs px-2 py-1 bg-muted hover:bg-muted/70 rounded font-mono"
                      title={v.desc}
                    >
                      {`{{${v.name}}}`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="test@example.com"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    className="w-64"
                  />
                  <Button variant="outline" onClick={sendTest} disabled={!testEmail}>
                    <Send className="h-4 w-4 mr-1" /> Send Test
                  </Button>
                </div>
                <Button onClick={save} disabled={saving}>
                  <Save className="h-4 w-4 mr-1" /> {saving ? "Saving…" : "Save Template"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
