import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { BookOpen, Download, FileSpreadsheet, Receipt, CreditCard, Package } from "lucide-react";

interface ExportButtonProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
}

function ExportButton({ icon, title, description, href }: ExportButtonProps) {
  return (
    <a
      href={href}
      className="flex items-start gap-3 p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors"
      data-testid={`export-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold">{title}</p>
          <Download className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </a>
  );
}

export default function Bookkeeping() {
  const today = new Date();
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const toISO = (d: Date) => d.toISOString().slice(0, 10);

  const [from, setFrom] = useState<string>(toISO(yearStart));
  const [to, setTo] = useState<string>(toISO(today));

  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const q = qs.toString() ? `?${qs.toString()}` : "";

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <BookOpen className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Bookkeeping Export</h1>
          <p className="text-muted-foreground">
            Download CSVs ready to import into QuickBooks Online or any spreadsheet.
          </p>
        </div>
      </div>

      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Date Range</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <Label htmlFor="bk-from" className="text-xs">From</Label>
            <Input
              id="bk-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="input-from"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <Label htmlFor="bk-to" className="text-xs">To</Label>
            <Input
              id="bk-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="input-to"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setFrom(toISO(yearStart)); setTo(toISO(today)); }}
          >
            Year to date
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFrom(""); setTo(""); }}
          >
            All time
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Download All</CardTitle>
        </CardHeader>
        <CardContent>
          <a
            href={`/api/exports/bookkeeping.zip${q}`}
            className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
            data-testid="export-zip"
          >
            <Download className="h-4 w-4" />
            Download bookkeeping.zip
          </a>
          <p className="text-xs text-muted-foreground mt-2">
            Bundles all four CSVs below into one zip file.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Individual CSVs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <ExportButton
            icon={<FileSpreadsheet className="h-5 w-5 text-primary" />}
            title="Invoices"
            description="One row per non-draft invoice with totals, tax, balance, and customer."
            href={`/api/exports/invoices.csv${q}`}
          />
          <ExportButton
            icon={<CreditCard className="h-5 w-5 text-primary" />}
            title="Payments"
            description="Successful payments with method, reference, and Stripe intent."
            href={`/api/exports/payments.csv${q}`}
          />
          <ExportButton
            icon={<Receipt className="h-5 w-5 text-primary" />}
            title="Expenses"
            description="Expense entries by date with category, vendor, and amount."
            href={`/api/exports/expenses.csv${q}`}
          />
          <ExportButton
            icon={<Package className="h-5 w-5 text-primary" />}
            title="COGS Journal"
            description="Daily journal entries debiting COGS and crediting Inventory Asset."
            href={`/api/exports/cogs-journal.csv${q}`}
          />
        </CardContent>
      </Card>
    </div>
  );
}
