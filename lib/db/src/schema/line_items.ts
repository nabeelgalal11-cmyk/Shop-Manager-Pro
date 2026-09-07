/** @deprecated The old polymorphic table was replaced by estimate_items/invoice_items. */
export { invoiceItemsTable as lineItemsTable, insertInvoiceItemSchema as insertLineItemSchema } from "./invoice_items";
export type { InvoiceItem as LineItem, InsertInvoiceItem as InsertLineItem } from "./invoice_items";