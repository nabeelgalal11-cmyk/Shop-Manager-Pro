import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Settings2 } from "lucide-react";

interface ShopSettings {
  laborRate: number;
  shopName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  email: string;
  ein: string;
  website: string;
  additionalInfo: string;
}

type ShopProfile = Omit<ShopSettings, "laborRate">;

export default function SettingsShop() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [laborRate, setLaborRate] = useState("");
  const [profile, setProfile] = useState<ShopProfile>({
    shopName: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    phone: "",
    email: "",
    ein: "",
    website: "",
    additionalInfo: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/shop");
      if (!response.ok) throw new Error("Unable to load shop settings");
      const data = (await response.json()) as ShopSettings;
      setLaborRate(String(data.laborRate));
      setProfile({
        shopName: data.shopName ?? "",
        addressLine1: data.addressLine1 ?? "",
        addressLine2: data.addressLine2 ?? "",
        city: data.city ?? "",
        state: data.state ?? "",
        postalCode: data.postalCode ?? "",
        phone: data.phone ?? "",
        email: data.email ?? "",
        ein: data.ein ?? "",
        website: data.website ?? "",
        additionalInfo: data.additionalInfo ?? "",
      });
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
        body: JSON.stringify({ laborRate: value, ...profile }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error ?? "Unable to save shop settings");
      }
      const data = (await response.json()) as ShopSettings & { ok: boolean };
      setLaborRate(String(data.laborRate));
      setProfile({
        shopName: data.shopName ?? "",
        addressLine1: data.addressLine1 ?? "",
        addressLine2: data.addressLine2 ?? "",
        city: data.city ?? "",
        state: data.state ?? "",
        postalCode: data.postalCode ?? "",
        phone: data.phone ?? "",
        email: data.email ?? "",
        ein: data.ein ?? "",
        website: data.website ?? "",
        additionalInfo: data.additionalInfo ?? "",
      });
      toast({ title: "Shop settings saved" });
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

      <Card>
        <CardHeader>
          <CardTitle>Business information</CardTitle>
          <CardDescription>
            Add the contact and identification details you want available for shop documents and customer communication.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="shop-name">Business name</Label>
                <Input id="shop-name" value={profile.shopName} onChange={(event) => setProfile({ ...profile, shopName: event.target.value })} placeholder="915motors" />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="shop-address-line-1">Address</Label>
                <Input id="shop-address-line-1" value={profile.addressLine1} onChange={(event) => setProfile({ ...profile, addressLine1: event.target.value })} placeholder="123 Mechanic Street" />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="shop-address-line-2">Address line 2 <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="shop-address-line-2" value={profile.addressLine2} onChange={(event) => setProfile({ ...profile, addressLine2: event.target.value })} placeholder="Suite, unit, or building" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shop-city">City</Label>
                <Input id="shop-city" value={profile.city} onChange={(event) => setProfile({ ...profile, city: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shop-state">State</Label>
                <Input id="shop-state" value={profile.state} onChange={(event) => setProfile({ ...profile, state: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shop-postal-code">ZIP / Postal code</Label>
                <Input id="shop-postal-code" value={profile.postalCode} onChange={(event) => setProfile({ ...profile, postalCode: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shop-phone">Phone</Label>
                <Input id="shop-phone" type="tel" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} placeholder="(555) 555-5555" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shop-email">Email</Label>
                <Input id="shop-email" type="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} placeholder="service@example.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shop-ein">EIN / Tax ID</Label>
                <Input id="shop-ein" value={profile.ein} onChange={(event) => setProfile({ ...profile, ein: event.target.value })} placeholder="XX-XXXXXXX" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shop-website">Website <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="shop-website" type="url" value={profile.website} onChange={(event) => setProfile({ ...profile, website: event.target.value })} placeholder="https://example.com" />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="shop-additional-info">Additional information <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Textarea id="shop-additional-info" value={profile.additionalInfo} onChange={(event) => setProfile({ ...profile, additionalInfo: event.target.value })} placeholder="Hours, license numbers, or other business details" rows={4} />
              </div>
              <div className="md:col-span-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save business information"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}