import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Send, Loader2 } from "lucide-react";

interface Message {
  id: number;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  createdAt: string;
  failureReason: string | null;
}

interface ThreadResponse { messages: Message[] }

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function CustomerMessageThread({ customerId }: { customerId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<ThreadResponse>({
    queryKey: ["/api/messages", customerId],
    queryFn: () => fetch(`/api/messages?customerId=${customerId}`).then((r) => r.json()),
    refetchInterval: 15_000,
  });

  // Mark thread read on open + whenever new inbound messages appear.
  useEffect(() => {
    if (!data) return;
    fetch(`/api/messages/${customerId}/read`, { method: "POST" })
      .then(() => qc.invalidateQueries({ queryKey: ["/api/messages/unread-count"] }))
      .catch(() => { /* best-effort */ });
  }, [data, customerId, qc]);

  // Auto-scroll to newest message.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [data]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const r = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, body }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || "Failed to send");
      }
      setDraft("");
      qc.invalidateQueries({ queryKey: ["/api/messages", customerId] });
      qc.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const messages = data?.messages ?? [];

  return (
    <Card className="shadow-sm border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" /> Text Messages
        </CardTitle>
        <CardDescription>SMS conversation with this customer.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          ref={scrollRef}
          className="border rounded-md bg-muted/20 p-3 h-72 overflow-y-auto space-y-2"
        >
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading…</div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No messages yet.</div>
          ) : (
            messages.map((m) => {
              const isOut = m.direction === "outbound";
              return (
                <div key={m.id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[75%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                      isOut ? "bg-primary text-primary-foreground" : "bg-background border"
                    }`}
                  >
                    <div>{m.body}</div>
                    <div className={`mt-1 text-[10px] flex items-center gap-2 ${isOut ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      <span>{fmtTime(m.createdAt)}</span>
                      {isOut && (
                        <Badge variant={m.status === "failed" ? "destructive" : "secondary"} className="px-1 py-0 text-[9px] capitalize">
                          {m.status}
                        </Badge>
                      )}
                      {m.failureReason && <span className="italic">— {m.failureReason}</span>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="flex gap-2">
          <Textarea
            placeholder="Type a message…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
            }}
          />
          <Button onClick={send} disabled={sending || !draft.trim()} className="self-end">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-2" /> Send</>}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Cmd/Ctrl + Enter to send. Customers can reply STOP at any time to opt out.</p>
      </CardContent>
    </Card>
  );
}
