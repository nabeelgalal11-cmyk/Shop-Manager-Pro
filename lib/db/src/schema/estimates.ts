/** @deprecated Compatibility export. New code must use estimateRevisionsTable. */
export {
  estimateRevisionsTable as estimatesTable,
  insertEstimateRevisionSchema as insertEstimateSchema,
} from "./estimate_revisions";
export type {
  EstimateRevision as Estimate,
  InsertEstimateRevision as InsertEstimate,
} from "./estimate_revisions";