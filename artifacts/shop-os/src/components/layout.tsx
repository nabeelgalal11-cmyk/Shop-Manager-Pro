import { useLocation } from "wouter";
import React, { useState } from "react";
import {
  LayoutDashboard, Users, Car, FileText, FileSpreadsheet,
  Wrench, Package, ClipboardCheck, Calendar, CreditCard,
  UserCircle, Clock, Receipt, Bell, Search, BarChart2, Tags, CarFront, ShoppingCart, Settings2,
  LogOut, Shield, KeyRound, Mail,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem,
  SidebarMenuButton, SidebarProvider, SidebarTrigger, SidebarGroup,
  SidebarGroupLabel, SidebarGroupContent
} from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationsBell } from "@/components/notifications-bell";
import { GlobalSearch } from "@/components/global-search";

interface NavItem { name: string; href: string; icon: any; resource?: string }
interface NavGroup { label: string; items: NavItem[] }

const navGroups: NavGroup[] = [
  { label: "Overview", items: [{ name: "Dashboard", href: "/", icon: LayoutDashboard, resource: "dashboard" }] },
  { label: "Service", items: [
      { name: "Repair Orders", href: "/repair-orders", icon: Wrench, resource: "repair_orders" },
      { name: "Estimates", href: "/estimates", icon: FileText, resource: "estimates" },
      { name: "Invoices", href: "/invoices", icon: FileSpreadsheet, resource: "invoices" },
      { name: "Appointments", href: "/appointments", icon: Calendar, resource: "appointments" },
      { name: "Inspections", href: "/inspections", icon: ClipboardCheck, resource: "inspections" },
    ]
  },
  { label: "Management", items: [
      { name: "Customers", href: "/customers", icon: Users, resource: "customers" },
      { name: "Vehicles", href: "/vehicles", icon: Car, resource: "vehicles" },
      { name: "Inventory", href: "/inventory", icon: Package, resource: "inventory" },
      { name: "Payments", href: "/payments", icon: CreditCard, resource: "payments" },
      { name: "Used Cars", href: "/used-cars", icon: CarFront, resource: "used_cars" },
    ]
  },
  { label: "Reports", items: [
      { name: "Purchases", href: "/purchases", icon: ShoppingCart, resource: "purchases" },
      { name: "Reports", href: "/reports", icon: BarChart2, resource: "reports" },
    ]
  },
  { label: "Compliance", items: [
      { name: "NJMVC Quarterly", href: "/njmvc", icon: ClipboardCheck, resource: "njmvc" },
      { name: "Template Editor", href: "/njmvc/template", icon: Settings2, resource: "njmvc_template" },
    ]
  },
  { label: "Admin", items: [
      { name: "Employees", href: "/employees", icon: UserCircle, resource: "employees" },
      { name: "Time Entries", href: "/time-entries", icon: Clock, resource: "time_entries" },
      { name: "Expenses", href: "/expenses", icon: Receipt, resource: "expenses" },
      { name: "Reminders", href: "/reminders", icon: Bell, resource: "reminders" },
      { name: "Customer Categories", href: "/customer-categories", icon: Tags, resource: "customer_categories" },
    ]
  },
  { label: "Security", items: [
      { name: "Users", href: "/users", icon: KeyRound, resource: "users" },
      { name: "Permissions", href: "/permissions", icon: Shield, resource: "permissions" },
      { name: "Email Templates", href: "/email-templates", icon: Mail, resource: "permissions" },
    ]
  }
];

function MenuLink({ href, icon: Icon, name, isActive, closeSidebar }: any) {
  const [, navigate] = useLocation();
  return (
    <SidebarMenuButton
      asChild
      isActive={isActive}
      tooltip={name}
      onClick={() => { navigate(href); closeSidebar(); }}
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { user, logout, can, isAdmin } = useAuth();

  const closeSidebar = () => setSidebarOpen(false);
  const initials = user
    ? (user.firstName[0] || "") + (user.lastName[0] || "")
    : "?";

  // Filter nav items by view permission for current user's resource
  const visibleGroups = navGroups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.resource || can(i.resource as any, "view")),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-background overflow-hidden">
        <Sidebar className="border-r border-sidebar-border shadow-sm" open={sidebarOpen}>
          <SidebarHeader className="py-4 px-6 border-b border-sidebar-border">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 bg-primary text-primary-foreground rounded-md flex items-center justify-center font-bold">
                OS
              </div>
              <span className="font-bold text-lg tracking-tight">ShopOS</span>
            </div>
          </SidebarHeader>

          <SidebarContent>
            {visibleGroups.map((group) => (
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
                            closeSidebar={closeSidebar}
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
              <SidebarTrigger onClick={() => setSidebarOpen(!sidebarOpen)} />
              <GlobalSearch />
            </div>
            <div className="flex items-center gap-3">
              {user && <NotificationsBell />}
              {user && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 hover:bg-muted/50 rounded-md px-2 py-1 transition-colors">
                      <div className="h-8 w-8 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center border border-border text-xs font-bold uppercase">
                        {initials}
                      </div>
                      <div className="hidden md:flex flex-col items-start leading-tight">
                        <span className="text-sm font-medium">{user.firstName} {user.lastName}</span>
                        <span className="text-[10px] text-muted-foreground capitalize">
                          {user.roles.join(", ")}
                        </span>
                      </div>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>
                      <div className="font-semibold">{user.firstName} {user.lastName}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">{user.username}</div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {isAdmin && (
                      <>
                        <DropdownMenuItem onClick={() => window.location.assign(import.meta.env.BASE_URL + "users")}>
                          <KeyRound className="h-4 w-4 mr-2" /> Users
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => window.location.assign(import.meta.env.BASE_URL + "permissions")}>
                          <Shield className="h-4 w-4 mr-2" /> Permissions
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem onClick={() => logout()} className="text-destructive">
                      <LogOut className="h-4 w-4 mr-2" /> Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </header>
          <div className="flex-1 overflow-auto bg-muted/20">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}
