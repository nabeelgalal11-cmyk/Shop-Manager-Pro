import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  useGetCustomers,
  getGetCustomersQueryKey,
  useGetCustomer,
  getGetCustomerQueryKey,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface CustomerComboboxProps {
  value: number | null | undefined;
  onChange: (customerId: number) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function CustomerCombobox({
  value,
  onChange,
  placeholder = "Select a customer",
  className,
  disabled,
}: CustomerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const params = search.trim()
    ? { search: search.trim(), limit: 20 }
    : { limit: 20 };
  const { data, isFetching } = useGetCustomers(params, {
    query: { queryKey: getGetCustomersQueryKey(params) },
  });

  const { data: selectedCustomer } = useGetCustomer(value ?? 0, {
    query: {
      enabled: !!value,
      queryKey: getGetCustomerQueryKey(value ?? 0),
    },
  });

  const customers = data?.data ?? [];
  const selected =
    customers.find((c) => c.id === value) ??
    (selectedCustomer && selectedCustomer.id === value ? selectedCustomer : undefined);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground",
            className
          )}
        >
          {selected
            ? `${selected.firstName} ${selected.lastName}`
            : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        align="start"
        style={{ width: "var(--radix-popover-trigger-width)" }}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by name, phone, email..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {isFetching ? "Searching..." : "No customers found."}
            </CommandEmpty>
            <CommandGroup>
              {customers.map((c) => {
                const label = `${c.firstName} ${c.lastName}`;
                const sublabel = [c.phone, c.email].filter(Boolean).join(" • ");
                return (
                  <CommandItem
                    key={c.id}
                    value={String(c.id)}
                    onSelect={() => {
                      onChange(c.id!);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === c.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">{label}</span>
                      {sublabel && (
                        <span className="text-xs text-muted-foreground">
                          {sublabel}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
