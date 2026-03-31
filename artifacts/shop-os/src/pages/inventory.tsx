import { useGetInventory, getGetInventoryQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Inventory() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useGetInventory({ limit: 50 }, { query: { queryKey: getGetInventoryQueryKey({ limit: 50 }) } });
  const items = Array.isArray(data) ? data : data?.data || [];
  
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Inventory</h1>
          <p className="text-muted-foreground">Manage parts and supplies.</p>
        </div>
        <Button onClick={() => setLocation("/inventory/new")}><Plus className="mr-2 h-4 w-4" /> Add Part</Button>
      </div>
      <Card className="shadow-sm border-border">
        <Table>
          <TableHeader><TableRow><TableHead>Part #</TableHead><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Stock</TableHead><TableHead>Price</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(part => (
              <TableRow key={part.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setLocation(`/inventory/${part.id}`)}>
                <TableCell className="font-mono">{part.partNumber || '-'}</TableCell>
                <TableCell className="font-medium">{part.name}</TableCell>
                <TableCell>{part.category}</TableCell>
                <TableCell>
                  {part.quantity <= part.minQuantity ? (
                    <Badge variant="destructive">{part.quantity} (Low)</Badge>
                  ) : (
                    <Badge variant="outline">{part.quantity}</Badge>
                  )}
                </TableCell>
                <TableCell>${part.sellPrice}</TableCell>
              </TableRow>
            ))}
            {items.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No inventory items found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}