import { useLocation } from "wouter";
import {
  LayoutDashboard, Users, Car, FileText, FileSpreadsheet,
  Wrench, Package, ClipboardCheck, Calendar, CreditCard,
  UserCircle, Clock, Receipt, Bell, Search
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem,
  SidebarMenuButton, SidebarProvider, SidebarTrigger, SidebarGroup,
  SidebarGroupLabel, SidebarGroupContent
} from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";

const navGroups = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
    ]
  },
  {
    label: "Service",
    items: [
      { name: "Repair Orders", href: "/repair-orders", icon: Wrench },
      { name: "Estimates", href: "/estimates", icon: FileText },
      { name: "Invoices", href: "/invoices", icon: FileSpreadsheet },
      { name: "Appointments", href: "/appointments", icon: Calendar },
      { name: "Inspections", href: "/inspections", icon: ClipboardCheck },
    ]
  },
  {
    label: "Management",
    items: [
      { name: "Customers", href: "/customers", icon: Users },
      { name: "Vehicles", href: "/vehicles", icon: Car },
      { name: "Inventory", href: "/inventory", icon: Package },
      { name: "Payments", href: "/payments", icon: CreditCard },
    ]
  },
  {
    label: "Admin",
    items: [
      { name: "Employees", href: "/employees", icon: UserCircle },
      { name: "Time Entries", href: "/time-entries", icon: Clock },
      { name: "Expenses", href: "/expenses", icon: Receipt },
      { name: "Reminders", href: "/reminders", icon: Bell },
    ]
  }
];

// MenuLink handles SPA navigation without calling sidebar.close()
function MenuLink({ href, icon: Icon, name, isActive }: any) {
  const [, navigate] = useLocation();

  return (
    <SidebarMenuButton
      asChild
      isActive={isActive}
      tooltip={name}
      onClick={() => {
        navigate(href); // SPA navigation
        // No sidebar.close() call; it will auto-close on mobile automatically
      }}
    >
      <button className="flex items-center gap-3">
        <Icon className="h-4 w-4" />
        <span className="font-medium">{name}</span>
      </button>
    </SidebarMenuButton>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-background overflow-hidden">
        <Sidebar className="border-r border-sidebar-border shadow-sm">
          <SidebarHeader className="py-4 px-6 border-b border-sidebar-border">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 bg-primary text-primary-foreground rounded-md flex items-center justify-center font-bold">
                OS
              </div>
              <span className="font-bold text-lg tracking-tight">ShopOS</span>
            </div>
          </SidebarHeader>

          <SidebarContent>
            {navGroups.map((group) => (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel className="text-sidebar-foreground/60 uppercase tracking-wider text-xs font-semibold px-6 py-2">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => {
                      const isActive =
                        location === item.href ||
                        (item.href !== "/" && location.startsWith(item.href));
                      return (
                        <SidebarMenuItem key={item.name} className="px-3">
                          <MenuLink
                            href={item.href}
                            icon={item.icon}
                            name={item.name}
                            isActive={isActive}
                          />
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
        </Sidebar>

        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="h-16 flex items-center justify-between px-6 border-b bg-card text-card-foreground">
            <div className="flex items-center gap-4">
              <SidebarTrigger />
              <div className="relative w-64 hidden md:block">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search customers, vehicles, ROs..."
                  className="pl-9 h-9 bg-muted/50 border-transparent focus-visible:ring-primary focus-visible:border-primary transition-all"
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <div className="h-8 w-8 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center border border-border">
                  JD
                </div>
              </div>
            </div>
          </header>
          <div className="flex-1 overflow-auto bg-muted/20">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}
