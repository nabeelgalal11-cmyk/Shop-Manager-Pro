import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Settings2 } from "lucide-react";

interface ShopSettings {
  laborRate: number;
}

export default function SettingsShop() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [laborRate, setLaborRate] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/shop");
      if (!response.ok) throw new Error("Unable to load shop settings");
      const data = (await response.json()) as ShopSettings;
      setLaborRate(String(data.laborRate));
    } catch (error: any) {
      toast({ title: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(laborRate);
    if (!Number.isFinite(value) || value < 0 || value > 10000) {
      toast({
        title: "Enter a valid labor rate between $0 and $10,000 per hour",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/settings/shop", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ laborRate: value }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error ?? "Unable to save shop settings");
      }
      const data = (await response.json()) as ShopSettings & { ok: boolean };
      setLaborRate(String(data.laborRate));
      toast({ title: "Shop labor rate saved" });
    } catch (error: any) {
      toast({ title: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Settings2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Shop Settings</h1>
          <p className="text-muted-foreground">Configure shop-wide pricing and profitability defaults.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Default labor rate</CardTitle>
          <CardDescription>
            Used by repair-order profitability, reports, and labor-cost estimates when no employee labor rate is available.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <form onSubmit={save} className="space-y-4">
              <div className="max-w-xs space-y-1.5">
                <Label htmlFor="shop-labor-rate">Labor rate ($/hr)</Label>
                <Input
                  id="shop-labor-rate"
                  type="number"
                  min="0"
                  max="10000"
                  step="0.01"
                  required
                  value={laborRate}
                  onChange={(event) => setLaborRate(event.target.value)}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Customer-category labor rates are separate and apply to customer pricing. This setting controls the shop-wide profitability rate.
              </p>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save labor rate"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}