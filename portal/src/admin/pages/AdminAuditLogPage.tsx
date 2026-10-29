import { useAuditLog } from '../hooks/useAuditLog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { useT, useFormat } from '@/i18n/LanguageContext'
import type { Messages } from '@/i18n/en'

// A price applies to every tenant, so titan-ops architecture/money-and-wallet.md#price-belongs-to-offering records those actions with no owning tenant. Printing
// the raw value would show an all-zero GUID, which reads as a tenant that does not exist rather than
// as the absence of one.
const NO_TENANT = '00000000-0000-0000-0000-000000000000'

function formatOwner(ownerTenantId: string, t: Messages): string {
  return ownerTenantId === NO_TENANT ? t.adminAudit.platform : ownerTenantId
}

export function AdminAuditLogPage() {
  const t = useT()
  const f = useFormat()
  const { data: entries, isLoading, isError } = useAuditLog()

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{t.adminAudit.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t.adminAudit.subtitle}
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t.adminAudit.loading}</p>
      ) : isError ? (
        <p className="text-sm text-bad">{t.adminAudit.loadFailed}</p>
      ) : !entries || entries.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t.adminAudit.empty}
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.adminAudit.action}</TableHead>
                <TableHead>{t.adminAudit.actor}</TableHead>
                <TableHead>{t.adminAudit.resource}</TableHead>
                <TableHead>{t.adminAudit.change}</TableHead>
                <TableHead>{t.adminAudit.ownerTenant}</TableHead>
                <TableHead>{t.adminAudit.when}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(e => (
                <TableRow key={e.id}>
                  <TableCell><Badge variant="outline">{e.action}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{e.actor}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {e.resourceType} · {e.resourceKey ?? e.resourceId}
                  </TableCell>
                  {/* An em dash, not an empty cell: blank reads as "broken", a dash reads as
                      "not applicable" — which is what null means for a GUID-keyed action. */}
                  <TableCell className="font-mono text-xs">{e.detail ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{formatOwner(e.ownerTenantId, t)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{f.dateTime(e.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
