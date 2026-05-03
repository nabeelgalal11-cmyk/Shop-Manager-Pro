import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Paperclip, Upload, Trash2, FileText, Eye, Loader2, ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export type AttachmentOwnerType =
  | "repair_order"
  | "inspection"
  | "purchase"
  | "estimate"
  | "invoice"
  | "vehicle"
  | "customer"
  | "expense"
  | "used_car";

interface Attachment {
  id: number;
  fileName: string;
  mimeType: string;
  size: number;
  notes: string | null;
  uploadedById: number | null;
  uploadedByName: string | null;
  createdAt: string;
}

interface Props {
  ownerType: AttachmentOwnerType;
  ownerId: number;
  title?: string;
  description?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const ACCEPT = "image/*,application/pdf";

export function AttachmentsPanel({ ownerType, ownerId, title = "Attachments", description }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const queryKey = ["/api/attachments", ownerType, ownerId];

  const { data, isLoading } = useQuery<{ data: Attachment[] }>({
    queryKey,
    queryFn: async () => {
      const r = await fetch(
        `/api/attachments?ownerType=${encodeURIComponent(ownerType)}&ownerId=${ownerId}`,
        { credentials: "include" }
      );
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: Number.isFinite(ownerId) && ownerId > 0,
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/attachments/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok && r.status !== 204) throw new Error(await r.text());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (err: any) =>
      toast({ title: "Could not delete", description: err.message, variant: "destructive" }),
  });

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("ownerType", ownerType);
      fd.append("ownerId", String(ownerId));
      const r = await fetch("/api/attachments", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || "Upload failed");
      }
      qc.invalidateQueries({ queryKey });
      toast({ title: "Uploaded", description: file.name });
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err.message || "Try again",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const f of Array.from(files)) {
      await uploadFile(f);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const items = data?.data || [];

  return (
    <Card className="shadow-sm border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Paperclip className="h-4 w-4 text-muted-foreground" />
              {title}
              {items.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground">({items.length})</span>
              )}
            </CardTitle>
            {description && (
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Uploading…
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5 mr-1.5" /> Add file
              </>
            )}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
        ) : items.length === 0 ? (
          <div
            className="border border-dashed rounded-md py-8 text-center text-sm text-muted-foreground hover:bg-muted/30 cursor-pointer transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleFiles(e.dataTransfer.files);
            }}
          >
            <Upload className="mx-auto h-6 w-6 mb-2 opacity-50" />
            Drop photos or PDFs here, or click to browse
            <div className="text-xs mt-1 opacity-70">JPG, PNG, HEIC, PDF — up to 25 MB each</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {items.map((a) => {
              const isImage = a.mimeType.startsWith("image/");
              const url = `/api/attachments/${a.id}/download`;
              return (
                <div
                  key={a.id}
                  className="group relative border rounded-md overflow-hidden bg-muted/20"
                >
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block aspect-square bg-background flex items-center justify-center"
                  >
                    {isImage ? (
                      <img
                        src={url}
                        alt={a.fileName}
                        className="object-cover w-full h-full"
                        loading="lazy"
                      />
                    ) : a.mimeType === "application/pdf" ? (
                      <FileText className="h-10 w-10 text-red-500" />
                    ) : (
                      <ImageIcon className="h-10 w-10 text-muted-foreground" />
                    )}
                  </a>
                  <div className="p-2 text-xs">
                    <div className="truncate font-medium" title={a.fileName}>
                      {a.fileName}
                    </div>
                    <div className="text-muted-foreground flex items-center justify-between mt-0.5">
                      <span>{formatBytes(a.size)}</span>
                      <span>{new Date(a.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        className="h-7 w-7"
                        title="View"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                    <Button
                      type="button"
                      size="icon"
                      variant="destructive"
                      className="h-7 w-7"
                      title="Delete"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (confirm(`Delete ${a.fileName}?`)) remove.mutate(a.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
