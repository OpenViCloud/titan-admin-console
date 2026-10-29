import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useIdempotencyKey } from '@/lib/idempotency'

export interface PromotionalCredit {
  id: string
  tenantId: string
  amount: number
  currency: string
  reason: string | null
  grantedBy: string
  grantedAt: string
}

// US-TOPUP-CONSOLIDATE — a promo grant is a TopUp with Source=PromotionalCredit, served on the unified
// /topups surface. The wire shape is TopUpDto; the admin page still speaks "granted by/at", so map the
// TopUp's confirmedBy/confirmedAt (the fields that mean who/when the credit took effect) here.
interface TopUpDto {
  id: string
  tenantId: string
  amount: number
  currency: string
  status: string
  paymentRef: string
  source: string | null
  reason: string | null
  confirmedBy: string | null
  createdAt: string
  confirmedAt: string | null
}

const toPromotionalCredit = (t: TopUpDto): PromotionalCredit => ({
  id: t.id,
  tenantId: t.tenantId,
  amount: t.amount,
  currency: t.currency,
  reason: t.reason,
  grantedBy: t.confirmedBy ?? '',
  grantedAt: t.confirmedAt ?? '',
})

// Grant history, NOT tenant-scoped; backend gates with Roles("platform-admin") and returns every
// tenant's promo grants (source=PromotionalCredit), newest first.
export function useAdminPromotionalCredits() {
  return useQuery({
    queryKey: ['admin', 'promotional-credits'],
    queryFn: () =>
      api
        .get<TopUpDto[]>('/v1/admin/topups?source=PromotionalCredit')
        .then(r => r.data.map(toPromotionalCredit)),
  })
}

export interface GrantPromotionalCreditInput {
  tenantId: string
  amount: number
  reason: string | null
}

// titan-ops architecture/http-contract.md#create-returns-id: the grant answers with the id it just minted and nothing else. The page never read the
// returned row — it shows the grant through the history query below — so invalidating that query is
// what puts the new grant on screen.
export interface GrantPromotionalCreditResult {
  topUpId: string
}

export function useGrantPromotionalCredit() {
  const qc = useQueryClient()
  const withKey = useIdempotencyKey() // titan-ops architecture/http-contract.md#idempotency-key: one key per submission
  return useMutation({
    mutationFn: (input: GrantPromotionalCreditInput) =>
      withKey(headers => api.post<GrantPromotionalCreditResult>('/v1/admin/topups/grant', input, { headers }).then(r => r.data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'promotional-credits'] }),
  })
}
