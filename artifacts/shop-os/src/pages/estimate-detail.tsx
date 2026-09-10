import { useRef, useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEstimate, getGetEstimateQueryKey,
  useSendEstimateRevision,
  useReplaceEstimateRevisionDraftItems,
  useGetInventory,
  getGetInventoryQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Printer, Send, Copy, Plus, Trash2, Save, X, Search, Package, Wrench } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { CannedJobPicker, type CannedJob } from "@/components/canned-job-picker";

export default function EstimateDetail() {
  const [match, params] = useRoute("/estimates/:id");
  const id = match ? parseInt(params.id) : 0;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [draftItems, setDraftItems] = useState<any[]>([]);
  const [cannedJobOpen, setCannedJobOpen] = useState(false);
  const [activePartIndex, setActivePartIndex] = useState<number | null>(null);
  const [partSearch, setPartSearch] = useState("");
  const [debouncedPartSearch, setDebouncedPartSearch] = useState("");

  const { data: estimate, isLoading } = useGetEstimate(id, {
    query: { enabled: !!id, queryKey: getGetEstimateQueryKey(id) },
  });

  const sendEstimate = useSendEstimateRevision();
  const saveDraftItems = useReplaceEstimateRevisionDraftItems();
  const inventoryQuery = useGetInventory(
    { search: debouncedPartSearch || undefined, limit: 20 },
    {
      query: {
        enabled: isEditing && activePartIndex !== null && debouncedPartSearch.length > 0,
        queryKey: getGetInventoryQueryKey({
          search: debouncedPartSearch || undefined,
          limit: 20,
        }),
      },
    },
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPartSearch(partSearch.trim()), 200);
    return () => clearTimeout(timer);
  }, [partSearch]);

  useEffect(() => {
    if (estimate && isEditing) {
      if (draftItems.length === 0 && estimate.items.length > 0) {
        setDraftItems(estimate.items.map((i: any) => ({
          kind: i.kind,
          description: i.description,
          quantity: i.kind === "labor" ? Number(i.estimatedHours ?? i.quantity) : Number(i.quantity),
          unitPrice: Number(i.unitPrice),
          priceIncludesTax: i.kind === "part" && i.priceIncludesTax === true,
        })));
      }
    }
  }, [estimate, isEditing]);

  const status = estimate?.status;
  const publicToken = estimate?.publicToken;
  const publicUrl = publicToken ? `${window.location.origin}/estimate/${publicToken}` : null;
  const isDraft = status === "draft";

  const handleSend = () => {
    sendEstimate.mutate({ revisionId: id }, {
      onSuccess: () => {
        toast({ title: "Estimate sent" });
        queryClient.invalidateQueries({ queryKey: getGetEstimateQueryKey(id) });
      },
      onError: (err: any) => {
        toast({ title: "Failed to send estimate", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleCopyLink = () => {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl).then(
      () => toast({ title: "Link copied" }),
      () => toast({ title: "Could not copy", variant: "destructive" }),
    );
  };

  const handleSaveDraft = () => {
    const payload = draftItems.map((item, idx) => ({
      position: idx + 1,
      kind: item.kind,
      description: item.description,
      quantity: String(item.quantity),
      unitPrice: String(item.unitPrice),
      ...(item.kind === "part" ? { priceIncludesTax: item.priceIncludesTax === true } : {}),
      ...(item.kind === "labor" ? { estimatedHours: String(item.quantity) } : {}),
    }));

    saveDraftItems.mutate({ revisionId: id, data: { items: payload } }, {
      onSuccess: () => {
        toast({ title: "Draft saved" });
        queryClient.invalidateQueries({ queryKey: getGetEstimateQueryKey(id) });
        setIsEditing(false);
      },
      onError: (err: any) => toast({ title: "Failed to save draft", description: err.message, variant: "destructive" }),
    });
  };

  const addDraftItem = () => {
    setDraftItems([...draftItems, { kind: "labor", description: "", quantity: 1, unitPrice: 0, priceIncludesTax: false }]);
  };
  const removeDraftItem = (index: number) => {
    setDraftItems(draftItems.filter((_, i) => i !== index));
  };
  const updateDraftItem = (index: number, field: string, value: any) => {
    const newItems = [...draftItems];
    newItems[index] = { ...newItems[index], [field]: value };
    setDraftItems(newItems);
  };

  const selectInventoryPart = (index: number, item: any) => {
    const newItems = [...draftItems];
    newItems[index] = {
      ...newItems[index],
      kind: "part",
      description: item.name,
      unitPrice: Number(item.sellPrice ?? 0),
      partNumber: item.partNumber ?? "",
      inventoryId: item.id,
    };
    setDraftItems(newItems);
    setPartSearch(item.name);
    setActivePartIndex(null);
    setDebouncedPartSearch("");
  };

  const addCannedJob = (job: CannedJob) => {
    const items = job.items.map((item) => ({
      kind: item.type,
      description: item.description,
      quantity: item.type === "labor" ? Number(item.quantity || job.estimatedHours || 1) : Number(item.quantity || 1),
      unitPrice: Number(item.unitPrice || 0),
      priceIncludesTax: false,
    }));
    setDraftItems((current) => [...current, ...items]);
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);

  const handlePrint = () => {
    const el = printRef.current;
    if (!el) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>Estimate Revision ${estimate?.revisionNo}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            h1 { font-size: 20px; margin-bottom: 4px; }
            .meta { color: #555; font-size: 13px; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; font-size: 13px; }
            th { background: #f0f0f0; text-align: left; padding: 6px 8px; font-size: 12px; }
            td { padding: 6px 8px; border-bottom: 1px solid #eee; }
            .totals { margin-top: 16px; float: right; width: 240px; font-size: 13px; }
            .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
            .totals .grand { font-weight: bold; font-size: 15px; border-top: 2px solid #ddd; margin-top: 4px; padding-top: 6px; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>${el.innerHTML}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!estimate) return <div className="p-8 text-center">Estimate not found</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation(`/repair-orders/${estimate.repairOrderId}`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight capitalize">
              {estimate.kind} #{estimate.revisionNo}
            </h1>
            <Badge variant="outline" className="mt-1 capitalize">
              {status?.replace("_", " ")}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
          {(status === "draft" || status === "sent" || status === "viewed") && (
            <Button onClick={handleSend} disabled={sendEstimate.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
              <Send className="h-4 w-4 mr-2" /> {sendEstimate.isPending ? "Sending…" : "Send for approval"}
            </Button>
          )}
        </div>
      </div>

      {publicUrl && (
        <Card className="border-dashed">
          <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">Customer approval link</p>
              <a href={publicUrl} target="_blank" rel="noreferrer" className="text-primary underline break-all">{publicUrl}</a>
            </div>
            <Button size="sm" variant="outline" onClick={handleCopyLink}>
              <Copy className="h-3.5 w-3.5 mr-1" /> Copy
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-sm border-border">
        <CardContent className="p-8">
          <div className="flex justify-between items-start mb-8">
            <div>
              <h2 className="text-lg font-bold mb-2">915motors</h2>
              <p className="text-sm text-muted-foreground">123 Mechanic St.<br />Auto City, ST 12345</p>
            </div>
            <div className="text-right">
              <h3 className="font-semibold text-lg mb-2">Estimate For</h3>
              <p className="text-sm">{(estimate.customerSnapshot as any)?.firstName} {(estimate.customerSnapshot as any)?.lastName}</p>
              {(estimate.vehicleSnapshot as any) && (
                <p className="text-sm text-muted-foreground">
                  {(estimate.vehicleSnapshot as any).year} {(estimate.vehicleSnapshot as any).make} {(estimate.vehicleSnapshot as any).model}
                </p>
              )}
            </div>
          </div>

          <Separator className="my-6" />

          {isEditing ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Edit Draft Items</h3>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setCannedJobOpen(true)}>
                    <Wrench className="h-4 w-4 mr-2" /> Find Labor / Job
                  </Button>
                  <Button variant="outline" size="sm" onClick={addDraftItem}>
                    <Plus className="h-4 w-4 mr-2" /> Add Item
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                {draftItems.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-1 items-end gap-3 rounded-md border p-3 sm:grid-cols-[120px_minmax(0,1fr)_80px_100px_auto]">
                    <div className="space-y-1.5">
                      <Label htmlFor={`draft-kind-${idx}`} className="text-xs">Type</Label>
                      <Select value={item.kind} onValueChange={(v) => updateDraftItem(idx, 'kind', v)}>
                        <SelectTrigger id={`draft-kind-${idx}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="labor">Labor</SelectItem>
                          <SelectItem value="part">Part</SelectItem>
                          <SelectItem value="fee">Fee</SelectItem>
                          <SelectItem value="discount">Discount</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`draft-description-${idx}`} className="text-xs">Description</Label>
                      <Input
                        id={`draft-description-${idx}`}
                        placeholder="Describe the work or part"
                        value={item.description}
                        onChange={(e) => updateDraftItem(idx, 'description', e.target.value)}
                      />
                      {item.kind === "part" && (
                        <div className="relative">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                              className="h-8 pl-7 text-xs"
                              placeholder="Search inventory by name, part #, or category"
                              value={activePartIndex === idx ? partSearch : ""}
                              onFocus={() => {
                                setActivePartIndex(idx);
                                setPartSearch(item.description || "");
                              }}
                              onChange={(e) => {
                                setActivePartIndex(idx);
                                setPartSearch(e.target.value);
                              }}
                            />
                          </div>
                          {activePartIndex === idx && debouncedPartSearch && (
                            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
                              {inventoryQuery.isLoading ? (
                                <div className="p-2 text-xs text-muted-foreground">Searching inventory…</div>
                              ) : inventoryQuery.isError ? (
                                <div className="p-2 text-xs text-destructive">Inventory search failed. Manual entry is still available.</div>
                              ) : inventoryQuery.data?.data?.length ? (
                                inventoryQuery.data.data.map((result: any) => (
                                  <button
                                    type="button"
                                    key={result.id}
                                    className="flex w-full items-start gap-2 rounded-sm p-2 text-left text-xs hover:bg-muted"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      selectInventoryPart(idx, result);
                                    }}
                                  >
                                    <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate font-medium">{result.name}</span>
                                      <span className="block truncate text-muted-foreground">
                                        {result.partNumber || "No part number"}{result.category ? ` · ${result.category}` : ""}
                                        {" · "}{Number(result.quantity ?? 0)} in stock
                                      </span>
                                    </span>
                                    <span className="font-medium">${Number(result.sellPrice ?? 0).toFixed(2)}</span>
                                  </button>
                                ))
                              ) : (
                                <div className="p-2 text-xs text-muted-foreground">No inventory matches. You can enter the part manually.</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {item.kind === "part" && (
                      <label className="flex items-center gap-2 text-xs sm:col-span-2">
                        <input
                          type="checkbox"
                          checked={item.priceIncludesTax === true}
                          onChange={(e) => updateDraftItem(idx, "priceIncludesTax", e.target.checked)}
                        />
                        Price includes tax
                      </label>
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor={`draft-quantity-${idx}`} className="text-xs">
                        {item.kind === "labor" ? "Hours" : "Quantity"}
                      </Label>
                      <Input
                        id={`draft-quantity-${idx}`}
                        type="number"
                        min="0"
                        step="0.001"
                        placeholder={item.kind === "labor" ? "e.g. 1.5" : "e.g. 2"}
                        value={item.quantity}
                        onChange={(e) => updateDraftItem(idx, 'quantity', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`draft-unit-price-${idx}`} className="text-xs">
                        {item.kind === "labor" ? "Hourly Rate" : "Unit Price"}
                      </Label>
                      <Input
                        id={`draft-unit-price-${idx}`}
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder={item.kind === "labor" ? "e.g. 125.00" : "e.g. 49.99"}
                        value={item.unitPrice}
                        onChange={(e) => updateDraftItem(idx, 'unitPrice', e.target.value)}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeDraftItem(idx)}
                      className="text-destructive"
                      aria-label={`Remove item ${idx + 1}`}
                      title={`Remove item ${idx + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
                <Button onClick={handleSaveDraft} disabled={saveDraftItems.isPending}>
                  <Save className="h-4 w-4 mr-2" /> Save Draft
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Items</h3>
                {isDraft && (
                  <Button variant="outline" size="sm" onClick={() => {
                    setDraftItems(estimate.items.map((i: any) => ({
                      kind: i.kind,
                      description: i.description,
                      quantity: i.kind === "labor" ? Number(i.estimatedHours ?? i.quantity) : Number(i.quantity),
                      unitPrice: Number(i.unitPrice),
                       priceIncludesTax: i.kind === "part" && i.priceIncludesTax === true,
                    })));
                    if (estimate.items.length === 0) {
                      setDraftItems([{ kind: "labor", description: "", quantity: 1, unitPrice: 0, priceIncludesTax: false }]);
                    }
                    setIsEditing(true);
                  }}>
                    Edit Items
                  </Button>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Quantity / Hours</TableHead>
                    <TableHead className="text-right">Unit Price / Hourly Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {estimate.items?.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.description}</TableCell>
                      <TableCell className="capitalize">{item.kind}</TableCell>
                      <TableCell className="text-right">
                        {item.kind === "labor" ? (item.estimatedHours ?? item.quantity) : item.quantity}
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(Number(item.unitPrice))}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(Number(item.quantity) * Number(item.unitPrice))}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!estimate.items || estimate.items.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6 text-muted-foreground text-sm">
                        No items added to this draft yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </>
          )}
          <CannedJobPicker
            open={cannedJobOpen}
            onClose={() => setCannedJobOpen(false)}
            onPick={addCannedJob}
          />

          <div className="mt-8 flex justify-end">
            <div className="w-64 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(Number(estimate.subtotal))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax</span>
                <span>{formatCurrency(Number(estimate.taxAmount))}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-lg">
                <span>Total</span>
                <span>{formatCurrency(Number(estimate.total))}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {estimate.notes && (
        <Card>
          <CardContent className="p-4">
            <h4 className="font-semibold mb-2">Notes</h4>
            <p className="text-sm text-muted-foreground">{estimate.notes}</p>
          </CardContent>
        </Card>
      )}

      <div ref={printRef} style={{ display: "none" }}>
        <h1>Estimate Revision #{estimate.revisionNo}</h1>
        <div className="meta">
          Customer: {(estimate.customerSnapshot as any)?.firstName} {(estimate.customerSnapshot as any)?.lastName} &bull;
          Vehicle: {(estimate.vehicleSnapshot as any)?.year} {(estimate.vehicleSnapshot as any)?.make} {(estimate.vehicleSnapshot as any)?.model} &bull;
          Status: {status}
        </div>
        <table>
          <thead><tr><th>Description</th><th>Type</th><th>Quantity / Hours</th><th>Unit Price / Hourly Rate</th><th>Amount</th></tr></thead>
          <tbody>
            {estimate.items?.map((item: any) => (
              <tr key={item.id}>
                <td>{item.description}</td>
                <td style={{ textTransform: "capitalize" }}>{item.kind}</td>
                <td>{item.kind === "labor" ? (item.estimatedHours ?? item.quantity) : item.quantity}</td>
                <td>{formatCurrency(Number(item.unitPrice))}</td>
                <td>{formatCurrency(Number(item.total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="totals">
          <div><span>Subtotal</span><span>{formatCurrency(Number(estimate.subtotal))}</span></div>
          <div><span>Tax</span><span>{formatCurrency(Number(estimate.taxAmount))}</span></div>
          <div className="grand"><span>Total</span><span>{formatCurrency(Number(estimate.total))}</span></div>
        </div>
      </div>
    </div>
  );
}
