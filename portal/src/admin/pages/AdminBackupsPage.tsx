import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  useAdminBackups,
  useBackupTarget,
  useSetBackupTarget,
  useTestBackupTarget,
  type BackupHealth,
  type BackupItem,
  type BackupTarget,
  type BackupTargetTestResult,
} from '../hooks/useAdminBackups'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { useT, useFormat } from '@/i18n/LanguageContext'
import type { Messages } from '@/i18n/en'
import { ageOf } from '@/lib/age'
import { formatBytes } from '@/lib/bytes'

// Where the restore steps live. The page only points at them: restoring runs outside the console.
const RUNBOOK_URL = 'https://github.com/OpenViCloud/titan-ops/blob/main/docs/infra/oci/runbook.md'

// docs/features/backup/design.md#backups-page
export function AdminBackupsPage() {
  const t = useT()
  const { data, isLoading, isError } = useAdminBackups()
  const [onlyAttention, setOnlyAttention] = useState(false)

  const items = data === undefined ? [] : data.items
  const needAttention = items.filter(i => i.health === 'Stale' || i.health === 'Missing')
  const unreadable = items.some(i => i.health === 'Unknown')
  const shown = onlyAttention ? needAttention : items
  const postgres = items.find(i => i.kind === 'postgres')

  return (
    <div className="max-w-4xl">
      <h1 className="text-lg font-semibold mb-1">{t.adminBackups.title}</h1>
      <p className="text-sm text-muted-foreground mb-6">{t.adminBackups.intro}</p>

      <div className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">{t.common.loading}</p>}
        {isError && <p className="text-sm text-bad">{t.adminBackups.loadFailed}</p>}

        {unreadable && (
          <p role="status" className="rounded-lg border border-border bg-muted p-3 text-sm text-soft-foreground">
            {t.adminBackups.unreadableNotice}
          </p>
        )}

        {needAttention.length > 0 && (
          <div role="alert" className="flex items-center gap-3 rounded-lg border border-warn-border bg-warn-soft p-3 text-sm text-warn">
            <span>{t.adminBackups.attentionBanner(needAttention.length)}</span>
            <Button
              type="button"
              variant="secondary"
              className="ml-auto"
              aria-pressed={onlyAttention}
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
            <Link className="underline" to="/audit-log">{t.adminBackups.auditLink}</Link>
          </p>
        </section>
      </div>
    </div>
  )
}

function agoText(iso: string | null, t: Messages): string {
  if (iso === null) {
    return t.adminBackups.nothingYet
  }
  const age = ageOf(iso, new Date())
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
        <p className="text-base font-medium text-foreground">{agoText(item.lastWalAt, t)}</p>
        <p className="text-xs text-muted-foreground mt-1">{t.adminBackups.cardLastLogHint}</p>
      </section>
      <section aria-label={t.adminBackups.cardNewestBase} className="rounded-lg border border-border p-4">
        <h2 className="text-xs text-muted-foreground">{t.adminBackups.cardNewestBase}</h2>
        <p className="text-base font-medium text-foreground">{agoText(item.takenAt, t)}</p>
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
              <TableCell>{t.adminBackups.kinds[i.kind] ?? i.kind}</TableCell>
              <TableCell>{i.takenAt === null ? '—' : f.dateTime(i.takenAt)}</TableCell>
              <TableCell>{i.sizeBytes === null ? '—' : formatBytes(i.sizeBytes)}</TableCell>
              <TableCell>
                <Badge variant={healthVariant(i.health)}>{t.adminBackups.healthLabels[i.health] ?? i.health}</Badge>
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
  const { data: target, isLoading } = useBackupTarget()

  return (
    <section aria-labelledby="backup-target" className="rounded-lg border border-border p-4 space-y-3">
      <h2 id="backup-target" className="text-sm font-medium text-foreground">{t.adminBackups.targetTitle}</h2>
      {isLoading && <p className="text-xs text-muted-foreground">{t.common.loading}</p>}
      {/* The key changes with the saved row, so a save remounts the form with what was read back. */}
      {target !== undefined && <BackupTargetForm key={target === null ? 'none' : target.updatedAt} target={target} />}
    </section>
  )
}

function BackupTargetForm({ target }: { target: BackupTarget | null }) {
  const t = useT()
  const save = useSetBackupTarget()
  const test = useTestBackupTarget()
  const [endpoint, setEndpoint] = useState(target === null ? '' : target.endpoint)
  const [region, setRegion] = useState(target === null ? 'auto' : target.region)
  const [bucket, setBucket] = useState(target === null ? '' : target.bucket)
  const [accessKeyId, setAccessKeyId] = useState(target === null ? '' : target.accessKeyId)
  // Empty on every open: the stored secret is never sent to the browser.
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<BackupTargetTestResult | null>(null)

  const isSaved = target !== null
  const hasSecretOrKeepsOne = secretAccessKey !== '' || isSaved
  const canSave = !save.isPending && endpoint !== '' && region !== '' && bucket !== '' && accessKeyId !== '' && hasSecretOrKeepsOne

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const body = { endpoint, region, bucket, accessKeyId }
    save.mutate(secretAccessKey === '' ? body : { ...body, secretAccessKey }, {
      onSuccess: () => toast.success(t.adminBackups.targetSaved),
      onError: err => {
        const message = errorMessage(err, t.adminBackups.saveFailed)
        setFormError(message)
        toast.error(message)
      },
    })
  }

  function runTest() {
    setTestResult(null)
    test.mutate(undefined, {
      onSuccess: setTestResult,
      onError: () => setTestResult({ ok: false, latencyMs: null, error: t.adminBackups.requestFailed }),
    })
  }

  return (
    <form onSubmit={submit} aria-label={t.adminBackups.targetLabel} className="space-y-3">
      {!isSaved && <p className="text-xs text-muted-foreground">{t.adminBackups.targetNotSet}</p>}
      <Field label={t.adminBackups.endpoint} htmlFor="backup-endpoint">
        <Input id="backup-endpoint" placeholder="https://account.r2.cloudflarestorage.com" value={endpoint} onChange={e => setEndpoint(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.adminBackups.region} htmlFor="backup-region">
          <Input id="backup-region" value={region} onChange={e => setRegion(e.target.value)} />
        </Field>
        <Field label={t.adminBackups.bucket} htmlFor="backup-bucket">
          <Input id="backup-bucket" className="font-mono" value={bucket} onChange={e => setBucket(e.target.value)} />
        </Field>
      </div>
      <Field label={t.adminBackups.accessKeyId} htmlFor="backup-key-id">
        <Input id="backup-key-id" className="font-mono" autoComplete="off" value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} />
      </Field>
      <Field label={t.adminBackups.secretAccessKey} htmlFor="backup-secret">
        <Input
          id="backup-secret"
          type="password"
          className="font-mono"
          autoComplete="new-password"
          value={secretAccessKey}
          onChange={e => setSecretAccessKey(e.target.value)}
          aria-describedby="backup-secret-note"
        />
        <span id="backup-secret-note" className="text-xs text-muted-foreground">
          {isSaved ? t.adminBackups.secretKeep : t.adminBackups.secretRequired}
        </span>
      </Field>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" disabled={!canSave}>{t.common.save}</Button>
        <Button type="button" variant="secondary" onClick={runTest} disabled={!isSaved || test.isPending}>
          {t.adminBackups.testConnection}
        </Button>
        <span className="text-xs text-muted-foreground">{t.adminBackups.testHint}</span>
      </div>
      {testResult !== null && (
        <p role="status" className={testResult.ok ? 'text-xs text-ok' : 'text-xs text-bad break-words'}>
          {testResultText(testResult, t)}
        </p>
      )}
      {formError !== null && <p className="text-xs text-bad">{formError}</p>}
    </form>
  )
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

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}
