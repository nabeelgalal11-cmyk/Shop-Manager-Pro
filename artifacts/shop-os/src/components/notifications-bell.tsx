import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Bell, Calendar, BellRing, Package, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";

interface NotificationsResponse {
  appointments: Array<{
    id: number;
    scheduledAt: string;
    serviceType: string;
    customerName: string;
    vehicleLabel: string | null;
  }>;
  reminders: Array<{
    id: number;
    serviceType: string;
    dueDate: string;
    daysOverdue: number;
    customerName: string;
    vehicleLabel: string | null;
  }>;
  lowStock: Array<{
    id: number;
    name: string;
    partNumber: string | null;
    quantity: number;
    minQuantity: number;
    outOfStock: boolean;
  }>;
  counts: { appointments: number; reminders: number; lowStock: number; total: number };
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const base = import.meta.env.BASE_URL;

  const { data, isLoading } = useQuery<NotificationsResponse>({
    queryKey: ["notifications"],
    queryFn: async () => {
      const res = await fetch(`${base}api/notifications`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load notifications");
      return res.json();
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const total = data?.counts.total ?? 0;
  const showBadge = total > 0;

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Notifications${total ? ` (${total})` : ""}`}
        >
          <Bell className="h-5 w-5" />
          {showBadge && (
            <span className="absolute -top-0.5 -right-0.5 h-5 min-w-[1.25rem] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center border-2 border-card">
              {total > 99 ? "99+" : total}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" sideOffset={8}>
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-semibold text-sm">Notifications</div>
          <div className="text-xs text-muted-foreground">
            {isLoading ? "Loading…" : total === 0 ? "All caught up" : `${total} item${total === 1 ? "" : "s"}`}
          </div>
        </div>
        <ScrollArea className="max-h-[28rem]">
          {!isLoading && total === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
              No new notifications
            </div>
          )}

          {data && data.appointments.length > 0 && (
            <Section
              icon={<Calendar className="h-4 w-4 text-blue-600" />}
              label="Pending appointments"
              count={data.appointments.length}
              onSeeAll={() => go("/appointments")}
            >
              {data.appointments.map(a => (
                <Row
                  key={`appt-${a.id}`}
                  title={a.serviceType}
                  subtitle={a.customerName + (a.vehicleLabel ? ` · ${a.vehicleLabel}` : "")}
                  meta={fmtDateTime(a.scheduledAt)}
                  onClick={() => go(`/appointments`)}
                />
              ))}
            </Section>
          )}

          {data && data.reminders.length > 0 && (
            <Section
              icon={<BellRing className="h-4 w-4 text-amber-600" />}
              label="Overdue reminders"
              count={data.reminders.length}
              onSeeAll={() => go("/reminders")}
            >
              {data.reminders.map(r => (
                <Row
                  key={`rem-${r.id}`}
                  title={r.serviceType}
                  subtitle={r.customerName + (r.vehicleLabel ? ` · ${r.vehicleLabel}` : "")}
                  meta={
                    r.daysOverdue > 0
                      ? `${r.daysOverdue}d overdue`
                      : `Due ${fmtDate(r.dueDate)}`
                  }
                  metaClass={r.daysOverdue > 0 ? "text-destructive font-semibold" : ""}
                  onClick={() => go("/reminders")}
                />
              ))}
            </Section>
          )}

          {data && data.lowStock.length > 0 && (
            <Section
              icon={<Package className="h-4 w-4 text-rose-600" />}
              label="Low stock"
              count={data.lowStock.length}
              onSeeAll={() => go("/inventory")}
            >
              {data.lowStock.map(i => (
                <Row
                  key={`inv-${i.id}`}
                  title={i.name}
                  subtitle={i.partNumber ? `Part ${i.partNumber}` : "—"}
                  meta={
                    i.outOfStock
                      ? "Out of stock"
                      : `${i.quantity} left (min ${i.minQuantity})`
                  }
                  metaClass={i.outOfStock ? "text-destructive font-semibold" : "text-amber-700"}
                  metaIcon={i.outOfStock ? <AlertTriangle className="h-3 w-3" /> : undefined}
                  onClick={() => go(`/inventory/${i.id}`)}
                />
              ))}
            </Section>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function Section({
  icon,
  label,
  count,
  onSeeAll,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  onSeeAll: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/40">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-foreground/70">
            {count}
          </span>
        </div>
        <button
          className="text-xs text-primary hover:underline"
          onClick={onSeeAll}
        >
          See all
        </button>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({
  title,
  subtitle,
  meta,
  metaClass,
  metaIcon,
  onClick,
}: {
  title: string;
  subtitle: string;
  meta: string;
  metaClass?: string;
  metaIcon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-2.5 hover:bg-muted/60 transition-colors flex items-start justify-between gap-3 border-t border-border/40 first:border-t-0"
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{title}</div>
        <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
      </div>
      <div className={`text-xs whitespace-nowrap flex items-center gap-1 ${metaClass || "text-muted-foreground"}`}>
        {metaIcon}
        {meta}
      </div>
    </button>
  );
}
