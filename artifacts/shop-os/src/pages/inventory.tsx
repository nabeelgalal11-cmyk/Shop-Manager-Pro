import { useState } from "react";
import { useGetInventory, getGetInventoryQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Inventory() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useGetInventory(
    { limit: 200 },
    { query: { queryKey: getGetInventoryQueryKey({ limit: 200 }) } }
  );
  const allItems = Array.isArray(data) ? data : data?.data || [];

  const query = search.toLowerCase().trim();
  const items = query
    ? allItems.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          (p.partNumber ?? "").toLowerCase().includes(query) ||
          (p.category ?? "").toLowerCase().includes(query)
      )
    : allItems;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Inventory</h1>
          <p className="text-muted-foreground">Manage parts and supplies.</p>
        </div>
        <Button onClick={() => setLocation("/inventory/new")}>
          <Plus className="mr-2 h-4 w-4" /> Add Part
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, part #, or category..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card className="shadow-sm border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Part #</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead className="text-right">Sell Price</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((part) => (
              <TableRow
                key={part.id}
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setLocation(`/inventory/${part.id}`)}
              >
                <TableCell className="font-mono text-sm">{part.partNumber || "—"}</TableCell>
                <TableCell className="font-medium">{part.name}</TableCell>
                <TableCell>{part.category}</TableCell>
                <TableCell>
                  {part.quantity <= part.minQuantity ? (
                    <Badge variant="destructive">{part.quantity} — Low Stock</Badge>
                  ) : (
                    <Badge variant="outline">{part.quantity} in stock</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right font-medium">
                  ${Number(part.sellPrice).toFixed(2)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  ${Number(part.costPrice).toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  {query ? `No results for "${search}"` : "No inventory items found"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {query && (
        <p className="text-sm text-muted-foreground">
          Showing {items.length} of {allItems.length} items
        </p>
      )}
    </div>
  );
}
