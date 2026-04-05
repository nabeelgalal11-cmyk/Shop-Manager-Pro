import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from "recharts";
import { BarChart2, DollarSign, TrendingUp, Users, Car, Receipt, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

async function apiFetch(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtFull(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  trend?: number;
  color?: string;
}

function StatCard({ icon, label, value, sub, trend, color = "bg-primary/10" }: StatCardProps) {
  return (
    <Card className="border-border">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">{label}</p>
            <p className="text-3xl font-bold">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`h-10 w-10 rounded-lg ${color} flex items-center justify-center`}>
            {icon}
          </div>
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${trend >= 0 ? "text-green-600" : "text-red-600"}`}>
            {trend >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(trend).toFixed(1)}% vs last month
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Reports() {
  const { data: overview, isLoading: loadingOverview } = useQuery({
    queryKey: ["/api/reports/overview"],
    queryFn: () => apiFetch("/api/reports/overview"),
  });

  const { data: byCategory = [] } = useQuery({
    queryKey: ["/api/reports/revenue-by-category"],
    queryFn: () => apiFetch("/api/reports/revenue-by-category"),
  });

  const { data: monthly = [] } = useQuery({
    queryKey: ["/api/reports/monthly-revenue"],
    queryFn: () => apiFetch("/api/reports/monthly-revenue"),
  });

  const { data: topCustomers = [] } = useQuery({
    queryKey: ["/api/reports/top-customers"],
    queryFn: () => apiFetch("/api/reports/top-customers"),
  });

  const { data: expensesByCategory = [] } = useQuery({
    queryKey: ["/api/reports/expenses-by-category"],
    queryFn: () => apiFetch("/api/reports/expenses-by-category"),
  });

  const { data: usedCarReport } = useQuery({
    queryKey: ["/api/reports/used-cars"],
    queryFn: () => apiFetch("/api/reports/used-cars"),
  });

  const totalRevenue = overview?.totalRevenue ?? 0;
  const totalExpenses = overview?.totalExpenses ?? 0;
  const usedCarProfit = overview?.usedCarProfit ?? 0;
  const totalProfit = (overview?.servicePaid ?? 0) + usedCarProfit - totalExpenses;

  // Format month labels like "Jan '25"
  function fmtMonth(ym: string) {
    if (!ym) return "";
    const [y, m] = ym.split("-");
    return new Date(Number(y), Number(m) - 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }

  const monthlyFormatted = monthly.map((r: any) => ({
    ...r,
    month: fmtMonth(r.month),
  }));

  const usedCarByStatus = usedCarReport?.byStatus || [];
  const usedCarMonthly = (usedCarReport?.monthlySales || []).map((r: any) => ({
    ...r,
    month: fmtMonth(r.month),
  })).reverse();

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <BarChart2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Reports</h1>
          <p className="text-muted-foreground">Revenue, expenses, and business analytics.</p>
        </div>
      </div>

      {/* Overview KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<DollarSign className="h-5 w-5 text-primary" />}
          label="Total Revenue"
          value={loadingOverview ? "—" : fmt(totalRevenue + (overview?.usedCarSoldRevenue ?? 0))}
          sub={`${fmt(overview?.servicePaid ?? 0)} collected`}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5 text-green-600" />}
          label="Net Profit"
          value={loadingOverview ? "—" : fmt(totalProfit)}
          sub="after expenses"
          color="bg-green-100"
        />
        <StatCard
          icon={<Receipt className="h-5 w-5 text-orange-500" />}
          label="Total Expenses"
          value={loadingOverview ? "—" : fmt(totalExpenses)}
          color="bg-orange-100"
        />
        <StatCard
          icon={<Car className="h-5 w-5 text-blue-500" />}
          label="Used Car Profit"
          value={loadingOverview ? "—" : fmt(usedCarProfit)}
          sub={`${overview?.usedCarSoldCount ?? 0} sold · ${overview?.usedCarAvailableCount ?? 0} available`}
          color="bg-blue-100"
        />
      </div>

      {/* Monthly Revenue Trend */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Monthly Service Revenue (Last 12 Months)</CardTitle>
        </CardHeader>
        <CardContent>
          {monthlyFormatted.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No invoice data yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={monthlyFormatted} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: any) => fmtFull(v)} />
                <Line type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} name="Revenue" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Revenue by Category + Expenses */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Revenue by Customer Category</CardTitle>
          </CardHeader>
          <CardContent>
            {byCategory.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byCategory} margin={{ top: 5, right: 20, bottom: 30, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="category" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" />
                  <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => fmtFull(v)} />
                  <Bar dataKey="revenue" name="Revenue" radius={[3, 3, 0, 0]}>
                    {byCategory.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Expenses by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {expensesByCategory.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No expense data yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={expensesByCategory}
                    dataKey="total"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ category, percent }) => `${category} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {expensesByCategory.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => fmtFull(v)} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Customers */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Users className="h-4 w-4" /> Top Customers by Revenue
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">#</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Invoices</TableHead>
                <TableHead>Total Billed</TableHead>
                <TableHead>Total Paid</TableHead>
                <TableHead>Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topCustomers.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No customer data yet.</TableCell></TableRow>
              ) : topCustomers.map((c: any, i: number) => (
                <TableRow key={c.id} className="hover:bg-muted/50">
                  <TableCell className="pl-6 font-bold text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">{c.customer_name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{c.category}</Badge>
                  </TableCell>
                  <TableCell>{c.invoice_count}</TableCell>
                  <TableCell className="font-semibold">{fmt(c.total_spent)}</TableCell>
                  <TableCell>{fmt(c.total_paid)}</TableCell>
                  <TableCell>
                    <span className={c.outstanding_balance > 0 ? "text-orange-600 font-medium" : "text-muted-foreground"}>
                      {fmt(c.outstanding_balance)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Used Cars Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Used Car Status Breakdown */}
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Car className="h-4 w-4" /> Used Car Inventory Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Status</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead>Total Cost</TableHead>
                  <TableHead>Selling Value</TableHead>
                  <TableHead>Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usedCarByStatus.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground pl-6">No vehicles in inventory.</TableCell></TableRow>
                ) : usedCarByStatus.map((r: any) => (
                  <TableRow key={r.status} className="hover:bg-muted/50">
                    <TableCell className="pl-6">
                      <span className="capitalize font-medium">{r.status}</span>
                    </TableCell>
                    <TableCell>{r.count}</TableCell>
                    <TableCell>{fmt(r.total_cost)}</TableCell>
                    <TableCell>{fmt(r.total_selling)}</TableCell>
                    <TableCell>
                      <span className={r.total_margin >= 0 ? "text-green-700 font-semibold" : "text-red-700 font-semibold"}>
                        {r.total_margin >= 0 ? "+" : ""}{fmt(r.total_margin)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Used Car Monthly Sales */}
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Monthly Car Sales</CardTitle>
          </CardHeader>
          <CardContent>
            {usedCarMonthly.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No sales recorded yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={usedCarMonthly} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => fmtFull(v)} />
                  <Bar dataKey="revenue" name="Revenue" fill="#22c55e" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="profit" name="Profit" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  <Legend />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
