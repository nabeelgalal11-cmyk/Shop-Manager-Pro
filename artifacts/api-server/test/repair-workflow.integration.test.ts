import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  db, pool, customersTable, employeesTable, vehiclesTable,
} from "@workspace/db";
import {
  WorkflowError, cancelRepairOrder, completeRepairOrder, createFinalInvoice,
  createRepairOrder, createRevision, decideRevision, finalizeProcessorPayment,
  getRepairOrderWorkflow, issueInvoice, performWorkItem, reconcileProcessorPayment,
  recordPayment, replaceDraftItems, reversePayment, sendRevision, voidInvoice,
} from "../src/lib/repair-workflow.ts";

const prefix = `__repair_test_${process.pid}_${Date.now()}__`;
let actorId: number;
let customerId: number;
let vehicleId: number;

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `select ro.id from repair_orders ro join customers c on c.id=ro.customer_id where c.last_name like $1`,
      [`${prefix}%`],
    );
    const ids = rows.map((row) => row.id);
    if (ids.length) {
      const triggerTables = [
        "estimate_approvals", "estimate_approval_items", "repair_order_events",
        "estimate_revisions", "estimate_items", "invoice_items", "payments",
      ];
      for (const table of triggerTables) await client.query(`alter table ${table} disable trigger user`);
      await client.query(`delete from stock_movements where work_item_id in
        (select id from repair_order_work_items where repair_order_id=any($1::int[]))`, [ids]);
      await client.query(`delete from idempotency_keys where scope in
        (select 'payment:' || id from invoices where repair_order_id=any($1::int[]))`, [ids]);
      await client.query(`delete from payments where invoice_id in
        (select id from invoices where repair_order_id=any($1::int[]))`, [ids]);
      await client.query(`delete from invoice_items where invoice_id in
        (select id from invoices where repair_order_id=any($1::int[]))`, [ids]);
      await client.query("delete from invoices where repair_order_id=any($1::int[])", [ids]);
      await client.query(`delete from estimate_approval_items where approval_id in
        (select ea.id from estimate_approvals ea
         join estimate_revisions er on er.id=ea.estimate_revision_id
         where er.repair_order_id=any($1::int[]))`, [ids]);
      await client.query(`delete from estimate_approvals where estimate_revision_id in
        (select id from estimate_revisions where repair_order_id=any($1::int[]))`, [ids]);
      await client.query("delete from repair_orders where id=any($1::int[])", [ids]);
      for (const table of triggerTables.reverse()) await client.query(`alter table ${table} enable trigger user`);
    }
    await client.query("delete from vehicles where customer_id in (select id from customers where last_name like $1)", [`${prefix}%`]);
    await client.query("delete from customers where last_name like $1", [`${prefix}%`]);
    await client.query("delete from employees where last_name like $1", [`${prefix}%`]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

before(async () => {
  await cleanup();
  [actorId] = (await db.insert(employeesTable).values({
    firstName: "Repair", lastName: `${prefix}manager`, role: "admin", roles: ["admin"], active: true,
  }).returning({ id: employeesTable.id })).map((x) => x.id);
  [customerId] = (await db.insert(customersTable).values({
    firstName: "Repair", lastName: `${prefix}customer`, email: `${prefix}@example.invalid`,
  }).returning({ id: customersTable.id })).map((x) => x.id);
  [vehicleId] = (await db.insert(vehiclesTable).values({
    customerId, year: 2024, make: "Test", model: "Fixture", vin: `${prefix}vin`,
  }).returning({ id: vehiclesTable.id })).map((x) => x.id);
});
after(cleanup);

async function authorized(items = [
  { position: 1, kind: "labor" as const, description: "Diagnosis", quantity: "1.500", unitPrice: "100.00" },
  { position: 2, kind: "part" as const, description: "Part", quantity: "1.000", unitPrice: "50.00" },
]) {
  const ro = await createRepairOrder({ customerId, vehicleId, assignedToId: actorId }, actorId);
  const revision = await createRevision(ro.id, "estimate", actorId, 625);
  await replaceDraftItems(revision.id, items, actorId);
  const sent = await sendRevision(revision.id, actorId);
  const workflow = await getRepairOrderWorkflow(ro.id);
  const ids = workflow.revisions[0].items.map((item) => item.id);
  await decideRevision(sent.publicToken!, {
    signerName: "Test Signer", decision: "approved", approvedItemIds: ids, declinedItemIds: [],
  });
  return { ro, revision, ids };
}

async function completedInvoice() {
  const { ro } = await authorized();
  let workflow = await getRepairOrderWorkflow(ro.id);
  for (const work of workflow.workItems) await performWorkItem(work.id, actorId);
  await completeRepairOrder(ro.id, actorId);
  const invoice = await createFinalInvoice(ro.id, actorId);
  return { ro, invoice: await issueInvoice(invoice.id, actorId) };
}

test("tax-inclusive part prices are not taxed again and survive authorization", async () => {
  const { ro, revision } = await authorized([
    { position: 1, kind: "part" as const, description: "Tax-included part", quantity: 1, unitPrice: 50, priceIncludesTax: true },
    { position: 2, kind: "labor" as const, description: "Taxable labor", quantity: 1, unitPrice: 50 },
  ]);
  const workflow = await getRepairOrderWorkflow(ro.id);
  assert.equal((await getRepairOrderWorkflow(ro.id)).revisions[0].taxAmount, "3.13");
  assert.equal(workflow.revisions[0].items[0].priceIncludesTax, true);
  assert.equal(workflow.workItems[0].priceIncludesTax, true);
  for (const work of workflow.workItems) await performWorkItem(work.id, actorId);
  await completeRepairOrder(ro.id, actorId);
  const invoice = await createFinalInvoice(ro.id, actorId);
  assert.equal(invoice.taxAmount, "3.13");
  const finalWorkflow = await getRepairOrderWorkflow(ro.id);
  assert.equal(finalWorkflow.invoice?.items[0].priceIncludesTax, true);
});

test("happy path reaches paid with exactly one immutable final invoice", async () => {
  const { ro } = await authorized();
  let workflow = await getRepairOrderWorkflow(ro.id);
  assert.equal(workflow.repairOrder.status, "authorized");
  await performWorkItem(workflow.workItems[0].id, actorId);
  assert.equal((await getRepairOrderWorkflow(ro.id)).repairOrder.status, "in_progress");
  await performWorkItem(workflow.workItems[1].id, actorId);
  await completeRepairOrder(ro.id, actorId);
  const [a, b] = await Promise.all([createFinalInvoice(ro.id, actorId), createFinalInvoice(ro.id, actorId)]);
  assert.equal(a.id, b.id);
  const issued = await issueInvoice(a.id, actorId);
  assert.ok(issued.publicToken);
  const first = await recordPayment({ invoiceId: a.id, amount: "50.00", method: "cash", attemptKey: `${prefix}p1`, idempotencyKey: `${prefix}k1` }, actorId);
  assert.equal(first.invoice.status, "partially_paid");
  const final = await recordPayment({ invoiceId: a.id, amount: first.invoice.balance, method: "cash", attemptKey: `${prefix}p2`, idempotencyKey: `${prefix}k2` }, actorId);
  assert.equal(final.invoice.status, "paid");
  assert.equal((await getRepairOrderWorkflow(ro.id)).invoice!.items.length, 2);
});

test("supplement preserves prior work, positions globally, and invoices approved work once", async () => {
  const { ro } = await authorized([{ position: 1, kind: "labor", description: "Initial", quantity: 1, unitPrice: 100 }]);
  let workflow = await getRepairOrderWorkflow(ro.id);
  await performWorkItem(workflow.workItems[0].id, actorId);
  const supplement = await createRevision(ro.id, "supplement", actorId);
  await replaceDraftItems(supplement.id, [
    { position: 1, kind: "labor", description: "Approved supplement", quantity: 1, unitPrice: 40 },
    { position: 2, kind: "fee", description: "Declined supplement", quantity: 1, unitPrice: 20 },
  ], actorId);
  const sent = await sendRevision(supplement.id, actorId);
  workflow = await getRepairOrderWorkflow(ro.id);
  const supplementItems = workflow.revisions[1].items;
  await decideRevision(sent.publicToken!, {
    signerName: "Partial Signer", decision: "approved",
    approvedItemIds: [supplementItems[0].id], declinedItemIds: [supplementItems[1].id],
  });
  workflow = await getRepairOrderWorkflow(ro.id);
  assert.equal(workflow.repairOrder.status, "in_progress");
  assert.deepEqual(workflow.workItems.map((x) => x.position), [1, 2]);
  assert.equal(workflow.workItems[0].status, "performed");
  await performWorkItem(workflow.workItems[1].id, actorId);
  await completeRepairOrder(ro.id, actorId);
  const invoice = await createFinalInvoice(ro.id, actorId);
  assert.equal((await getRepairOrderWorkflow(ro.id)).invoice!.items.length, 2);
  assert.equal(invoice.total, "140.00");
});

test("fully declined estimate returns to diagnosing and creates no work", async () => {
  const ro = await createRepairOrder({ customerId, vehicleId, assignedToId: actorId }, actorId);
  const revision = await createRevision(ro.id, "estimate", actorId);
  await replaceDraftItems(revision.id, [{ position: 1, kind: "labor", description: "Decline", quantity: 1, unitPrice: 10 }], actorId);
  const sent = await sendRevision(revision.id, actorId);
  const itemId = (await getRepairOrderWorkflow(ro.id)).revisions[0].items[0].id;
  await decideRevision(sent.publicToken!, { signerName: "No Thanks", decision: "declined", approvedItemIds: [], declinedItemIds: [itemId] });
  const workflow = await getRepairOrderWorkflow(ro.id);
  assert.equal(workflow.repairOrder.status, "diagnosing");
  assert.equal(workflow.workItems.length, 0);
});

test("cancel requires a reason and is terminal for revision, completion, and invoicing", async () => {
  const ro = await createRepairOrder({ customerId, vehicleId }, actorId);
  await assert.rejects(cancelRepairOrder(ro.id, " ", actorId), (e: WorkflowError) => e.status === 400);
  await cancelRepairOrder(ro.id, "customer request", actorId);
  await assert.rejects(createRevision(ro.id, "estimate", actorId));
  await assert.rejects(completeRepairOrder(ro.id, actorId));
  await assert.rejects(createFinalInvoice(ro.id, actorId));
});

test("failed processor attempt is retained without changing invoice and duplicate processor IDs reconcile once", async () => {
  const { invoice } = await completedInvoice();
  const pending = await recordPayment({
    invoiceId: invoice.id, amount: "10.00", method: "card", processor: "test",
    processorPaymentId: `${prefix}processor`, attemptKey: `${prefix}attempt`, idempotencyKey: `${prefix}processor-key`, pending: true,
  }, actorId);
  const failed = await finalizeProcessorPayment(pending.payment.id, "failed", `${prefix}event`, "declined");
  assert.equal(failed.payment.status, "failed");
  assert.equal(failed.invoice.amountPaid, "0.00");
  const one = await reconcileProcessorPayment({
    invoiceId: invoice.id, amount: "10.00", processor: "test", processorPaymentId: `${prefix}other`,
    processorEventId: `${prefix}event2`, method: "card", status: "succeeded",
  });
  const two = await reconcileProcessorPayment({
    invoiceId: invoice.id, amount: "10.00", processor: "test", processorPaymentId: `${prefix}other`,
    processorEventId: `${prefix}event2`, method: "card", status: "succeeded",
  });
  assert.equal(one.payment.id, two.payment.id);
});

test("idempotent payments and offline refunds recompute status and gate voiding", async () => {
  const { invoice } = await completedInvoice();
  const input = { invoiceId: invoice.id, amount: invoice.total, method: "cash", attemptKey: `${prefix}full`, idempotencyKey: `${prefix}idem` };
  const [one, two] = await Promise.all([recordPayment(input, actorId), recordPayment(input, actorId)]);
  assert.equal(one.payment.id, two.payment.id);
  assert.equal(one.invoice.status, "paid");
  await assert.rejects(recordPayment({ ...input, amount: "1.00" }, actorId), (e: WorkflowError) => e.status === 409);
  await assert.rejects(voidInvoice(invoice.id, "not refunded", actorId), (e: WorkflowError) => e.status === 409);
  const partial = await reversePayment(one.payment.id, "refunded", "10.00", "partial refund", actorId);
  assert.equal(partial.invoice.status, "partially_paid");
  const rest = await reversePayment(one.payment.id, "refunded", Number(invoice.total) - 10, "remaining refund", actorId);
  assert.equal(rest.invoice.status, "issued");
  assert.equal((await voidInvoice(invoice.id, "fully reversed", actorId)).status, "void");
});

test("customer/vehicle mismatch is rejected", async () => {
  const [other] = await db.insert(customersTable).values({ firstName: "Other", lastName: `${prefix}other` }).returning();
  await assert.rejects(createRepairOrder({ customerId: other.id, vehicleId }, actorId), (e: WorkflowError) => e.status === 422);
});

test("concurrent approval and work requests create and perform one work set", async () => {
  const ro = await createRepairOrder({ customerId, vehicleId, assignedToId: actorId }, actorId);
  const revision = await createRevision(ro.id, "estimate", actorId);
  await replaceDraftItems(revision.id, [{ position: 1, kind: "labor", description: "Race", quantity: 1, unitPrice: 10 }], actorId);
  const sent = await sendRevision(revision.id, actorId);
  const itemId = (await getRepairOrderWorkflow(ro.id)).revisions[0].items[0].id;
  const decision = { signerName: "Concurrent", decision: "approved" as const, approvedItemIds: [itemId], declinedItemIds: [] };
  const results = await Promise.allSettled([decideRevision(sent.publicToken!, decision), decideRevision(sent.publicToken!, decision)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  let workflow = await getRepairOrderWorkflow(ro.id);
  assert.equal(workflow.approvalItems.length, 1);
  assert.equal(workflow.workItems.length, 1);
  const [first, second] = await Promise.all([
    performWorkItem(workflow.workItems[0].id, actorId),
    performWorkItem(workflow.workItems[0].id, actorId),
  ]);
  assert.equal(first.id, second.id);
  workflow = await getRepairOrderWorkflow(ro.id);
  assert.equal(workflow.workItems[0].status, "performed");
  assert.equal(workflow.events.filter((event) => event.eventType === "work_performed").length, 1);
});

test("database guards reject sent edits, immutable deletes, and invalid transitions", async () => {
  const ro = await createRepairOrder({ customerId, vehicleId }, actorId);
  const revision = await createRevision(ro.id, "estimate", actorId);
  await replaceDraftItems(revision.id, [{ position: 1, kind: "fee", description: "Immutable", quantity: 1, unitPrice: 5 }], actorId);
  await sendRevision(revision.id, actorId);
  const workflow = await getRepairOrderWorkflow(ro.id);
  const itemId = workflow.revisions[0].items[0].id;
  await assert.rejects(pool.query("update estimate_items set description='changed' where id=$1", [itemId]));
  await assert.rejects(pool.query("delete from repair_order_events where repair_order_id=$1", [ro.id]));
  await assert.rejects(pool.query("update repair_orders set status='completed' where id=$1", [ro.id]));
});