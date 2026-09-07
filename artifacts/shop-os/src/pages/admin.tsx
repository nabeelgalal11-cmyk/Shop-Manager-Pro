import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import {
  Bell,
  BriefcaseBusiness,
  CreditCard,
  Mail,
  Receipt,
  Settings2,
  Shield,
  Tags,
  UserCircle,
  Wrench,
} from "lucide-react";

type AdminLink = {
  name: string;
  href: string;
  description: string;
  icon: any;
  resource: string;
};

type AdminSection = {
  title: string;
  description: string;
  items: AdminLink[];
};

const sections: AdminSection[] = [
  {
    title: "People & access",
    description: "Manage employees and control what each role can access.",
    items: [
      { name: "Employees", href: "/employees", description: "Manage staff accounts and employee details.", icon: UserCircle, resource: "employees" },
      { name: "Permissions", href: "/permissions", description: "Control roles and access to shop features.", icon: Shield, resource: "permissions" },
    ],
  },
  {
    title: "Pricing & workflow",
    description: "Set defaults that keep estimates and repair orders consistent.",
    items: [
      { name: "Shop Settings", href: "/settings/shop", description: "Change the default labor rate used in profitability.", icon: Settings2, resource: "permissions" },
      { name: "Customer Categories", href: "/customer-categories", description: "Set category-specific labor rates and parts markups.", icon: Tags, resource: "customer_categories" },
      { name: "Canned Jobs", href: "/canned-jobs", description: "Create reusable labor, part, fee, and discount packages.", icon: Wrench, resource: "canned_jobs" },
    ],
  },
  {
    title: "Communication & payments",
    description: "Configure customer communications and online payment tools.",
    items: [
      { name: "Email Templates", href: "/email-templates", description: "Customize the messages sent by the shop.", icon: Mail, resource: "permissions" },
      { name: "Payments (Stripe)", href: "/settings/payments", description: "Configure online payment settings and webhooks.", icon: CreditCard, resource: "permissions" },
      { name: "Messaging (SMS)", href: "/settings/messaging", description: "Configure outgoing text messages.", icon: Mail, resource: "permissions" },
    ],
  },
  {
    title: "Shop operations",
    description: "Keep track of staff time, expenses, and follow-up work.",
    items: [
      { name: "Time Entries", href: "/time-entries", description: "Review technician time recorded against repair orders.", icon: BriefcaseBusiness, resource: "time_entries" },
      { name: "Expenses", href: "/expenses", description: "Track shop expenses and operating costs.", icon: Receipt, resource: "expenses" },
      { name: "Reminders", href: "/reminders", description: "Manage internal reminders and follow-ups.", icon: Bell, resource: "reminders" },
    ],
  },
];

export default function Admin() {
  const { can } = useAuth();

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Settings2 className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
          <p className="text-muted-foreground mt-1">
            Manage shop settings, access, pricing, communication, and daily administration from one place.
          </p>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {sections.map((section) => {
          const items = section.items.filter((item) => can(item.resource as any, "view"));
          if (items.length === 0) return null;

          return (
            <Card key={section.title} className="border-border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">{section.title}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href}>
                      <div className="group flex items-center gap-3 rounded-lg border border-transparent p-3 transition-colors hover:border-border hover:bg-muted/50">
                        <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium group-hover:text-primary transition-colors">{item.name}</p>
                          <p className="text-xs text-muted-foreground">{item.description}</p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}