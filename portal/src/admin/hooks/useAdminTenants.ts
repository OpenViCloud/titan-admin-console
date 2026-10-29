import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface AdminTenant {
  id: string
  name: string
  status: string
  maxVms: number
  maxNetworks: number
  maxVolumes: number
  maxVmSnapshotsPerVm: number
  maxVolumeSnapshotsPerVolume: number
  maxFirewallRulesPerNetwork: number
  maxPublicIpv6: number
  maxSshKeys: number
  maxLoadBalancers: number
  createdAt: string
  // The debt ceiling the admin reads at month-end close (2026-09-04). One plain number per tenant —
  // there is no override/effective pair any more, because there is no system default to fall back to
  // without knowing the server's configured default.
  debtCeiling: number
}

// Admin queries are NOT tenant-scoped — no useTenant(). Backend gates with
// Roles("platform-admin"); GET /v1/tenants returns every tenant.
export function useAdminTenants() {
  return useQuery({
    queryKey: ['admin', 'tenants'],
    queryFn: () => api.get<AdminTenant[]>('/v1/tenants').then(r => r.data),
  })
}

export function useUpdateTenantStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tenantId, status }: { tenantId: string; status: string }) =>
      api.patch(`/v1/tenants/${tenantId}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tenants'] }),
  })
}

// The nine caps of a tenant's quota (titan-ops architecture/tenancy-and-admin.md#tenant-quota), as GET /v1/tenants names them.
export const QUOTA_CAPS = [
  'maxVms',
  'maxNetworks',
  'maxVolumes',
  'maxVmSnapshotsPerVm',
  'maxVolumeSnapshotsPerVolume',
  'maxFirewallRulesPerNetwork',
  'maxPublicIpv6',
  'maxSshKeys',
  'maxLoadBalancers',
] as const

export type QuotaCap = typeof QUOTA_CAPS[number]
export type TenantQuotaCaps = Record<QuotaCap, number>

// B-A02 — platform-admin adjusts a tenant's resource caps. The dialog sends all nine; the backend also keeps any it
// is not sent. It answers 204 with no body (titan-ops architecture/http-contract.md#commands-return-no-data), so we
// invalidate the list and the new quota shows without a reload.
export function useUpdateTenantQuota() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tenantId, caps }: { tenantId: string; caps: TenantQuotaCaps }) =>
      api.patch(`/v1/tenants/${tenantId}/quota`, caps),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tenants'] }),
  })
}

// titan-ops architecture/money-and-wallet.md#postpaid-no-brake — platform-admin sets a tenant's credit limit, or clears the override with null so it
// follows the system default again. Same shape as quota: a create-time gate, so lowering it never
// takes running resources away.
export function useUpdateTenantDebtCeiling() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tenantId, debtCeiling }: { tenantId: string; debtCeiling: number }) =>
      api.patch(`/v1/tenants/${tenantId}/debt-ceiling`, { debtCeiling }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tenants'] }),
  })
}
