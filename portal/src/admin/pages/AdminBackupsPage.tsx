import { useMemo, useState } from 'react'
import { useAdminTenants } from '../hooks/useAdminTenants'
import {
  useAdminBackups,
  useBackupTarget,
  useTestBackupTarget,
  type BackupHealth,
  type BackupItem,
  type BackupTarget,
  type BackupTargetTestResult,
} from '../hooks/useAdminBackups'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { useT, useFormat } from '@/i18n/LanguageContext'
import type { Messages } from '@/i18n/en'
import { ageOf } from '@/lib/age'
import { formatBytes } from '@/lib/bytes'
import { needsAttention, visibleItems } from '@/lib/backupFilter'

// Where the restore steps live. The page only points at them: restoring runs outside the console.
const RUNBOOK_URL = 'https://github.com/OpenViCloud/titan-ops/blob/main/docs/infra/oci/runbook.md'

// docs/features/backup/design.md#backups-page
export function AdminBackupsPage() {
  const t = useT()
  const { data, isLoading, isError } = useAdminBackups()
  const [onlyAttention, setOnlyAttention] = useState(false)

  const items = data === undefined ? [] : data.items
  const needAttention = items.filter(needsAttention)
  const unknownItems = items.filter(i => i.health === 'Unknown')
  const shown = visibleItems(items, onlyAttention)
  const postgres = items.find(i => i.kind === 'postgres')

  return (
    <div className="max-w-4xl">
      <h1 className="text-lg font-semibold mb-1">{t.adminBackups.title}</h1>
      <p className="text-sm text-muted-foreground mb-6">{t.adminBackups.intro}</p>

      <div className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">{t.common.loading}</p>}
        {isError && <p className="text-sm text-bad">{t.adminBackups.loadFailed}</p>}

        {unknownItems.length > 0 && (
          <p role="status" className="rounded-lg border border-border bg-muted p-3 text-sm text-soft-foreground">
            {unknownItems.some(i => i.reason === 'BucketUnreadable') ? t.adminBackups.unreadableNotice : t.adminBackups.staleReadingNotice}
          </p>
        )}

        {needAttention.length > 0 && (
          <div role="alert" className="flex items-center gap-3 rounded-lg border border-warn-border bg-warn-soft p-3 text-sm text-warn">
            <span>{t.adminBackups.attentionBanner(needAttention.length)}</span>
            <Button
              type="button"
              variant="secondary"
              className="ml-auto"
              onClick={() => setOnlyAttention(!onlyAttention)}
            >
              {onlyAttention ? t.adminBackups.showAll : t.adminBackups.showThem}
            </Button>
          </div>
        )}

        {postgres !== undefined && <PostgresCards item={postgres} />}

        {data !== undefined && (
          <BackupTable items={shown} />
        )}

        <BackupTargetBlock />

        <section aria-labelledby="backups-restore" className="rounded-lg border border-border p-4 space-y-2">
          <h2 id="backups-restore" className="text-sm font-medium text-foreground">{t.adminBackups.restoreTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.adminBackups.restoreBody}</p>
          <p className="text-sm flex flex-wrap gap-x-4 gap-y-1">
            <a className="underline" href={RUNBOOK_URL} target="_blank" rel="noreferrer">{t.adminBackups.runbookLink}</a>
          </p>
        </section>
      </div>
    </div>
  )
}

// Nothing known is not the same as nothing there: an item whose state is Unknown says so instead of "none yet".
function agoText(iso: string | null, health: BackupHealth, t: Messages): string {
  if (iso === null) {
    return health === 'Unknown' ? t.adminBackups.unknownValue : t.adminBackups.nothingYet
  }
  const age = ageOf(iso, new Date())
  if (age === null) {
    return t.adminBackups.unknownValue
  }
  if (age.unit === 'minutes') {
    return t.adminBackups.minutesAgo(age.count)
  }
  if (age.unit === 'hours') {
    return t.adminBackups.hoursAgo(age.count)
  }
  return t.adminBackups.daysAgo(age.count)
}

function PostgresCards({ item }: { item: BackupItem }) {
  const t = useT()
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section aria-label={t.adminBackups.cardLastLog} className="rounded-lg border border-border p-4">
        <h2 className="text-xs text-muted-foreground">{t.adminBackups.cardLastLog}</h2>
        <p className="text-base font-medium text-foreground">{agoText(item.lastWalAt, item.health, t)}</p>
        <p className="text-xs text-muted-foreground mt-1">{t.adminBackups.cardLastLogHint}</p>
      </section>
      <section aria-label={t.adminBackups.cardNewestBase} className="rounded-lg border border-border p-4">
        <h2 className="text-xs text-muted-foreground">{t.adminBackups.cardNewestBase}</h2>
        <p className="text-base font-medium text-foreground">{agoText(item.takenAt, item.health, t)}</p>
      </section>
    </div>
  )
}

function healthVariant(health: BackupHealth): 'success' | 'warning' | 'destructive' | 'gray' {
  if (health === 'Ok') {
    return 'success'
  }
  if (health === 'Stale') {
    return 'warning'
  }
  if (health === 'Missing') {
    return 'destructive'
  }
  return 'gray'
}

function BackupTable({ items }: { items: BackupItem[] }) {
  const t = useT()
  const f = useFormat()
  // VM and volume rows belong to a tenant (docs/features/backup/design.md#incus-backup); Postgres is the platform's.
  const { data: tenants } = useAdminTenants()
  const tenantName = useMemo(() => {
    const m = new Map<string, string>()
    tenants?.forEach(tenant => m.set(tenant.id, tenant.name))
    return m
  }, [tenants])

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        {t.adminBackups.noRows}
      </div>
    )
  }

  return (
    <div className="rounded-lg border overflow-x-auto">
      <Table aria-label={t.adminBackups.tableLabel}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.adminBackups.resource}</TableHead>
            <TableHead>{t.adminBackups.tenant}</TableHead>
            <TableHead>{t.adminBackups.kind}</TableHead>
            <TableHead>{t.adminBackups.takenAt}</TableHead>
            <TableHead>{t.adminBackups.size}</TableHead>
            <TableHead>{t.adminBackups.health}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(i => (
            <TableRow key={`${i.kind}|${i.name}|${i.tenantId ?? ''}`}>
              <TableCell className="font-mono text-xs">{i.name}</TableCell>
              <TableCell data-column="tenant">{i.tenantId === null ? '—' : (tenantName.get(i.tenantId) ?? i.tenantId)}</TableCell>
              <TableCell>{t.adminBackups.kinds[i.kind] ?? i.kind}</TableCell>
              <TableCell>{i.takenAt === null ? '—' : f.dateTime(i.takenAt)}</TableCell>
              <TableCell>{i.sizeBytes === null ? '—' : formatBytes(i.sizeBytes)}</TableCell>
              <TableCell>
                {/* The state word is the server's own, in both languages, like every other status in the console. */}
                <Badge variant={healthVariant(i.health)}>{i.health}</Badge>
                {i.reason !== null && (
                  <span className="ml-2 text-xs text-muted-foreground">{t.adminBackups.reasons[i.reason] ?? i.reason}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

interface ErrorBody {
  code?: string
  title?: string
}

function errorMessage(err: unknown, fallback: string): string {
  const response = (err as { response?: { data?: ErrorBody } }).response
  if (response === undefined || response.data === undefined || response.data.code === undefined) {
    return fallback
  }
  const body = response.data
  if (body.title === undefined || body.title === '') {
    return body.code ?? fallback
  }
  return `${body.code} — ${body.title}`
}

function BackupTargetBlock() {
  const t = useT()
  const { data: target, isLoading, isError, error } = useBackupTarget()
  const test = useTestBackupTarget()
  const [testResult, setTestResult] = useState<BackupTargetTestResult | null>(null)

  function runTest() {
    setTestResult(null)
    test.mutate(undefined, {
      onSuccess: setTestResult,
      onError: err => setTestResult({ ok: false, latencyMs: null, error: testErrorText(err, t) }),
    })
  }

  return (
    <section aria-labelledby="backup-target" className="rounded-lg border border-border p-4 space-y-3">
      <h2 id="backup-target" className="text-sm font-medium text-foreground">{t.adminBackups.targetTitle}</h2>
      {isLoading && <p className="text-xs text-muted-foreground">{t.common.loading}</p>}
      {isError && <p className="text-xs text-bad">{errorCodeOf(error) === 'BACKUP_TARGET_CONFIG_INVALID' ? t.adminBackups.targetConfigInvalid : t.adminBackups.targetLoadFailed}</p>}
      {target === null && <p className="text-xs text-muted-foreground">{t.adminBackups.targetNotSet}</p>}
      {target !== undefined && target !== null && <BackupTargetValues target={target} />}
      <p className="text-xs text-muted-foreground">{t.adminBackups.targetFromGitops}</p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={runTest} disabled={target === undefined || target === null || test.isPending}>
          {t.adminBackups.testConnection}
        </Button>
        <span className="text-xs text-muted-foreground">{t.adminBackups.testHint}</span>
      </div>
      {testResult !== null && (
        <p role="status" className={testResult.ok ? 'text-xs text-ok' : 'text-xs text-bad break-words'}>
          {testResultText(testResult, t)}
        </p>
      )}
    </section>
  )
}

// Plain text, not inputs: nothing here can be changed, and the key pair's secret never reaches the browser.
function BackupTargetValues({ target }: { target: BackupTarget }) {
  const t = useT()
  return (
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      <dt className="text-xs text-muted-foreground">{t.adminBackups.endpoint}</dt>
      <dd className="font-mono break-all">{target.endpoint}</dd>
      <dt className="text-xs text-muted-foreground">{t.adminBackups.region}</dt>
      <dd className="font-mono">{target.region}</dd>
      <dt className="text-xs text-muted-foreground">{t.adminBackups.bucket}</dt>
      <dd className="font-mono break-all">{target.bucket}</dd>
      <dt className="text-xs text-muted-foreground">{t.adminBackups.accessKeyId}</dt>
      <dd className="font-mono break-all">{target.accessKeyId}</dd>
    </dl>
  )
}

function errorCodeOf(err: unknown): string | undefined {
  const response = (err as { response?: { data?: ErrorBody } }).response
  return response === undefined || response.data === undefined ? undefined : response.data.code
}

// A refused Test is told apart by the error code, never by the status or the text.
function testErrorText(err: unknown, t: Messages): string {
  const response = (err as { response?: { data?: ErrorBody } }).response
  const code = response === undefined || response.data === undefined ? undefined : response.data.code
  if (code === 'BACKUP_TARGET_CONFIG_INVALID') {
    return t.adminBackups.targetConfigInvalid
  }
  if (code === 'BACKUP_TARGET_NOT_FOUND') {
    return t.adminBackups.noTargetToTest
  }
  return errorMessage(err, t.adminBackups.requestFailed)
}

// The error text after "Failed:" is the control plane's own and stays as sent.
function testResultText(result: BackupTargetTestResult, t: Messages): string {
  if (result.ok) {
    if (result.latencyMs === null) {
      return t.adminBackups.connected
    }
    return t.adminBackups.connectedWithLatency(result.latencyMs)
  }
  if (result.error === null) {
    return t.adminBackups.testFailed(t.adminBackups.unknownError)
  }
  return t.adminBackups.testFailed(result.error)
}
