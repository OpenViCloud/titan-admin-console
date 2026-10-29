import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { PaymentState } from '@/hooks/useInvoices'
import { pollWhilePaymentInFlight } from '@/hooks/pollUntilSettled'

// Shape mirrors InvoiceDto (control-plane). Status is display-only: "New" | "Paid" | "Overdue".
export interface AdminInvoice {
  id: string
  tenantId: string
  periodYear: number
  periodMonth: number
  status: string
  issuedAt: string
  dueAt: string
  paidAt: string | null
  paidBy: string | null
  total: number
  currency: string
  // titan-ops architecture/money-and-wallet.md#single-writer-outbox S5 — set while a wallet debit for this invoice is being applied. Optional because the
  // admin list is not tenant-scoped and may render a cached payload from before the column existed.
  paymentState?: PaymentState | null
}

// Admin billing is NOT tenant-scoped — backend gates with Roles("platform-admin").
export function useAdminInvoices() {
  return useQuery({
    queryKey: ['admin', 'invoices'],
    queryFn: () => api.get<AdminInvoice[]>('/v1/admin/invoices').then(r => r.data),
    // titan-ops architecture/money-and-wallet.md#single-writer-outbox S5 — settle-from-wallet returns 202 and the debit lands moments later. Same predicate
    // as the tenant list on purpose: an admin and the customer watching the same payment must not
    // see it resolve at different times.
    refetchInterval: q => pollWhilePaymentInFlight(q.state.data),
  })
}

export function useMarkInvoicePaid() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (invoiceId: string) =>
      // titan-ops architecture/http-contract.md#commands-return-no-data: 204 with no body — the list below is re-read instead.
      api.patch(`/v1/admin/invoices/${invoiceId}/pay`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'invoices'] }),
  })
}

// titan-ops architecture/money-and-wallet.md#human-confirmed-debit PAY-5 — an admin spends the TENANT'S WALLET on the tenant's invoice, on their behalf.
// Deliberately separate from useMarkInvoicePaid: that one records money that arrived outside Titan
// (bank transfer) and never touches the wallet. Confusing the two would either take a customer's
// credit for a bill they already paid by transfer, or leave real money unrecorded.
export function useSettleInvoiceFromWallet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (invoiceId: string) =>
      // titan-ops architecture/http-contract.md#async-actions-return-202: 202 with no body — the debit is queued; the polled list shows it land.
      api.post(`/v1/admin/invoices/${invoiceId}/settle-from-wallet`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'invoices'] }),
  })
}
