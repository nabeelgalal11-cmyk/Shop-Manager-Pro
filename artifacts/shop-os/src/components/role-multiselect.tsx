import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "technician", label: "Technician" },
  { value: "service_advisor", label: "Service Advisor" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
  { value: "receptionist", label: "Receptionist" },
];

export function formatRole(value: string): string {
  return ROLE_OPTIONS.find((o) => o.value === value)?.label ??
    value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface RoleMultiSelectProps {
  value: string[];
  onChange: (roles: string[]) => void;
}

export function RoleMultiSelect({ value, onChange }: RoleMultiSelectProps) {
  const toggle = (role: string, checked: boolean) => {
    if (checked) {
      if (!value.includes(role)) onChange([...value, role]);
    } else {
      onChange(value.filter((r) => r !== role));
    }
  };

  return (
    <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
      {ROLE_OPTIONS.map((opt) => {
        const checked = value.includes(opt.value);
        return (
          <label
            key={opt.value}
            className="flex items-center gap-2 cursor-pointer text-sm"
          >
            <Checkbox
              checked={checked}
              onCheckedChange={(c) => toggle(opt.value, !!c)}
            />
            <span>{opt.label}</span>
          </label>
        );
      })}
    </div>
  );
}
