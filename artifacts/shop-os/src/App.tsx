import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
import Customers from "@/pages/customers";
import CustomersNew from "@/pages/customers-new";
import CustomerDetail from "@/pages/customer-detail";
import Vehicles from "@/pages/vehicles";
import VehiclesNew from "@/pages/vehicles-new";
import VehicleDetail from "@/pages/vehicle-detail";
import Estimates from "@/pages/estimates";
import EstimatesNew from "@/pages/estimates-new";
import EstimateDetail from "@/pages/estimate-detail";
import Invoices from "@/pages/invoices";
import InvoicesNew from "@/pages/invoices-new";
import InvoiceDetail from "@/pages/invoice-detail";
import RepairOrders from "@/pages/repair-orders";
import RepairOrdersNew from "@/pages/repair-orders-new";
import RepairOrderDetail from "@/pages/repair-order-detail";
import Inventory from "@/pages/inventory";
import InventoryDetail from "@/pages/inventory-detail";
import InventoryNew from "@/pages/inventory-new";
import Inspections from "@/pages/inspections";
import InspectionsNew from "@/pages/inspections-new";
import Appointments from "@/pages/appointments";
import AppointmentsNew from "@/pages/appointments-new";
import Payments from "@/pages/payments";
import Employees from "@/pages/employees";
import EmployeesNew from "@/pages/employees-new";
import TimeEntries from "@/pages/time-entries";
import Expenses from "@/pages/expenses";
import ExpensesNew from "@/pages/expenses-new";
import Reminders from "@/pages/reminders";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/dashboard" component={Dashboard} />

        <Route path="/customers" component={Customers} />
        <Route path="/customers/new" component={CustomersNew} />
        <Route path="/customers/:id" component={CustomerDetail} />

        <Route path="/vehicles" component={Vehicles} />
        <Route path="/vehicles/new" component={VehiclesNew} />
        <Route path="/vehicles/:id" component={VehicleDetail} />

        <Route path="/estimates" component={Estimates} />
        <Route path="/estimates/new" component={EstimatesNew} />
        <Route path="/estimates/:id" component={EstimateDetail} />

        <Route path="/invoices" component={Invoices} />
        <Route path="/invoices/new" component={InvoicesNew} />
        <Route path="/invoices/:id" component={InvoiceDetail} />

        <Route path="/repair-orders" component={RepairOrders} />
        <Route path="/repair-orders/new" component={RepairOrdersNew} />
        <Route path="/repair-orders/:id" component={RepairOrderDetail} />

        <Route path="/inventory" component={Inventory} />
        <Route path="/inventory/new" component={InventoryNew} />
<Route path="/inventory/:id" component={InventoryDetail} />
        
        <Route path="/inspections" component={Inspections} />
        <Route path="/inspections/new" component={InspectionsNew} />

        <Route path="/appointments" component={Appointments} />
        <Route path="/appointments/new" component={AppointmentsNew} />

        <Route path="/payments" component={Payments} />

        <Route path="/employees" component={Employees} />
        <Route path="/employees/new" component={EmployeesNew} />

        <Route path="/time-entries" component={TimeEntries} />

        <Route path="/expenses" component={Expenses} />
        <Route path="/expenses/new" component={ExpensesNew} />

        <Route path="/reminders" component={Reminders} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
