import { useId, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useAdminTenants } from '../hooks/useAdminTenants'
import {
  useAdminBackups,
  useBackupTarget,
  useRestoreFromBackup,
  useTestBackupTarget,
  type BackupArchive,
  type BackupHealth,
  type BackupItem,
  type BackupRestore,
  type BackupTarget,
  type BackupTargetTestResult,
  type RestoreDrill,
} from '../hooks/useAdminBackups'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useT, useFormat } from '@/i18n/LanguageContext'
import type { Messages } from '@/i18n/en'
import { ageOf } from '@/lib/age'
import { formatBytes } from '@/lib/bytes'
import { needsAttention, visibleItems } from '@/lib/backupFilter'

// Where the steps to restore the database live. The page only names them: that restore runs outside the console (a VM
// or a volume is restored from the table below), and the runbook is in titan-ops, which is private, so a link would be
// a 404 for anyone without access to it.
const RUNBOOK_REF = 'titan-ops infra/oci/runbook.md#disaster-recovery'

// titan-ops features/backup/design.md#backups-page
export function AdminBackupsPage() {
  const t = useT()
  const { data, isLoading, isError } = useAdminBackups()
  const [onlyAttention, setOnlyAttention] = useState(false)
  const [restoring, setRestoring] = useState<RestorableItem | null>(null)

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
          <BackupTable items={shown} onRestore={setRestoring} />
        )}

        {data !== undefined && data.restoreDrills !== undefined && data.restoreDrills.length > 0 && (
          <RestoreDrillBlock drills={data.restoreDrills} />
        )}

        {data !== undefined && data.restores !== undefined && data.restores.length > 0 && (
          <RecentRestoresBlock restores={data.restores} />
        )}

        <BackupTargetBlock />

        <section aria-labelledby="backups-restore" className="rounded-lg border border-border p-4 space-y-2">
          <h2 id="backups-restore" className="text-sm font-medium text-foreground">{t.adminBackups.restoreTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.adminBackups.restoreBody}</p>
          <p className="text-sm">
            {t.adminBackups.runbookName}: <code className="font-mono text-xs">{RUNBOOK_REF}</code>
          </p>
        </section>
      </div>

      <RestoreDialog
        item={restoring}
        onClose={() => setRestoring(null)}
        // An answer can come after the dialog was closed and opened for another resource: that one stays open.
        onAsked={asked => setRestoring(current => (current === asked ? null : current))}
      />
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

// titan-ops features/backup/design.md#restore-drill
function RestoreDrillBlock({ drills }: { drills: RestoreDrill[] }) {
  const t = useT()
  return (
    <section aria-labelledby="backups-restore-drill" className="rounded-lg border border-border p-4 space-y-3">
      <h2 id="backups-restore-drill" className="text-sm font-medium text-foreground">{t.adminBackups.restoreDrillTitle}</h2>
      <ul className="space-y-2">
        {drills.map(d => (
          <li key={d.clusterId} className="text-sm">
            <span className="font-medium text-foreground">{d.clusterName}</span>
            <RestoreDrillLine drill={d} />
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t.adminBackups.restoreDrillHint}</p>
    </section>
  )
}

function RestoreDrillLine({ drill }: { drill: RestoreDrill }) {
  const t = useT()
  const f = useFormat()
  // The reason is the worker's own text and stays as sent, like the error text after "Failed:" below.
  const what = drill.kind === null || drill.name === null ? null : `${t.adminBackups.kinds[drill.kind] ?? drill.kind} ${drill.name}`
  if (drill.state === 'verified' && what !== null && drill.verifiedAt !== null) {
    return <p className="text-muted-foreground">{t.adminBackups.restoreDrillVerified(what, f.dateTime(drill.verifiedAt))}</p>
  }
  if (drill.state === 'notVerified') {
    return (
      <div className="text-muted-foreground">
        <p className="text-bad">{what === null ? t.adminBackups.restoreDrillFailedUnnamed : t.adminBackups.restoreDrillFailed(what)}</p>
        {drill.reason !== null && <p className="font-mono text-xs break-words">{drill.reason}</p>}
        <p>{drill.verifiedAt === null ? t.adminBackups.restoreDrillNeverVerified : t.adminBackups.restoreDrillLastVerified(f.dateTime(drill.verifiedAt))}</p>
      </div>
    )
  }
  return <p className="text-muted-foreground">{t.adminBackups.restoreDrillNone}</p>
}

// VM and volume rows belong to a tenant (titan-ops features/backup/design.md#incus-backup); Postgres is the platform's.
function useTenantNames(): Map<string, string> {
  const { data: tenants } = useAdminTenants()
  return useMemo(() => {
    const m = new Map<string, string>()
    tenants?.forEach(tenant => m.set(tenant.id, tenant.name))
    return m
  }, [tenants])
}

function restoreStateVariant(state: BackupRestore['state']): 'blue' | 'success' | 'destructive' {
  if (state === 'done') {
    return 'success'
  }
  if (state === 'failed') {
    return 'destructive'
  }
  return 'blue'
}

// titan-ops features/backup/design.md#restore-as-new-resource
function RecentRestoresBlock({ restores }: { restores: BackupRestore[] }) {
  const t = useT()
  const f = useFormat()
  const tenantName = useTenantNames()
  return (
    <section aria-labelledby="backups-recent-restores" className="rounded-lg border border-border p-4 space-y-3">
      <h2 id="backups-recent-restores" className="text-sm font-medium text-foreground">{t.adminBackups.recentRestoresTitle}</h2>
      <p className="text-xs text-muted-foreground">{t.adminBackups.recentRestoresHint}</p>
      <ul className="space-y-2">
        {restores.map(r => (
          <li key={`${r.kind}|${r.resourceId}`} className="text-sm">
            <p className="text-muted-foreground">
              {t.adminBackups.kinds[r.kind] ?? r.kind}{' '}
              <span className="font-mono text-xs text-foreground">{r.name ?? '—'}</span>
              {' · '}
              {r.tenantId === null ? '—' : (tenantName.get(r.tenantId) ?? r.tenantId)}
              {' · '}
              {t.adminBackups.recentRestoreFromBackup(r.takenAt === null ? '—' : f.dateTime(r.takenAt))}{' '}
              {/* The state word is the server's own, in both languages, like the State column above. */}
              <Badge variant={restoreStateVariant(r.state)}>{r.state}</Badge>{' '}
              {t.adminBackups.recentRestoreAsked(f.dateTime(r.askedAt))}
            </p>
            {/* The reason is the worker's own text and stays as sent. */}
            {r.state === 'failed' && r.reason !== null && (
              <p className="font-mono text-xs text-muted-foreground break-words">{r.reason}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
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

// What the Restore button needs of a row: a VM or a volume Titan knows by id, with an archive to restore from.
interface RestorableItem {
  kind: 'vm' | 'volume'
  name: string
  resourceId: string
  archives: BackupArchive[]
}

// A control plane older than the Restore button sends neither `resourceId` nor `archives`: nothing is restorable.
function restorable(item: BackupItem): RestorableItem | null {
  if (item.kind !== 'vm' && item.kind !== 'volume') {
    return null
  }
  if (item.resourceId === undefined || item.resourceId === null || item.archives === undefined || item.archives.length === 0) {
    return null
  }
  return { kind: item.kind, name: item.name, resourceId: item.resourceId, archives: item.archives }
}

// Two volumes of one tenant can share a name, so the id tells the rows apart when the control plane sends one.
function rowKey(item: BackupItem): string {
  if (item.resourceId === undefined || item.resourceId === null) {
    return `${item.kind}|${item.name}|${item.tenantId ?? ''}`
  }
  return `${item.kind}|${item.resourceId}`
}

function BackupTable({ items, onRestore }: { items: BackupItem[]; onRestore: (item: RestorableItem) => void }) {
  const t = useT()
  const f = useFormat()
  const tenantName = useTenantNames()
  const nameCellId = useId()

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
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((i, index) => {
            const toRestore = restorable(i)
            return (
              <TableRow key={rowKey(i)}>
                <TableCell id={`${nameCellId}-${index}`} className="font-mono text-xs">{i.name}</TableCell>
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
                <TableCell className="text-right">
                  {toRestore !== null && (
                    // Every row's button reads the same, so the resource's name is its description.
                    <Button size="sm" variant="outline" aria-describedby={`${nameCellId}-${index}`} onClick={() => onRestore(toRestore)}>
                      {t.adminBackups.restoreAction}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

const VM_NAME = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/
const VM_NAME_MAX = 64
const VOLUME_NAME_MAX = 100
const RESTORED_SUFFIX = '-restored'

// The suggestion is the original's name cut to leave room for the suffix, so it has the shape the control plane takes
// (the tenant may still have a VM of that name).
function suggestedName(item: RestorableItem): string {
  const max = item.kind === 'vm' ? VM_NAME_MAX : VOLUME_NAME_MAX
  return `${item.name.slice(0, max - RESTORED_SUFFIX.length)}${RESTORED_SUFFIX}`
}

// The limits the control plane puts on the name of a new VM or volume; undefined when the name can be sent.
function nameProblem(kind: 'vm' | 'volume', name: string, t: Messages): string | undefined {
  if (name.trim() === '') {
    return t.adminBackups.restoreNameRequired
  }
  if (kind === 'volume') {
    return name.length > VOLUME_NAME_MAX ? t.adminBackups.restoreNameTooLong(VOLUME_NAME_MAX) : undefined
  }
  if (!VM_NAME.test(name)) {
    return t.adminBackups.restoreVmNameInvalid
  }
  return name.length > VM_NAME_MAX ? t.adminBackups.restoreNameTooLong(VM_NAME_MAX) : undefined
}

// A refused restore is told apart by the error code. The title of the attached-volume refusal names the volume, so it
// follows the sentence as the control plane sent it.
function restoreErrorText(err: unknown, t: Messages): string {
  const response = (err as { response?: { data?: ErrorBody } }).response
  const body = response === undefined ? undefined : response.data
  const code = body === undefined ? undefined : body.code
  const words = code === undefined ? undefined : t.adminBackups.restoreErrors[code]
  if (words === undefined) {
    return errorMessage(err, t.adminBackups.restoreFailed)
  }
  if (code === 'BACKUP_OF_ATTACHED_VOLUME_NOT_FOUND' && body !== undefined && body.title !== undefined && body.title !== '') {
    return `${words} ${body.title}`
  }
  return words
}

// titan-ops features/backup/design.md#restore-as-new-resource
function RestoreDialog({
  item, onClose, onAsked,
}: { item: RestorableItem | null; onClose: () => void; onAsked: (item: RestorableItem) => void }) {
  const t = useT()
  const f = useFormat()
  const restore = useRestoreFromBackup()
  const fieldId = useId()
  const [backupKey, setBackupKey] = useState('')
  const [name, setName] = useState('')

  // The newest backup and the suggested name each time the dialog opens, whatever was chosen for another resource.
  const openedFor = item === null ? undefined : `${item.kind}|${item.resourceId}`
  const [seededFor, setSeededFor] = useState<string | undefined>(undefined)
  if (openedFor !== seededFor) {
    setSeededFor(openedFor)
    setBackupKey(item === null ? '' : item.archives[0].backupKey)
    setName(item === null ? '' : suggestedName(item))
  }

  const isVm = item !== null && item.kind === 'vm'
  const nameError = item === null ? undefined : nameProblem(item.kind, name, t)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (item === null || nameError !== undefined || restore.isPending) {
      return
    }
    restore.mutate(
      { kind: item.kind, resourceId: item.resourceId, backupKey, name },
      {
        onSuccess: () => {
          toast.success(t.adminBackups.restoreAsked)
          onAsked(item)
        },
        onError: err => {
          toast.error(restoreErrorText(err, t))
        },
      },
    )
  }

  return (
    <Dialog open={item !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item === null ? '' : t.adminBackups.restoreDialogTitle(item.name)}</DialogTitle>
          <DialogDescription>
            {item === null ? '' : (isVm ? t.adminBackups.restoreVmDescription : t.adminBackups.restoreVolumeDescription)}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {isVm && <p className="text-[13px] text-muted-foreground">{t.adminBackups.restoreVmNotes}</p>}
          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-sm text-soft-foreground">{t.adminBackups.restoreArchiveLegend}</legend>
            {item !== null && item.archives.map(archive => (
              <label key={archive.backupKey} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  name={`${fieldId}-archive`}
                  value={archive.backupKey}
                  checked={backupKey === archive.backupKey}
                  onChange={() => setBackupKey(archive.backupKey)}
                  className="accent-primary"
                />
                <span>
                  {f.dateTime(archive.takenAt)}
                  {archive.sizeBytes !== null && ` · ${formatBytes(archive.sizeBytes)}`}
                </span>
              </label>
            ))}
          </fieldset>
          {/* The Input's error text has no id to describe the field with: a live region reads it out when it shows. */}
          <div className="space-y-1" aria-live="polite">
            <label htmlFor={`${fieldId}-name`} className="text-sm text-soft-foreground">
              {isVm ? t.adminBackups.restoreVmNameLabel : t.adminBackups.restoreVolumeNameLabel}
            </label>
            <Input
              id={`${fieldId}-name`}
              value={name}
              onChange={e => setName(e.target.value)}
              error={nameError}
              aria-invalid={nameError !== undefined}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t.common.cancel}</Button>
            <Button type="submit" disabled={nameError !== undefined || restore.isPending}>
              {restore.isPending ? t.adminBackups.restoring : t.adminBackups.restoreAction}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
