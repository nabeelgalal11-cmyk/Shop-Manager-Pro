import { useGetEmployees, getGetEmployeesQueryKey, useClockIn, useClockOut } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus, CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function Employees() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data, isLoading } = useGetEmployees({}, { query: { queryKey: getGetEmployeesQueryKey() } });
  const items = Array.isArray(data) ? data : data?.data || [];

  const clockIn = useClockIn();
  const clockOut = useClockOut();

  const handleClockIn = (id: number) => {
    clockIn.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Clocked in successfully" });
        queryClient.invalidateQueries({ queryKey: getGetEmployeesQueryKey() });
      }
    });
  };

  const handleClockOut = (id: number) => {
    clockOut.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Clocked out successfully" });
        queryClient.invalidateQueries({ queryKey: getGetEmployeesQueryKey() });
      }
    });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Employees</h1>
          <p className="text-muted-foreground mt-1">Manage staff and time tracking.</p>
        </div>
        <Button onClick={() => setLocation("/employees/new")} className="shadow-sm font-medium">
          <Plus className="mr-2 h-4 w-4" /> Add Employee
        </Button>
      </div>

      <Card className="shadow-sm border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((emp) => (
              <TableRow key={emp.id} className="hover:bg-muted/50 transition-colors">
                <TableCell className="font-medium">{emp.firstName} {emp.lastName}</TableCell>
                <TableCell className="capitalize">{emp.role.replace('_', ' ')}</TableCell>
                <TableCell>
                  {emp.clockedIn ? (
                    <Badge className="bg-green-600 hover:bg-green-600"><CheckCircle className="mr-1 h-3 w-3" /> Clocked In</Badge>
                  ) : (
                    <Badge variant="secondary">Clocked Out</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {emp.clockedIn ? (
                    <Button variant="outline" size="sm" onClick={() => handleClockOut(emp.id)} disabled={clockOut.isPending}>Clock Out</Button>
                  ) : (
                    <Button variant="default" size="sm" onClick={() => handleClockIn(emp.id)} disabled={clockIn.isPending}>Clock In</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No employees found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}