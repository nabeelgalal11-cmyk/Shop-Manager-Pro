import { db, shopSettingsTable } from "@workspace/db";

export type ShopDocumentInfo = {
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
};

export async function getShopDocumentInfo(): Promise<ShopDocumentInfo> {
  const [row] = await db.select().from(shopSettingsTable).limit(1);
  return {
    shopName: row?.shopName ?? "915motors",
    addressLine1: row?.addressLine1 ?? "",
    addressLine2: row?.addressLine2 ?? "",
    city: row?.city ?? "",
    state: row?.state ?? "",
    postalCode: row?.postalCode ?? "",
    phone: row?.phone ?? "",
    email: row?.email ?? "",
    ein: row?.ein ?? "",
    website: row?.website ?? "",
    additionalInfo: row?.additionalInfo ?? "",
  };
}