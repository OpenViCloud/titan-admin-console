import { toast } from 'sonner'
import { useTemplatesCatalog, useSyncTemplates, useVmOfferingsCatalog } from '../hooks/useAdminCatalog'
import { templateClusterLabel } from '@/lib/templateState'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { OfferingsSection } from './OfferingsSection'
import { useT } from '@/i18n/LanguageContext'

// Badge label (templateClusterLabel: the waiting sync, else whether the cluster holds the alias) → semantic variant.
// Available=ok (green), Not synced/Syncing=needs-attention (amber), Failed/Not found=action-needed (red). Text label
// carries meaning too — not colour alone (a11y).
const STATE_VARIANT: Record<string, 'success' | 'warning' | 'destructive'> = {
  Available: 'success',
  'Not synced': 'warning',
  Syncing: 'warning',
  Failed: 'destructive',
  'Not found': 'destructive',
}

// The tooltip: why the last sync gave up, and the raw error after it — this page is the operator's.
function failureTitle(cluster: { requestFailureReason: string | null; requestFailureDetail: string | null }): string | undefined {
  if (cluster.requestFailureReason === null) {
    return undefined
  }
  if (cluster.requestFailureDetail === null) {
    return cluster.requestFailureReason
  }
  return `${cluster.requestFailureReason}\n${cluster.requestFailureDetail}`
}

export function AdminCatalogPage() {
  const t = useT()
  const { data: templates, isLoading, isError } = useTemplatesCatalog()
  // The tier catalog is already on this page (OfferingsSection renders it below), so resolving a
  // template's tier costs nothing extra and keeps one definition of what "m" means.
  const { data: offerings } = useVmOfferingsCatalog()

  // Spell the tier out rather than printing the bare id: an operator should not have to have
  // memorised that "m" is 2 vCPU / 4 GB to read this table. Falls back to the raw id while the
  // offerings query is still in flight, or if a template points at a tier that is gone.
  const describeTier = (id: string) => {
    const o = offerings?.find(x => x.id === id)
    return o ? `${o.name} — ${o.vcpu} vCPU · ${o.memoryMb / 1024} GB` : id
  }
  const sync = useSyncTemplates()

  function runSync() {
    sync.mutate(undefined, {
      onSuccess: () => toast.success(t.adminCatalog.syncTriggered),
      onError: e => {
        const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code
        toast.error(code ?? t.adminCatalog.syncFailed)
      },
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">{t.adminCatalog.title}</h1>
        <Button onClick={runSync} disabled={sync.isPending}>
          {sync.isPending ? t.adminCatalog.syncing : t.adminCatalog.syncTemplates}
        </Button>
      </div>

      {sync.isSuccess && (
        <p className="text-sm text-soft-foreground mb-4" data-testid="sync-result">
          {t.adminCatalog.syncResult}
        </p>
      )}

      {isLoading ? (
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      ) : isError ? (
        <div className="text-muted-foreground text-sm">{t.adminCatalog.loadFailed}</div>
      ) : !templates?.length ? (
        <p className="text-sm text-muted-foreground">{t.adminCatalog.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.adminCatalog.name}</TableHead>
              <TableHead>{t.adminCatalog.status}</TableHead>
              <TableHead>{t.adminCatalog.os}</TableHead>
              <TableHead>{t.adminCatalog.size}</TableHead>
              <TableHead>{t.adminCatalog.diskGb}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map(template => (
              <TableRow key={template.id}>
                <TableCell>{template.name}</TableCell>
                <TableCell>
                  {/* One badge per cluster: each cluster syncs on its own (titan-ops features/catalog/design.md#template-per-cluster).
                      None yet = no sync run has asked for it anywhere. */}
                  {template.clusters.length === 0 ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {template.clusters.map(z => (
                        <Badge key={z.clusterId} variant={STATE_VARIANT[templateClusterLabel(z)] ?? 'warning'} title={failureTitle(z)}>
                          {`${z.clusterId} · ${templateClusterLabel(z)}`}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell>{template.os}</TableCell>
                <TableCell>{describeTier(template.vmOfferingId)}</TableCell>
                <TableCell>{template.diskGb ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <OfferingsSection />
    </div>
  )
}
