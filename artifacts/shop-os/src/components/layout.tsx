import { useLocation } from "wouter";
import {
  LayoutDashboard, Users, Car, FileText, FileSpreadsheet,
  Wrench, Package, ClipboardCheck, Calendar, CreditCard,
  UserCircle, Clock, Receipt, Bell, Search
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem,
  SidebarMenuButton, SidebarProvider, SidebarTrigger, SidebarGroup,
  SidebarGroupLabel, SidebarGroupContent, useSidebar
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
