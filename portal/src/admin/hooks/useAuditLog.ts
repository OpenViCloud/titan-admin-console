import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface AuditLogEntry {
  id: string
  action: string
  actor: string
  resourceType: string
  resourceId: string
  ownerTenantId: string
  createdAt: string
  // titan-ops architecture/money-and-wallet.md#price-belongs-to-offering — set for string-keyed resources (catalog offering slugs) and the change they carry.
  // Null on every row written before titan-ops architecture/money-and-wallet.md#price-belongs-to-offering and on every GUID-keyed resource.
  resourceKey: string | null
  detail: string | null
}

// Admin cross-tenant audit trail (read). NOT tenant-scoped — backend gates with
// Roles("platform-admin"). Newest-first, limit clamped server-side.
export function useAuditLog(limit = 100) {
  return useQuery({
    queryKey: ['admin', 'audit-log', limit],
    queryFn: () => api.get<AuditLogEntry[]>('/v1/admin/audit-log', { params: { limit } }).then(r => r.data),
  })
}
