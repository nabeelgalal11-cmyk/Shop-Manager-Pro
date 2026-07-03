import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import NotFound from "@/pages/not-found";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import LoginPage from "@/pages/login";
import { Loader2 } from "lucide-react";

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
import RepairOrdersBoard from "@/pages/repair-orders-board";
import RepairOrderDetail from "@/pages/repair-order-detail";
import Inventory from "@/pages/inventory";
import InventoryDetail from "@/pages/inventory-detail";
import InventoryNew from "@/pages/inventory-new";
import Inspections from "@/pages/inspections";
import InspectionsNew from "@/pages/inspections-new";
import InspectionDetail from "@/pages/inspection-detail";
import Appointments from "@/pages/appointments";
import AppointmentsNew from "@/pages/appointments-new";
import AppointmentDetail from "@/pages/appointment-detail";
import Payments from "@/pages/payments";
import Employees from "@/pages/employees";
import EmployeesNew from "@/pages/employees-new";
import TimeEntries from "@/pages/time-entries";
import Expenses from "@/pages/expenses";
import ExpensesNew from "@/pages/expenses-new";
import Reminders from "@/pages/reminders";
import CustomerCategories from "@/pages/customer-categories";
import UsedCars from "@/pages/used-cars";
import UsedCarsNew from "@/pages/used-cars-new";
import Reports from "@/pages/reports";
import Bookkeeping from "@/pages/bookkeeping";
import Purchases from "@/pages/purchases";
import PurchasesNew from "@/pages/purchases-new";
import PurchaseDetail from "@/pages/purchase-detail";
import Suppliers from "@/pages/suppliers";
import SupplierDetail from "@/pages/supplier-detail";
import ReorderReport from "@/pages/reorder-report";
import NjmvcInspections from "@/pages/njmvc";
import NjmvcNew from "@/pages/njmvc-new";
import NjmvcPrint from "@/pages/njmvc-print";
import NjmvcTemplate from "@/pages/njmvc-template";
import UsersPage from "@/pages/users";
import PermissionsPage from "@/pages/permissions";
import EmailTemplates from "@/pages/email-templates";
import CannedJobs from "@/pages/canned-jobs";
import SettingsPayments from "@/pages/settings-payments";
import SettingsMessaging from "@/pages/settings-messaging";
import PayInvoice from "@/pages/pay";
import InspectionPublic from "@/pages/inspection-public";
import EstimatePublic from "@/pages/estimate-public";
import { useLocation as useWouterLocation } from "wouter";

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
        <Route path="/repair-orders/board" component={RepairOrdersBoard} />
        <Route path="/repair-orders/new" component={RepairOrdersNew} />
        <Route path="/repair-orders/:id" component={RepairOrderDetail} />

        <Route path="/inventory" component={Inventory} />
        <Route path="/inventory/new" component={InventoryNew} />
        <Route path="/inventory/:id" component={InventoryDetail} />

        <Route path="/inspections" component={Inspections} />
        <Route path="/inspections/new" component={InspectionsNew} />
        <Route path="/inspections/:id" component={InspectionDetail} />

        <Route path="/appointments" component={Appointments} />
        <Route path="/appointments/new" component={AppointmentsNew} />
        <Route path="/appointments/:id" component={AppointmentDetail} />

        <Route path="/payments" component={Payments} />

        <Route path="/employees" component={Employees} />
        <Route path="/employees/new" component={EmployeesNew} />

        <Route path="/time-entries" component={TimeEntries} />

        <Route path="/expenses" component={Expenses} />
        <Route path="/expenses/new" component={ExpensesNew} />

        <Route path="/reminders" component={Reminders} />
        <Route path="/customer-categories" component={CustomerCategories} />
        <Route path="/used-cars" component={UsedCars} />
        <Route path="/used-cars/new" component={UsedCarsNew} />
        <Route path="/used-cars/:id" component={UsedCarsNew} />
        <Route path="/reports" component={Reports} />
        <Route path="/reports/bookkeeping" component={Bookkeeping} />
        <Route path="/purchases" component={Purchases} />
        <Route path="/purchases/new" component={PurchasesNew} />
        <Route path="/purchases/:id" component={PurchaseDetail} />
        <Route path="/suppliers" component={Suppliers} />
        <Route path="/suppliers/:id" component={SupplierDetail} />
        <Route path="/reports/reorder" component={ReorderReport} />

        <Route path="/canned-jobs" component={CannedJobs} />

        <Route path="/njmvc" component={NjmvcInspections} />
        <Route path="/njmvc/template" component={NjmvcTemplate} />
        <Route path="/njmvc/new" component={NjmvcNew} />
        <Route path="/njmvc/:id/print" component={NjmvcPrint} />
        <Route path="/njmvc/:id" component={NjmvcNew} />

        <Route path="/users" component={() => { window.location.replace((import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/employees"); return null; }} />
        <Route path="/permissions" component={PermissionsPage} />
        <Route path="/email-templates" component={EmailTemplates} />
        <Route path="/settings/payments" component={SettingsPayments} />
        <Route path="/settings/messaging" component={SettingsMessaging} />

        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();
  const [location] = useWouterLocation();
  // Public, token-protected pay pages must be reachable without a session.
  if (location.startsWith("/pay/")) return <PayInvoice />;
  if (location.startsWith("/inspection/")) return <InspectionPublic />;
  if (location.startsWith("/estimate/")) return <EstimatePublic />;
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) return <LoginPage />;
  return <Router />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <AuthGate />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
