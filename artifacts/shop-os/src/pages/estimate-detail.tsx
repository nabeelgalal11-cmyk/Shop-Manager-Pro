import { useRoute, useLocation } from "wouter";
import { 
  useGetEstimate, getGetEstimateQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Printer, FileCheck } from "lucide-react";
import { Separator } from "@/components/ui/separator";

export default function EstimateDetail() {
  const [match, params] = useRoute("/estimates/:id");
  const id = match ? parseInt(params.id) : 0;
  const [, setLocation] = useLocation();

  const { data: estimate, isLoading } = useGetEstimate(id, { 
    query: { enabled: !!id, queryKey: getGetEstimateQueryKey(id) } 
  });
  
  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!estimate) {
    return <div className="p-8 text-center">Estimate not found</div>;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/estimates")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Estimate {estimate.estimateNumber}</h1>
            <Badge variant="outline" className="mt-1 capitalize">{estimate.status}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline"><Printer className="h-4 w-4 mr-2" /> Print</Button>
          {estimate.status !== 'converted' && <Button className="bg-green-600 hover:bg-green-700 text-white"><FileCheck className="h-4 w-4 mr-2" /> Convert to Invoice</Button>}
        </div>
      </div>

      <Card className="shadow-sm border-border">
        <CardContent className="p-8">
          <div className="flex justify-between items-start mb-8">
            <div>
              <h2 className="text-lg font-bold mb-2">ShopOS Auto Repair</h2>
              <p className="text-sm text-muted-foreground">123 Mechanic St.<br/>Auto City, ST 12345</p>
            </div>
            <div className="text-right">
              <h3 className="font-semibold text-lg mb-2">Estimate For</h3>
              <p className="text-sm">{estimate.customer?.firstName} {estimate.customer?.lastName}</p>
              {estimate.vehicle && <p className="text-sm text-muted-foreground">{estimate.vehicle.year} {estimate.vehicle.make} {estimate.vehicle.model}</p>}
            </div>
          </div>
          
          <Separator className="my-8" />
          
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {estimate.lineItems?.map(item => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.description}</TableCell>
                  <TableCell className="capitalize">{item.type}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(item.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-8 flex justify-end">
            <div className="w-64 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(estimate.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax</span>
                <span>{formatCurrency(estimate.taxAmount)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-lg">
                <span>Estimated Total</span>
                <span>{formatCurrency(estimate.total)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}