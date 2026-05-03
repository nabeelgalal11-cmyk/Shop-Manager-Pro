import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";

interface ThreadRow {
  messageId: number;
  customerId: number;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  readAt: string | null;
  createdAt: string;
  firstName: string;
  lastName: string;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function MessagesBell() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const base = import.meta.env.BASE_URL;

  const { data: count } = useQuery<{ count: number }>({
    queryKey: ["/api/messages/unread-count"],
    queryFn: () => fetch("/api/messages/unread-count").then((r) => r.json()),
    refetchInterval: 30_000,
  });

  const { data: threads } = useQuery<{ threads: ThreadRow[] }>({
    queryKey: ["/api/messages/recent-threads"],
    queryFn: () => fetch("/api/messages/recent-threads").then((r) => r.json()),
    enabled: open,
  });

  const unread = count?.count ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Messages">
          <MessageSquare className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="px-3 py-2 border-b font-semibold text-sm">Messages</div>
        <ScrollArea className="max-h-96">
          {!threads?.threads?.length ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No messages yet.</div>
          ) : (
            threads.threads.map((t) => {
              const isUnread = t.direction === "inbound" && !t.readAt;
              return (
                <button
                  key={t.messageId}
                  className={`w-full text-left px-3 py-2 border-b hover:bg-muted/50 ${isUnread ? "bg-primary/5" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    navigate(`/customers/${t.customerId}#messages`);
                    // wouter strips hash; force scroll on next tick if anchor exists
                    setTimeout(() => {
                      const el = document.getElementById("messages");
                      if (el) el.scrollIntoView({ behavior: "smooth" });
                    }, 200);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">
                      {t.firstName} {t.lastName}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{fmtTime(t.createdAt)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {t.direction === "outbound" ? "→ " : ""}{t.body}
                  </div>
                </button>
              );
            })
          )}
        </ScrollArea>
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => { setOpen(false); window.location.assign(base + "settings/messaging"); }}
          >
            Messaging settings
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
