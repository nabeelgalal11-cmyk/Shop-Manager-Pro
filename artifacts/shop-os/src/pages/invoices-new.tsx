import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft } from "lucide-react";

export default function InvoicesNew() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const repairOrderId = new URLSearchParams(search).get("repairOrderId");

  useEffect(() => {
    if (repairOrderId) {
      setLocation(`/repair-orders/${repairOrderId}`);
    }
  }, [setLocation, repairOrderId]);

  return (
    <div className="p-8 max-w-2xl mx-auto mt-12">
      <Card className="border-dashed">
        <CardContent className="py-12 flex flex-col items-center text-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Create Invoices from a Repair Order</h2>
          <p className="text-muted-foreground mb-6 max-w-md">
            Final invoices are now automatically generated from authorized estimates
            when the repair order is completed. Open a Repair Order to manage its workflow.
          </p>
          <Button onClick={() => setLocation("/repair-orders")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Go to Repair Orders
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}