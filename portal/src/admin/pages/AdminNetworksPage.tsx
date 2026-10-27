import { useMemo, useState } from 'react'
import { useAdminNetworks } from '../hooks/useAdminResources'
import { useAdminTenants } from '../hooks/useAdminTenants'
import { distinctStatuses, filterAndSort, nextSortDir, type SortDir } from './resourceFilters'
import { incusLabel } from '@/lib/networkState'
import { StatusFilter, SortByName } from './resourceFilterControls'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { useT } from '@/i18n/LanguageContext'

// US-A08 — read-only cross-tenant network view. No create/delete: observation only (write backlog).
// Keys are what incusLabel() returns: an Incus status, a waiting request's move, or why Incus has none.
function statusVariant(s: string): 'success' | 'warning' | 'destructive' | 'outline' {
  if (s === 'Created') return 'success'
  if (s === 'Errored' || s === 'Unavailable' || s === 'Not found' || s === 'Failed') return 'destructive'
  if (s === 'Creating' || s === 'Deleting' || s === 'Pending' || s === 'Unknown') return 'warning'
  return 'outline'
}

export function AdminNetworksPage() {
  const t = useT()
  const [tenantId, setTenantId] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState('')
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const { data: networks, isLoading, isError } = useAdminNetworks(tenantId)
  const { data: tenants } = useAdminTenants()

  const tenantName = useMemo(() => {
    const m = new Map<string, string>()
    tenants?.forEach(tenant => m.set(tenant.id, tenant.name))
    return m
  }, [tenants])

  const statuses = useMemo(() => distinctStatuses(networks, incusLabel), [networks])
  const rows = useMemo(() => filterAndSort(networks ?? [], status, sortDir, incusLabel), [networks, status, sortDir])

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">{t.common.loading}</div>
  if (isError) return <div className="p-6 text-muted-foreground text-sm">{t.adminNetworks.loadFailed}</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">{t.adminNetworks.title}</h1>
        <div className="flex items-center gap-2">
          <StatusFilter statuses={statuses} value={status} onChange={setStatus} />
          <select
            aria-label={t.adminFilters.filterByTenant}
            value={tenantId ?? ''}
            onChange={e => setTenantId(e.target.value || undefined)}
            className="bg-muted border border-border rounded-md px-2 py-1 text-[13px] text-foreground"
          >
            <option value="">{t.adminFilters.allTenants}</option>
            {tenants?.map(tenant => (
              <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
            ))}
          </select>
        </div>
      </div>
      {!rows.length ? (
        <p className="text-sm text-muted-foreground">{t.adminNetworks.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.adminFilters.tenant}</TableHead>
              <TableHead><SortByName dir={sortDir} onToggle={() => setSortDir(nextSortDir)} /></TableHead>
              <TableHead>{t.adminFilters.status}</TableHead>
              <TableHead>{t.adminNetworks.cidr}</TableHead>
              <TableHead>{t.adminFilters.cluster}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(n => (
              <TableRow key={n.id}>
                <TableCell>{tenantName.get(n.tenantId) ?? n.tenantId}</TableCell>
                <TableCell>{n.name}</TableCell>
                <TableCell>
                  <Badge
                    variant={statusVariant(incusLabel(n))}
                    title={[n.requestFailureReason, n.requestFailureDetail].filter(Boolean).join('\n') || undefined}
                  >
                    {incusLabel(n)}
                  </Badge>
                </TableCell>
                <TableCell>{n.cidr ?? '—'}</TableCell>
                <TableCell>{n.clusterId}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
