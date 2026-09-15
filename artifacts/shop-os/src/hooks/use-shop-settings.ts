import { useQuery } from "@tanstack/react-query";

export interface ShopDocumentInfo {
  shopName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  email: string;
  ein: string;
  website: string;
  additionalInfo: string;
}

export function useShopSettings() {
  return useQuery<ShopDocumentInfo>({
    queryKey: ["/api/settings/shop"],
    queryFn: async () => {
      const response = await fetch("/api/settings/shop");
      if (!response.ok) throw new Error("Unable to load shop settings");
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}