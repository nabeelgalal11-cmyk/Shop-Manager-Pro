import { useState } from "react";
import { useGetActivity, getGetActivityQueryKey, type ActivityEvent } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Activity, ArrowRightCircle, Mail, MessageSquare, Paperclip, FileText,
  CheckCircle2, XCircle, DollarSign, AlertCircle, UserPlus, Plus, Send, Clock, Trash2,
} from "lucide-react";

type EntityType = "repair_order" | "invoice" | "estimate" | "customer" | "vehicle" | "inspection" | "appointment";

interface Props {
  entityType: EntityType;
  entityId: number;
  title?: string;
  description?: string;
}

function iconFor(eventType: string) {
  switch (eventType) {
    case "created": return <Plus className="h-4 w-4" />;
    case "updated": return <Activity className="h-4 w-4" />;
    case "status_changed": return <ArrowRightCircle className="h-4 w-4" />;
    case "assigned": return <UserPlus className="h-4 w-4" />;
    case "note_added": return <FileText className="h-4 w-4" />;
    case "email_sent": return <Mail className="h-4 w-4" />;
    case "sms_sent": return <MessageSquare className="h-4 w-4" />;
    case "payment_received": return <DollarSign className="h-4 w-4" />;
    case "payment_failed": return <AlertCircle className="h-4 w-4" />;
    case "attachment_uploaded":
    case "attachment_deleted": return <Paperclip className="h-4 w-4" />;
    case "estimate_sent":
    case "inspection_sent": return <Send className="h-4 w-4" />;
    case "estimate_approved":
    case "inspection_approved": return <CheckCircle2 className="h-4 w-4" />;
    case "estimate_declined": return <XCircle className="h-4 w-4" />;
    case "estimate_converted": return <ArrowRightCircle className="h-4 w-4" />;
    case "deleted": return <Trash2 className="h-4 w-4" />;
    default: return <Clock className="h-4 w-4" />;
  }
}

function colorFor(eventType: string): string {
  if (eventType === "payment_received" || eventType === "estimate_approved" || eventType === "inspection_approved") return "text-emerald-600 bg-emerald-50";
  if (eventType === "payment_failed" || eventType === "estimate_declined" || eventType === "attachment_deleted" || eventType === "deleted") return "text-red-600 bg-red-50";
  if (eventType === "email_sent" || eventType === "sms_sent" || eventType === "estimate_sent" || eventType === "inspection_sent") return "text-blue-600 bg-blue-50";
  if (eventType === "status_changed" || eventType === "estimate_converted") return "text-amber-700 bg-amber-50";
  if (eventType === "created") return "text-violet-600 bg-violet-50";
  return "text-slate-600 bg-slate-100";
}

function formatRelative(dateStr: string): string {
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString();
}

function describe(ev: ActivityEvent): string {
  const meta = (ev.meta ?? {}) as Record<string, unknown>;
  switch (ev.eventType) {
    case "created":
      return meta.orderNumber ? `Created ${meta.orderNumber}` :
             meta.invoiceNumber ? `Created ${meta.invoiceNumber}` :
             meta.estimateNumber ? `Created ${meta.estimateNumber}` : "Created";
    case "status_changed":
      return `Status changed${meta.from ? ` from ${meta.from}` : ""} to ${meta.to ?? "?"}`;
    case "assigned":
      return meta.assignedToId ? `Assigned to technician #${meta.assignedToId}` : "Unassigned";
    case "note_added":
      return "Note added";
    case "email_sent":
      return `Email sent${meta.template ? ` (${String(meta.template).replace(/_/g, " ")})` : ""}${meta.to ? ` to ${meta.to}` : ""}`;
    case "sms_sent":
      return `SMS sent${meta.context ? ` (${String(meta.context).replace(/_/g, " ")})` : ""}`;
    case "payment_received":
      return `Payment received${meta.amount != null ? ` $${Number(meta.amount).toFixed(2)}` : ""}${meta.method ? ` (${meta.method})` : ""}`;
    case "payment_failed":
      return `Payment failed${meta.reason ? `: ${meta.reason}` : ""}`;
    case "attachment_uploaded":
      return `Attachment uploaded${meta.fileName ? `: ${meta.fileName}` : ""}`;
    case "attachment_deleted":
      return `Attachment removed${meta.fileName ? `: ${meta.fileName}` : ""}`;
    case "estimate_sent": return "Estimate sent to customer";
    case "inspection_sent": return "Inspection sent to customer";
    case "estimate_approved": return meta.signerName ? `Approved by ${meta.signerName}` : "Approved by customer";
    case "inspection_approved": return meta.signerName ? `Inspection approved by ${meta.signerName}` : "Inspection approved by customer";
    case "estimate_declined": return meta.reason ? `Declined: ${meta.reason}` : "Declined by customer";
    case "estimate_converted":
      if (meta.target === "invoice" || meta.invoiceNumber) {
        return meta.invoiceNumber ? `Converted to ${meta.invoiceNumber}` : "Converted to invoice";
      }
      return meta.orderNumber ? `Converted to ${meta.orderNumber}` : "Converted to repair order";
    case "deleted":
      return meta.orderNumber ? `Deleted ${meta.orderNumber}` :
             meta.invoiceNumber ? `Deleted ${meta.invoiceNumber}` :
             meta.estimateNumber ? `Deleted ${meta.estimateNumber}` : "Deleted";
    case "updated":
      return "Updated";
    default:
      return ev.eventType.replace(/_/g, " ");
  }
}

function actorOf(ev: ActivityEvent): string {
  if (ev.actorName && ev.actorName.trim().length > 0) return ev.actorName.trim();
  if (ev.actorLabel) return ev.actorLabel;
  return "System";
}

function actorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ActivityTimeline({ entityType, entityId, title = "Activity", description }: Props) {
  const [beforeId, setBeforeId] = useState<number | undefined>(undefined);
  const [accumulated, setAccumulated] = useState<ActivityEvent[]>([]);
  const [exhausted, setExhausted] = useState(false);

  const params = { entityType, entityId, limit: 25, ...(beforeId ? { beforeId } : {}) };
  const { data, isLoading, isFetching } = useGetActivity(params, {
    query: {
      queryKey: getGetActivityQueryKey(params),
      enabled: entityId > 0,
    },
  });

  const initialEvents = !beforeId && data ? data.data : [];
  const events: ActivityEvent[] = beforeId ? [...accumulated, ...(data?.data ?? [])] : initialEvents;
  const hasMore = data?.hasMore && !exhausted;

  const loadMore = () => {
    if (!data || !data.hasMore || !data.nextBeforeId) return;
    setAccumulated((prev) => [...prev, ...(data?.data ?? [])]);
    setBeforeId(data.nextBeforeId);
    if (!data.hasMore) setExhausted(true);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          {title}
        </CardTitle>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent>
        {isLoading && !beforeId ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          <ol className="relative border-l border-border pl-6 space-y-4">
            {events.map((ev) => {
              const actor = actorOf(ev);
              return (
                <li key={ev.id} className="relative">
                  <span className={`absolute -left-[33px] flex h-6 w-6 items-center justify-center rounded-full ${colorFor(ev.eventType)}`}>
                    {iconFor(ev.eventType)}
                  </span>
                  <div className="flex items-start gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-[10px]">{actorInitials(actor)}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      <div className="text-sm font-medium">{describe(ev)}</div>
                      <div className="text-xs text-muted-foreground">
                        {actor} &middot; {formatRelative(ev.createdAt as unknown as string)}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {hasMore ? (
          <div className="mt-4 flex justify-center">
            <Button variant="outline" size="sm" onClick={loadMore} disabled={isFetching}>
              {isFetching ? "Loading…" : "Load older"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
