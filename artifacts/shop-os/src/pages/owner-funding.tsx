import { useMemo, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { ArrowDownLeft, ArrowUpRight, CircleDollarSign, Download, HandCoins, Landmark, RotateCcw, ShieldCheck } from "lucide-react";
import { useCreateFundingEntry, useOwnerFunding, type FundingType } from "@/hooks/use-owner-funding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const labels: Record<FundingType, string> = { loan: "Owner loan", contribution: "Owner contribution", repayment: "Loan repayment" };

export default function OwnerFunding() {
  const { data, isLoading, isError, refetch } = useOwnerFunding();
  const { can } = useAuth();
  const canRecordFunding = can("expenses", "create");
  const createEntry = useCreateFundingEntry();
  const [type, setType] = useState<FundingType>("loan");
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(today);
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");
  const summary = data?.summary;
  const entries = useMemo(() => [...(data?.entries ?? [])].sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.id - a.id), [data?.entries]);
  const formatDate = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return setFormError("Enter an amount greater than zero.");
    if (!description.trim()) return setFormError("Add a short description for the ledger.");
    if (type === "repayment" && numericAmount > Number(summary?.outstandingLoan ?? 0)) {
      return setFormError(`Repayment cannot exceed the outstanding loan of ${money(summary?.outstandingLoan ?? 0)}.`);
    }
    try {
      await createEntry.mutateAsync({ type, amount: numericAmount, entryDate, description: description.trim(), ...(notes.trim() ? { notes: notes.trim() } : {}) });
      setAmount(""); setDescription(""); setNotes("");
    } catch (error) {
      const issue = error as Error & { status?: number };
      setFormError(issue.status === 409 ? "This repayment is higher than the current outstanding loan. Refresh the ledger and try again." : issue.message);
    }
  }

  const cards = [
    { title: "Outstanding loan", value: summary?.outstandingLoan ?? 0, note: "Owner loans less repayments", icon: Landmark, tone: "emerald" },
    { title: "Total loaned", value: summary?.totalLoaned ?? 0, note: "Cash advanced to the shop", icon: ArrowDownLeft, tone: "sand" },
    { title: "Total repaid", value: summary?.totalRepaid ?? 0, note: "Principal returned to owner", icon: RotateCcw, tone: "slate" },
    { title: "Contributed", value: summary?.totalContributed ?? 0, note: "Owner equity; not a loan", icon: HandCoins, tone: "gold" },
  ];

  return <main className="mx-auto max-w-[1380px] space-y-6 p-4 sm:p-7 lg:p-9">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.17em] text-primary"><span className="h-2 w-2 rounded-full bg-primary" /> Shop books / capital</div>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Owner funding</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Keep owner-provided cash distinct from supplier purchases and operating expenses.</p>
      </div>
      <Link href="/reports/bookkeeping" className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-muted" data-testid="link-bookkeeping">
        <Download className="h-4 w-4" /> Bookkeeping export
      </Link>
    </header>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Funding totals">
      {cards.map(({ title, value, note, icon: Icon, tone }) => <article key={title} className="relative overflow-hidden rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between"><p className="text-xs font-bold uppercase tracking-[.11em] text-muted-foreground">{title}</p><span className={`grid h-9 w-9 place-items-center rounded-md ${tone === "emerald" ? "bg-primary/10 text-primary" : tone === "gold" ? "bg-amber-100 text-amber-800" : tone === "sand" ? "bg-orange-100 text-orange-800" : "bg-secondary text-secondary-foreground"}`}><Icon className="h-4 w-4" /></span></div>
        <p className="mt-4 font-mono text-[1.8rem] font-semibold tracking-tight">{money(value)}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p>
      </article>)}
    </section>

    <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div><h2 className="font-bold">Funding ledger</h2><p className="mt-1 text-xs text-muted-foreground">Entries are ordered by effective date; created time is retained for audit.</p></div>
          <span className="rounded border border-border bg-background px-2.5 py-1 font-mono text-xs text-muted-foreground">{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
        </div>
        {isLoading ? <div className="space-y-3 p-5" aria-label="Loading funding ledger">{[0,1,2,3].map((i) => <div key={i} className="h-14 animate-pulse rounded bg-muted" />)}</div> :
        isError ? <div className="p-10 text-center"><p className="font-semibold">Ledger unavailable</p><p className="mt-1 text-sm text-muted-foreground">No entry was changed. Check your connection and retry.</p><Button variant="outline" className="mt-4" onClick={() => refetch()}>Retry</Button></div> :
        entries.length === 0 ? <div className="px-6 py-14 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary"><CircleDollarSign className="h-6 w-6" /></div><h3 className="mt-4 font-bold">No owner funding recorded</h3><p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Record a loan, contribution, or repayment to start a separate, date-based audit trail.</p></div> :
        <div className="overflow-x-auto">
          <table className="w-full min-w-[660px] text-left text-sm">
            <thead className="bg-muted/60 text-[10px] uppercase tracking-[.13em] text-muted-foreground"><tr><th className="px-5 py-3 font-bold">Effective date</th><th className="px-4 py-3 font-bold">Entry</th><th className="px-4 py-3 font-bold">Description</th><th className="px-5 py-3 text-right font-bold">Amount</th></tr></thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => {
                const repayment = entry.type === "repayment";
                const positive = entry.type !== "repayment";
                return <tr key={entry.id} className="transition-colors hover:bg-muted/30" data-testid={`row-funding-${entry.id}`}>
                  <td className="whitespace-nowrap px-5 py-4 align-top font-mono text-xs">{formatDate(entry.entryDate)}</td>
                  <td className="px-4 py-4 align-top"><span className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-bold ${entry.type === "loan" ? "bg-primary/10 text-primary" : repayment ? "bg-orange-100 text-orange-900" : "bg-amber-100 text-amber-900"}`}>{repayment ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}{labels[entry.type]}</span></td>
                  <td className="max-w-[340px] px-4 py-4 align-top"><p className="font-semibold">{entry.description}</p>{entry.notes && <p className="mt-1 text-xs text-muted-foreground">{entry.notes}</p>}<p className="mt-1 font-mono text-[10px] text-muted-foreground">Entered {new Date(entry.createdAt).toLocaleString()}</p></td>
                  <td className={`whitespace-nowrap px-5 py-4 text-right align-top font-mono font-semibold ${positive ? "text-primary" : "text-orange-800"}`}>{repayment ? "−" : "+"}{money(entry.amount)}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
      </div>

      {canRecordFunding ? <aside className="rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted/40 px-5 py-4"><div className="flex items-center gap-2"><CircleDollarSign className="h-4 w-4 text-primary" /><h2 className="font-bold">Record funding</h2></div><p className="mt-1 text-xs text-muted-foreground">One dated event per entry. This does not create a purchase or expense.</p></div>
        <form onSubmit={submit} className="space-y-4 p-5">
          <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
            {(["loan","contribution","repayment"] as FundingType[]).map((item) => <button key={item} type="button" onClick={() => { setType(item); setFormError(""); }} aria-pressed={type === item} className={`rounded px-1.5 py-2 text-[11px] font-bold transition-colors ${type === item ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} data-testid={`select-funding-${item}`}>{item === "loan" ? "Loan" : item === "contribution" ? "Contribution" : "Repayment"}</button>)}
          </div>
          {type === "repayment" && <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2.5 text-xs text-orange-950"><span className="font-bold">Available to repay</span><span className="float-right font-mono font-bold">{money(summary?.outstandingLoan ?? 0)}</span></div>}
          <div className="space-y-1.5"><Label htmlFor="fund-amount">Amount</Label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-muted-foreground">$</span><Input id="fund-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="pl-8 font-mono" placeholder="0.00" required data-testid="input-funding-amount" /></div></div>
          <div className="space-y-1.5"><Label htmlFor="fund-date">Effective date</Label><Input id="fund-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required data-testid="input-funding-date" /></div>
          <div className="space-y-1.5"><Label htmlFor="fund-description">Description</Label><Input id="fund-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Initial shop working capital" maxLength={160} required data-testid="input-funding-description" /></div>
          <div className="space-y-1.5"><Label htmlFor="fund-notes">Notes <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="fund-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Reference, payment method, or context" data-testid="input-funding-notes" /></div>
          {formError && <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive">{formError}</p>}
          {createEntry.isError && !formError && <p role="alert" className="text-xs text-destructive">{createEntry.error.message}</p>}
          <Button type="submit" className="w-full" disabled={createEntry.isPending} data-testid="button-save-funding">{createEntry.isPending ? "Saving entry…" : `Record ${type === "loan" ? "loan" : type === "repayment" ? "repayment" : "contribution"}`}</Button>
          <p className="flex items-start gap-2 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> Date entered is the accounting date. The ledger also preserves when the record was created.</p>
        </form>
      </aside> : <aside className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="font-bold">Read-only access</h2>
        <p className="mt-2 text-sm text-muted-foreground">You can review owner funding records. A manager must grant expense-creation access to add or repay entries.</p>
      </aside>}
    </section>
  </main>;
}