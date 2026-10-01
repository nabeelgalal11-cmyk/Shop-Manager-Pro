export interface OwnerFundingAmounts {
  type: string;
  amount: number | string;
}

export interface OwnerFundingSummary {
  totalLoaned: number;
  totalRepaid: number;
  outstandingLoan: number;
  totalContributed: number;
}

function cents(value: number | string): number {
  return Math.round(Number(value) * 100);
}

export function summarizeOwnerFunding(entries: OwnerFundingAmounts[]): OwnerFundingSummary {
  let loanedCents = 0;
  let repaidCents = 0;
  let contributedCents = 0;

  for (const entry of entries) {
    const amountCents = cents(entry.amount);
    if (entry.type === "loan") loanedCents += amountCents;
    if (entry.type === "repayment") repaidCents += amountCents;
    if (entry.type === "contribution") contributedCents += amountCents;
  }

  return {
    totalLoaned: loanedCents / 100,
    totalRepaid: repaidCents / 100,
    outstandingLoan: Math.max(0, loanedCents - repaidCents) / 100,
    totalContributed: contributedCents / 100,
  };
}

export function canRepayOwnerLoan(outstandingLoan: number, repaymentAmount: number): boolean {
  return Number.isFinite(repaymentAmount)
    && repaymentAmount > 0
    && Math.round(repaymentAmount * 100) <= Math.round(outstandingLoan * 100);
}