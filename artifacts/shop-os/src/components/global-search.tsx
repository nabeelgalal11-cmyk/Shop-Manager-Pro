import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search, Users, Car, Wrench, FileSpreadsheet, FileText, Calendar, X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface SearchResults {
  customers: Array<{ id: number; firstName: string; lastName: string; email: string | null; phone: string | null }>;
  vehicles: Array<{
    id: number;
    year: number | null;
    make: string;
    model: string;
    licensePlate: string | null;
    vin: string | null;
    fleetNumber: string | null;
    customerId: number;
  }>;
  repairOrders: Array<{ id: number; orderNumber: string; status: string; complaint: string | null; customerId: number; vehicleId: number }>;
  invoices: Array<{ id: number; invoiceNumber: string; status: string; total: string }>;
  estimates: Array<{ id: number; estimateNumber: string; status: string; total: string }>;
  appointments: Array<{ id: number; serviceType: string; scheduledAt: string; status: string; customerId: number }>;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();
  const debounced = useDebounced(query.trim(), 200);
  const base = import.meta.env.BASE_URL;

  const { data, isFetching } = useQuery<SearchResults>({
    queryKey: ["global-search", debounced],
    enabled: debounced.length >= 1,
    queryFn: async () => {
      const res = await fetch(`${base}api/search?q=${encodeURIComponent(debounced)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    staleTime: 15_000,
  });

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Cmd/Ctrl + K to focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    setQuery("");
    navigate(path);
  };

  const totalResults =
    (data?.customers.length || 0) +
    (data?.vehicles.length || 0) +
    (data?.repairOrders.length || 0) +
    (data?.invoices.length || 0) +
    (data?.estimates.length || 0) +
    (data?.appointments.length || 0);

  return (
    <div ref={containerRef} className="relative w-64 hidden md:block">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => debounced.length >= 1 && setOpen(true)}
        placeholder="Search customers, vehicles, ROs..."
        className="pl-9 pr-12 h-9 bg-muted/50 border-transparent focus-visible:ring-primary focus-visible:border-primary transition-all"
      />
      {query ? (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1.5 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <kbd className="absolute right-2 top-1.5 h-6 px-1.5 hidden lg:flex items-center rounded border bg-muted/50 text-[10px] font-mono text-muted-foreground">
          ⌘K
        </kbd>
      )}

      {open && debounced.length >= 1 && (
        <div className="absolute left-0 right-0 mt-1 bg-popover text-popover-foreground rounded-md border shadow-lg z-50 max-h-[28rem] overflow-y-auto w-[28rem]">
          {isFetching && totalResults === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">Searching…</div>
          )}
          {!isFetching && totalResults === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No results for &ldquo;{debounced}&rdquo;
            </div>
          )}

          {data && data.customers.length > 0 && (
            <Group icon={<Users className="h-3.5 w-3.5" />} label="Customers">
              {data.customers.map(c => (
                <Row
                  key={`cust-${c.id}`}
                  title={`${c.firstName} ${c.lastName}`.trim()}
                  subtitle={[c.email, c.phone].filter(Boolean).join(" · ")}
                  onClick={() => go(`/customers/${c.id}`)}
                />
              ))}
            </Group>
          )}

          {data && data.vehicles.length > 0 && (
            <Group icon={<Car className="h-3.5 w-3.5" />} label="Vehicles">
              {data.vehicles.map(v => (
                <Row
                  key={`veh-${v.id}`}
                  title={[v.year, v.make, v.model].filter(Boolean).join(" ")}
                  subtitle={
                    [
                      v.licensePlate && `Plate ${v.licensePlate}`,
                      v.fleetNumber && `Fleet ${v.fleetNumber}`,
                      v.vin && `VIN ${v.vin}`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"
                  }
                  onClick={() => go(`/vehicles/${v.id}`)}
                />
              ))}
            </Group>
          )}

          {data && data.repairOrders.length > 0 && (
            <Group icon={<Wrench className="h-3.5 w-3.5" />} label="Repair Orders">
              {data.repairOrders.map(r => (
                <Row
                  key={`ro-${r.id}`}
                  title={`RO ${r.orderNumber}`}
                  subtitle={r.complaint || r.status}
                  badge={r.status}
                  onClick={() => go(`/repair-orders/${r.id}`)}
                />
              ))}
            </Group>
          )}

          {data && data.invoices.length > 0 && (
            <Group icon={<FileSpreadsheet className="h-3.5 w-3.5" />} label="Invoices">
              {data.invoices.map(i => (
                <Row
                  key={`inv-${i.id}`}
                  title={`Invoice ${i.invoiceNumber}`}
                  subtitle={`$${Number(i.total).toFixed(2)}`}
                  badge={i.status}
                  onClick={() => go(`/invoices/${i.id}`)}
                />
              ))}
            </Group>
          )}

          {data && data.estimates.length > 0 && (
            <Group icon={<FileText className="h-3.5 w-3.5" />} label="Estimates">
              {data.estimates.map(e => (
                <Row
                  key={`est-${e.id}`}
                  title={`Estimate ${e.estimateNumber}`}
                  subtitle={`$${Number(e.total).toFixed(2)}`}
                  badge={e.status}
                  onClick={() => go(`/estimates/${e.id}`)}
                />
              ))}
            </Group>
          )}

          {data && data.appointments.length > 0 && (
            <Group icon={<Calendar className="h-3.5 w-3.5" />} label="Appointments">
              {data.appointments.map(a => (
                <Row
                  key={`appt-${a.id}`}
                  title={a.serviceType}
                  subtitle={new Date(a.scheduledAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  badge={a.status}
                  onClick={() => go(`/appointments`)}
                />
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  );
}

function Group({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b last:border-b-0">
      <div className="px-3 py-1.5 bg-muted/40 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({
  title,
  subtitle,
  badge,
  onClick,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors flex items-start justify-between gap-3 border-t border-border/40 first:border-t-0"
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{title}</div>
        {subtitle && <div className="text-xs text-muted-foreground truncate">{subtitle}</div>}
      </div>
      {badge && (
        <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground bg-muted rounded px-1.5 py-0.5 whitespace-nowrap">
          {badge}
        </span>
      )}
    </button>
  );
}
