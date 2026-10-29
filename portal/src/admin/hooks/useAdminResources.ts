import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

// US-A08 — cross-tenant VM/Network read (titan-ops architecture/tenancy-and-admin.md#admin-cross-tenant-read). Not tenant-scoped: backend gates with
// Roles("platform-admin") and returns every tenant's resources, each carrying tenantId. The
// optional tenantId narrows server-side via A07's ?tenantId= filter (one refetch, not client slicing).

export interface AdminVm {
  id: string
  tenantId: string
  name: string
  // titan-ops architecture/desired-and-current.md#provider-state-is-verbatim — see lib/vmState.ts
  currentState: string | null
  desiredState: string
  currentExistence: string
  desiredExistence: string
  transition: string | null
  ipAddress: string | null
  networkId: string
  vmOfferingId: string
  templateId: string
  clusterId: string
  createdAt: string
  requestFailureReason: string | null
  // Admin-only raw error of a refused create — the tenant API deliberately omits it, so a failed create can be
  // debugged without leaving the portal for the worker's logs.
  requestFailureDetail: string | null
  requestFailedAt: string | null
}

export interface AdminNetwork {
  id: string
  tenantId: string
  name: string
  clusterId: string
  cidr: string | null
  // titan-ops architecture/desired-and-current.md#provider-state-is-verbatim — see lib/networkState.ts
  currentState: string | null
  currentExistence: string
  desiredExistence: string
  transition: string | null
  requestFailureReason: string | null
  // Admin-only raw error of a command the provider gave up on.
  requestFailureDetail: string | null
  requestFailedAt: string | null
  createdAt: string
}

export function useAdminVms(tenantId?: string) {
  return useQuery({
    queryKey: ['admin', 'vms', tenantId ?? 'all'],
    queryFn: () =>
      api
        .get<AdminVm[]>('/v1/admin/vms', { params: tenantId ? { tenantId } : undefined })
        .then(r => r.data),
  })
}

export function useAdminNetworks(tenantId?: string) {
  return useQuery({
    queryKey: ['admin', 'networks', tenantId ?? 'all'],
    queryFn: () =>
      api
        .get<AdminNetwork[]>('/v1/admin/networks', { params: tenantId ? { tenantId } : undefined })
        .then(r => r.data),
  })
}

// B-A01 (titan-ops architecture/tenancy-and-admin.md#admin-cross-tenant-write) — cross-tenant DELETE, the only admin write. Invalidates the VM list so the
// deleted VM's status change shows. The type-the-name confirm guard lives in the page, not here.
export function useDeleteAdminVm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vmId: string) => api.delete(`/v1/admin/vms/${vmId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'vms'] }),
  })
}
