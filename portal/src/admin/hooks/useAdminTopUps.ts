import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

// A real-money top-up as GET /v1/admin/topups serves it (every tenant, every source).
export interface AdminTopUp {
  id: string
  tenantId: string
  amount: number
  currency: string
  status: string
  paymentRef: string
  source: string | null
  createdAt: string
}

// Top-ups the customer started and nobody has confirmed: the bank transfer arrived (or will) but the webhook did
// not match it. A promotional grant is never Pending — it is confirmed when granted — so it never shows here.
export function useAdminPendingTopUps() {
  return useQuery({
    queryKey: ['admin', 'topups', 'pending'],
    queryFn: () =>
      api
        .get<AdminTopUp[]>('/v1/admin/topups')
        .then(r => r.data.filter(topUp => topUp.status === 'Pending' && topUp.source !== 'PromotionalCredit')),
  })
}

// 202 with no body: the credit is queued for the wallet, not applied, when this returns
// (titan-ops architecture/http-contract.md#async-actions-return-202). The list is read again to show it confirmed.
export function useConfirmTopUp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, paymentTxnRef }: { id: string; paymentTxnRef: string | null }) =>
      api.post(`/v1/admin/topups/${id}/confirm`, { paymentTxnRef }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'topups', 'pending'] }),
  })
}
