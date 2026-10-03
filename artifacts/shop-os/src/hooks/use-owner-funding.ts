import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeleteOwnerFundingEntry } from "@workspace/api-client-react";

export type FundingType = "loan" | "contribution" | "repayment";
export interface OwnerFundingEntry {
  id: number;
  type: FundingType;
  amount: number;
  entryDate: string;
  description: string;
  notes?: string | null;
  createdAt: string;
}
export interface OwnerFundingSummary {
  totalLoaned: number;
  totalRepaid: number;
  outstandingLoan: number;
  totalContributed: number;
}
interface OwnerFundingResponse {
  entries: OwnerFundingEntry[];
  summary: OwnerFundingSummary;
}
export interface FundingInput {
  type: FundingType;
  amount: number;
  entryDate: string;
  description: string;
  notes?: string;
}

export const ownerFundingKey = ["/api/owner-funding"] as const;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || body.message || "Request could not be completed."), {
      status: response.status,
    });
  }
  return response.json() as Promise<T>;
}

export function useOwnerFunding() {
  return useQuery({
    queryKey: ownerFundingKey,
    queryFn: () => request<OwnerFundingResponse>("/api/owner-funding"),
  });
}

export function useCreateFundingEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: FundingInput) =>
      request<OwnerFundingEntry>("/api/owner-funding", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ownerFundingKey }),
  });
}

export function useDeleteFundingEntry() {
  const client = useQueryClient();
  return useDeleteOwnerFundingEntry({
    mutation: {
      onSuccess: () => client.invalidateQueries({ queryKey: ownerFundingKey }),
    },
  });
}