import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { formatDateTime } from '@/lib/money'
import { AdminBackupsPage } from './AdminBackupsPage'
import { useAdminVms } from '../hooks/useAdminResources'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

const postgres = (o = {}) => ({
  kind: 'postgres', name: 'titan-db', tenantId: null,
  takenAt: hoursAgo(3), sizeBytes: 70_000_000, health: 'Ok', reason: null, lastWalAt: minutesAgo(4),
  ...o,
})

const target = (o = {}) => ({
  endpoint: 'https://acct.r2.cloudflarestorage.com', region: 'auto', bucket: 'titan-backup-dev',
  accessKeyId: 'key-id-123', ...o,
})

const tenantA = '0123abcd-0000-4000-8000-000000000001'

const disk = (o = {}) => ({
  kind: 'vm', name: 'web-1', tenantId: tenantA,
  takenAt: hoursAgo(5), sizeBytes: 667_000_000, health: 'Ok', reason: null, lastWalAt: null,
  ...o,
})

const drill = (o = {}) => ({
  clusterId: 'local', clusterName: 'Local', state: 'verified', verifiedAt: hoursAgo(2),
  kind: 'vm', name: 'web-1', reason: null,
  ...o,
})

const newestArchive = { backupKey: '20261123T120000Z', takenAt: '2026-11-23T12:00:00Z', sizeBytes: 667_000_000 }
const olderArchive = { backupKey: '20261122T120000Z', takenAt: '2026-11-22T12:00:00Z', sizeBytes: 524_288_000 }

const vmId = '0a1b2c3d-0000-4000-8000-00000000000a'
const volumeId = '0a1b2c3d-0000-4000-8000-00000000000b'

// `disk()` is the row of a control plane that sends neither `resourceId` nor `archives`.
const restorableVm = (o = {}) => disk({ resourceId: vmId, archives: [newestArchive, olderArchive], ...o })
const restorableVolume = (o = {}) => disk({ kind: 'volume', name: 'data-1', resourceId: volumeId, archives: [newestArchive], ...o })

// A time as the page writes it, as the source of a pattern: the day and the hour depend on the time zone the test
// runs in, and the space before AM/PM on the runtime's locale data.
const when = (iso: string, lang: 'en' | 'vi' = 'en') =>
  formatDateTime(iso, lang).replace(/[/.]/g, '\\$&').replace(/\s/g, '\\s')

const restore = (o = {}) => ({
  kind: 'vm', resourceId: '0a1b2c3d-0000-4000-8000-0000000000c1', name: 'web-1-restored', tenantId: tenantA,
  takenAt: '2026-11-22T12:00:00Z', state: 'running', askedAt: '2026-11-23T12:00:00Z', reason: null,
  ...o,
})

// JSON drops a field that is undefined, so a call without drills or restores answers as a control plane without them.
function serve(
  items: unknown[], savedTarget: unknown = target(), readAt: string | null = minutesAgo(1),
  restoreDrills?: unknown[], restores?: unknown[],
) {
  server.use(
    http.get('*/v1/admin/backups', () => HttpResponse.json({ readAt, items, restoreDrills, restores })),
    http.get('*/v1/tenants', () => HttpResponse.json([{ id: tenantA, name: 'Acme', status: 'Active' }])),
    http.get('*/v1/admin/backup-target', () =>
      savedTarget === null
        ? HttpResponse.json({ status: 404, title: 'x', code: 'BACKUP_TARGET_NOT_FOUND' }, { status: 404 })
        : HttpResponse.json(savedTarget)),
  )
}

function renderPage(lang: 'en' | 'vi' = 'en') {
  return renderWithProviders(<MemoryRouter><AdminBackupsPage /></MemoryRouter>, { lang })
}

// A list of VMs open beside the page, as the VMs page keeps one.
function VmList() {
  useAdminVms()
  return null
}

async function openRestore(user: ReturnType<typeof userEvent.setup>, resource: string, button = 'Restore') {
  const table = await screen.findByRole('table')
  const row = within(table).getByText(resource).closest('tr') as HTMLElement
  await user.click(within(row).getByRole('button', { name: button }))
  return screen.findByRole('dialog')
}

const dialogIsGone = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

describe('AdminBackupsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the real values: resource, age, size, state, bucket and key id', async () => {
    serve([postgres()])
    renderPage()

    const table = await screen.findByRole('table', { name: 'Newest backup of each resource' })
    expect(within(table).getByText('titan-db')).toBeInTheDocument()
    expect(within(table).getByText('Postgres')).toBeInTheDocument()
    expect(within(table).getByText('66.8 MB')).toBeInTheDocument()
    expect(within(table).getByText('Ok')).toBeInTheDocument() // the state word is the server's own, in both languages
    expect(screen.getByText('3 hours ago')).toBeInTheDocument()
    expect(screen.getByText('4 minutes ago')).toBeInTheDocument()
    expect(await screen.findByText('titan-backup-dev')).toBeInTheDocument()
    expect(screen.getByText('key-id-123')).toBeInTheDocument()
    expect(screen.getByText('https://acct.r2.cloudflarestorage.com')).toBeInTheDocument()
  })

  // titan-ops features/backup/design.md#incus-backup: one row per VM and volume Incus holds, under its tenant's name.
  it('shows each VM and volume with its tenant, its kind and its own reason', async () => {
    serve([
      postgres(),
      disk(),
      disk({ kind: 'volume', name: 'data-1', health: 'Stale', reason: 'BackupTooOld', takenAt: hoursAgo(30) }),
      disk({ name: 'db-2', health: 'Missing', reason: 'NoBackup', takenAt: null, sizeBytes: null }),
    ])
    renderPage()

    const table = await screen.findByRole('table', { name: 'Newest backup of each resource' })
    const web = within(table).getByText('web-1').closest('tr') as HTMLElement
    expect(await within(web).findByText('Acme')).toBeInTheDocument()
    expect(within(web).getByText('VM')).toBeInTheDocument()
    expect(within(web).getByText('636.1 MB')).toBeInTheDocument()
    const data = within(table).getByText('data-1').closest('tr') as HTMLElement
    expect(within(data).getByText('Volume')).toBeInTheDocument()
    expect(within(data).getByText('The newest backup is older than the limit.')).toBeInTheDocument()
    const missing = within(table).getByText('db-2').closest('tr') as HTMLElement
    expect(within(missing).getByText('No backup found.')).toBeInTheDocument()
    const platform = within(table).getByText('titan-db').closest('tr') as HTMLElement
    expect(within(platform).getByText('—', { selector: '[data-column="tenant"]' })).toBeInTheDocument()
  })

  // titan-ops features/backup/design.md#cluster-backup: each cluster's config is a row of its own, of no tenant.
  it('shows a cluster config row with its own kind and no tenant', async () => {
    serve([disk({ kind: 'cluster', name: 'Singapore 01', tenantId: null })])
    renderPage()

    const row = (await screen.findByText('Singapore 01')).closest('tr') as HTMLElement
    expect(within(row).getByText('Cluster config')).toBeInTheDocument()
    expect(within(row).getByText('—', { selector: '[data-column="tenant"]' })).toBeInTheDocument()
  })

  it('names the cluster config kind in Vietnamese', async () => {
    serve([disk({ kind: 'cluster', name: 'Singapore 01', tenantId: null })])
    renderPage('vi')

    const row = (await screen.findByText('Singapore 01')).closest('tr') as HTMLElement
    expect(within(row).getByText('Cấu hình cụm')).toBeInTheDocument()
  })

  it('names the kinds and BackupTooOld in Vietnamese too', async () => {
    serve([disk({ kind: 'volume', name: 'data-1', health: 'Stale', reason: 'BackupTooOld' })])
    renderPage('vi')

    const row = (await screen.findByText('data-1')).closest('tr') as HTMLElement
    expect(within(row).getByText('Ổ đĩa')).toBeInTheDocument()
    expect(within(row).getByText('Bản sao lưu mới nhất cũ hơn giới hạn.')).toBeInTheDocument()
  })

  it('shows no warning when everything is Ok', async () => {
    serve([postgres()])
    renderPage()
    await screen.findByRole('table')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('warns when a resource is overdue or has no backup, and Show them keeps only those rows', async () => {
    const user = userEvent.setup()
    serve([
      postgres({ health: 'Stale', reason: 'BaseTooOld', takenAt: hoursAgo(40) }),
      { ...postgres({ name: 'fine-one' }) },
    ])
    renderPage()

    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('1 backup needs attention')
    expect(screen.getByText('The newest base backup is older than the limit.')).toBeInTheDocument()
    expect(screen.getByText('fine-one')).toBeInTheDocument()

    await user.click(within(banner).getByRole('button', { name: 'Show them' }))

    expect(screen.queryByText('fine-one')).not.toBeInTheDocument()
    expect(screen.getByText('Stale')).toBeInTheDocument()
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Show all' }))
    expect(screen.getByText('fine-one')).toBeInTheDocument()
  })

  it('says a missing backup is missing, with the reason a bucket CNPG does not write to gives', async () => {
    serve([postgres({ health: 'Missing', reason: 'NoPostgresBackupInBucket', takenAt: null, sizeBytes: null, lastWalAt: null })])
    renderPage()

    expect(await screen.findByText('Missing')).toBeInTheDocument()
    expect(screen.getByText('No Postgres backup in this bucket: none written yet, or the database is not archiving here.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('1 backup needs attention')
  })

  it('says "cannot read" when the bucket is unreadable, and never calls it "no backup"', async () => {
    serve([postgres({ health: 'Unknown', reason: 'BucketUnreadable' })])
    renderPage()

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('cannot read the backup bucket')
    expect(notice).toHaveTextContent('not the same as having no backup')
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.queryByText('Missing')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers no Delete, Download, back-up-now or save button anywhere', async () => {
    serve([postgres({ health: 'Stale', reason: 'BaseTooOld' }), restorableVm(), restorableVolume()])
    renderPage()
    const table = await screen.findByRole('table')
    await screen.findByText('titan-backup-dev')
    expect(within(table).getAllByRole('row')).toHaveLength(4)

    const names = screen.getAllByRole('button').map(b => b.textContent ?? '')
    expect(names.join('|')).not.toMatch(/delete|download|back up now|backup now|save/i)
    expect(screen.queryByRole('link', { name: /restore now|download/i })).not.toBeInTheDocument()
  })

  // titan-ops features/backup/design.md#restore-as-new-resource: only a VM or a volume is restored from here, and only from an archive.
  it('offers Restore on a VM row and a volume row that have a backup to restore from, and on no other row', async () => {
    serve([
      postgres({ resourceId: null, archives: [] }),
      disk({ kind: 'cluster', name: 'Singapore 01', tenantId: null, resourceId: null, archives: [] }),
      restorableVm(),
      restorableVolume(),
      restorableVm({ name: 'no-archive', resourceId: '0a1b2c3d-0000-4000-8000-00000000000c', archives: [] }),
      restorableVm({ name: 'no-id', resourceId: null }),
    ])
    renderPage()

    const table = await screen.findByRole('table', { name: 'Newest backup of each resource' })
    const rowOf = (name: string) => within(table).getByText(name).closest('tr') as HTMLElement
    // Each button reads Restore, and is described by the resource of its row.
    expect(within(rowOf('web-1')).getByRole('button', { name: 'Restore' })).toHaveAccessibleDescription('web-1')
    expect(within(rowOf('data-1')).getByRole('button', { name: 'Restore' })).toHaveAccessibleDescription('data-1')
    for (const name of ['titan-db', 'Singapore 01', 'no-archive', 'no-id']) {
      expect(within(rowOf(name)).queryByRole('button')).not.toBeInTheDocument()
    }
    expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(2)
  })

  it('offers no Restore on a Postgres or cluster row even when the row carries an id and archives', async () => {
    serve([
      postgres({ resourceId: vmId, archives: [newestArchive] }),
      disk({ kind: 'cluster', name: 'Singapore 01', tenantId: null, resourceId: volumeId, archives: [newestArchive] }),
    ])
    renderPage()

    const table = await screen.findByRole('table', { name: 'Newest backup of each resource' })
    expect(within(table).getByText('Singapore 01')).toBeInTheDocument()
    expect(within(table).queryByRole('button')).not.toBeInTheDocument()
  })

  it('says in the intro what is restored from here and what is not', async () => {
    serve([postgres()])
    renderPage()
    await screen.findByRole('table')

    expect(screen.getByText(/A VM or a volume can be restored from here as a new resource; restoring the database or a whole cluster runs outside the console\./)).toBeInTheDocument()
    expect(screen.queryByText(/only shows and warns/)).not.toBeInTheDocument()
  })

  it('reminds that restoring the database runs outside the console, naming the runbook without a link into private titan-ops', async () => {
    serve([postgres()])
    renderPage()

    const section = await screen.findByRole('region', { name: 'Restoring' })
    expect(section).toHaveTextContent('runs outside this console')
    expect(section).toHaveTextContent('Disaster recovery runbook: titan-ops infra/oci/runbook.md#disaster-recovery')
    expect(within(section).queryAllByRole('link')).toEqual([])
  })

  it('shows the target as text from the GitOps config: no field to type in, no Save, no secret', async () => {
    serve([postgres()])
    renderPage()

    const block = await screen.findByRole('region', { name: 'Backup target' })
    await within(block).findByText('titan-backup-dev')
    expect(block.querySelectorAll('input, textarea, select')).toHaveLength(0)
    expect(within(block).queryByLabelText('Secret access key')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(block).toHaveTextContent("set in this environment's GitOps config")
  })

  it('says no key pair is configured, and cannot test one that is not there', async () => {
    serve([], null)
    renderPage()

    expect(await screen.findByText('No backup target key pair is configured in this environment yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled()
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  })

  it('shows the connection result with its latency, or the reason it failed', async () => {
    let answer: { ok: boolean; latencyMs: number | null; error: string | null } = { ok: true, latencyMs: 87, error: null }
    serve([postgres()])
    server.use(http.post('*/v1/admin/backup-target/test', () => HttpResponse.json(answer)))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('titan-backup-dev')

    await user.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText('Connected in 87 ms.')).toBeInTheDocument()

    answer = { ok: false, latencyMs: null, error: 'access denied (AccessDenied)' }
    await user.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText('Failed: access denied (AccessDenied)')).toBeInTheDocument()
    expect(screen.queryByText('Connected in 87 ms.')).not.toBeInTheDocument()
  })

  it('reads in Vietnamese', async () => {
    serve([postgres({ health: 'Stale', reason: 'BaseTooOld' })])
    renderPage('vi')

    expect(await screen.findByRole('heading', { name: 'Sao lưu' })).toBeInTheDocument()
    expect(await screen.findByText('Stale')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('1 bản sao lưu cần chú ý')
    expect(screen.getByText('3 giờ trước')).toBeInTheDocument()
  })

  it('tells a failed load apart from an empty list', async () => {
    server.use(
      http.get('*/v1/admin/backups', () => HttpResponse.json({ status: 500, title: 'x', code: 'X' }, { status: 500 })),
      http.get('*/v1/admin/backup-target', () => HttpResponse.json(target())),
    )
    renderPage()

    expect(await screen.findByText('Failed to load backups.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing is protected yet.')).not.toBeInTheDocument()
  })
  it('does not say "none yet" for a bucket that was never read: the cards say Unknown', async () => {
    serve([postgres({ health: 'Unknown', reason: 'NotReadYet', takenAt: null, sizeBytes: null, lastWalAt: null })], target(), null)
    renderPage()

    expect(await screen.findByRole('status')).toHaveTextContent('no recent reading')
    const cards = [screen.getByRole('region', { name: 'Newest log archived' }), screen.getByRole('region', { name: 'Newest base backup' })]
    expect(cards.map(c => c.textContent).join('|')).not.toContain('None yet')
    expect(cards[0]).toHaveTextContent('Unknown')
  })

  it('says a failed load of the backup target, instead of showing a bare title', async () => {
    server.use(
      http.get('*/v1/admin/backups', () => HttpResponse.json({ readAt: null, items: [postgres()] })),
      http.get('*/v1/admin/backup-target', () => HttpResponse.json({ status: 500, title: 'x', code: 'X' }, { status: 500 })),
    )
    renderPage()

    expect(await screen.findByText('Failed to load the backup target.')).toBeInTheDocument()
  })

  it('treats only BACKUP_TARGET_NOT_FOUND as "no key pair"', async () => {
    server.use(
      http.get('*/v1/admin/backups', () => HttpResponse.json({ readAt: null, items: [postgres()] })),
      http.get('*/v1/admin/backup-target', () => HttpResponse.json({ status: 404, title: 'x', code: 'SOMETHING_ELSE' }, { status: 404 })),
    )
    renderPage()

    expect(await screen.findByText('Failed to load the backup target.')).toBeInTheDocument()
    expect(screen.queryByText('No backup target key pair is configured in this environment yet.')).not.toBeInTheDocument()
  })

  it('names a configuration that cannot work, when the target is read and when it is tested', async () => {
    serve([postgres()])
    server.use(
      http.get('*/v1/admin/backup-target', () =>
        HttpResponse.json({ status: 503, title: 'x', code: 'BACKUP_TARGET_CONFIG_INVALID' }, { status: 503 })),
    )
    renderPage()

    expect(await screen.findByText(/cannot work: check the control plane's BackupTarget settings/)).toBeInTheDocument()
    expect(screen.queryByText('Failed to load the backup target.')).not.toBeInTheDocument()
  })

  it('names the configuration when Test refuses it', async () => {
    serve([postgres()])
    server.use(http.post('*/v1/admin/backup-target/test', () =>
      HttpResponse.json({ status: 503, title: 'x', code: 'BACKUP_TARGET_CONFIG_INVALID' }, { status: 503 })))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('titan-backup-dev')

    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText(/Failed: The backup target in this environment's GitOps config cannot work/)).toBeInTheDocument()
  })

  it('reads the target block in Vietnamese', async () => {
    serve([postgres()])
    renderPage('vi')

    const block = await screen.findByRole('region', { name: 'Đích sao lưu' })
    await within(block).findByText('titan-backup-dev')
    expect(block).toHaveTextContent('khai ở cấu hình GitOps')
    expect(within(block).getByRole('button', { name: 'Thử kết nối' })).toBeInTheDocument()
  })

  // titan-ops features/backup/design.md#restore-drill: the page says when a restore last worked, of what, on which cluster.
  describe('latest verified restore', () => {
    it('names the cluster, what was restored and when', async () => {
      serve([postgres()], target(), minutesAgo(1), [drill()])
      renderPage()

      const section = await screen.findByRole('region', { name: 'Latest verified restore' })
      expect(within(section).getByText('Local')).toBeInTheDocument()
      expect(within(section).getByText(/VM web-1 was restored from its backup on/)).toBeInTheDocument()
    })

    it('says not verified with the reason, and when one last worked', async () => {
      serve([postgres()], target(), minutesAgo(1), [drill({
        state: 'notVerified', kind: 'volume', name: 'data-1', verifiedAt: hoursAgo(30), reason: 'import volume vol1: disk full',
      })])
      renderPage()

      const section = await screen.findByRole('region', { name: 'Latest verified restore' })
      expect(within(section).getByText(/The latest restore drill failed \(Volume data-1\)/)).toBeInTheDocument()
      expect(within(section).getByText('import volume vol1: disk full')).toBeInTheDocument()
      expect(within(section).getByText(/Last verified restore:/)).toBeInTheDocument()
    })

    it('says no restore was verified when the drill failed and none ever worked', async () => {
      serve([postgres()], target(), minutesAgo(1), [drill({
        state: 'notVerified', verifiedAt: null, reason: 'pool: not enough space',
      })])
      renderPage()

      const section = await screen.findByRole('region', { name: 'Latest verified restore' })
      expect(within(section).getByText('No restore has been verified in the last 30 days.')).toBeInTheDocument()
      expect(within(section).getByText('pool: not enough space')).toBeInTheDocument()
    })

    it('says none when no drill ended yet', async () => {
      serve([postgres()], target(), minutesAgo(1), [drill({ state: 'none', verifiedAt: null, kind: null, name: null })])
      renderPage()

      const section = await screen.findByRole('region', { name: 'Latest verified restore' })
      expect(within(section).getByText('No restore drill has ended in the last 30 days.')).toBeInTheDocument()
    })

    it('has one line for each cluster', async () => {
      serve([postgres()], target(), minutesAgo(1), [drill(), drill({ clusterId: 'sg', clusterName: 'Singapore', state: 'none', verifiedAt: null, kind: null, name: null })])
      renderPage()

      const section = await screen.findByRole('region', { name: 'Latest verified restore' })
      expect(within(section).getByText('Local')).toBeInTheDocument()
      expect(within(section).getByText('Singapore')).toBeInTheDocument()
    })

    it('is in Vietnamese when the language is', async () => {
      serve([postgres()], target(), minutesAgo(1), [drill()])
      renderPage('vi')

      const section = await screen.findByRole('region', { name: 'Lần khôi phục đã xác minh gần nhất' })
      expect(within(section).getByText(/web-1/)).toBeInTheDocument()
    })

    it('shows nothing when the control plane sends no drill field', async () => {
      serve([postgres()])
      renderPage()

      await screen.findByRole('table', { name: 'Newest backup of each resource' })
      expect(screen.queryByRole('region', { name: 'Latest verified restore' })).not.toBeInTheDocument()
    })
  })

  // titan-ops features/backup/design.md#restore-as-new-resource
  describe('restore as a new resource', () => {
    it('lists the backups of that VM with the newest chosen, and asks for the chosen one under the typed name', async () => {
      let asked: { path: string; body: unknown; key: string | null } | null = null
      let reads = 0
      serve([])
      server.use(
        http.get('*/v1/admin/backups', () => {
          reads += 1
          return HttpResponse.json({ readAt: minutesAgo(1), items: [postgres(), restorableVm()] })
        }),
        http.post('*/v1/admin/backups/vms/:vmId/restore', async ({ request }) => {
          asked = { path: new URL(request.url).pathname, body: await request.json(), key: request.headers.get('Idempotency-Key') }
          return HttpResponse.json({ newVmId: '0a1b2c3d-0000-4000-8000-0000000000c1' }, { status: 202 })
        }),
      )
      const user = userEvent.setup()
      renderPage()

      const dialog = await openRestore(user, 'web-1')
      expect(dialog).toHaveAccessibleName('Restore web-1')
      const radios = within(within(dialog).getByRole('group', { name: 'Backup to restore' })).getAllByRole('radio')
      expect(radios).toHaveLength(2)
      expect(radios[0]).toHaveAccessibleName(new RegExp(`^${when(newestArchive.takenAt)} · 636\\.1 MB$`))
      expect(radios[1]).toHaveAccessibleName(new RegExp(`^${when(olderArchive.takenAt)} · 500\\.0 MB$`))
      expect(radios[0]).toBeChecked()
      expect(radios[1]).not.toBeChecked()
      const name = within(dialog).getByLabelText('Name of the new VM')
      expect(name).toHaveValue('web-1-restored')

      await user.click(radios[1])
      await user.clear(name)
      await user.type(name, 'web-1-copy')
      const readsBefore = reads
      await user.click(within(dialog).getByRole('button', { name: 'Restore' }))

      await waitFor(() => expect(asked).toEqual({
        path: `/v1/admin/backups/vms/${vmId}/restore`,
        body: { backupKey: '20261122T120000Z', name: 'web-1-copy' },
        key: expect.stringMatching(/\S/),
      }))
      const { toast } = await import('sonner')
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Restore asked. It shows under “Recent restores”.'))
      await dialogIsGone()
      await waitFor(() => expect(reads).toBeGreaterThan(readsBefore))
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('reads the list of VMs again after a restore, so the new VM shows where VMs are listed', async () => {
      let vmReads = 0
      serve([restorableVm()])
      server.use(
        http.get('*/v1/admin/vms', () => {
          vmReads += 1
          return HttpResponse.json([])
        }),
        http.post('*/v1/admin/backups/vms/:vmId/restore', () => HttpResponse.json({ newVmId: '0a1b2c3d-0000-4000-8000-0000000000c1' }, { status: 202 })),
      )
      const user = userEvent.setup()
      renderWithProviders(<MemoryRouter><AdminBackupsPage /><VmList /></MemoryRouter>)

      const dialog = await openRestore(user, 'web-1')
      await waitFor(() => expect(vmReads).toBe(1))
      await user.click(within(dialog).getByRole('button', { name: 'Restore' }))

      await waitFor(() => expect(vmReads).toBe(2))
    })

    it('says what a VM restore does: a new free VM, left stopped, with the volumes attached to the original', async () => {
      serve([restorableVm()])
      const user = userEvent.setup()
      renderPage()

      const dialog = await openRestore(user, 'web-1')
      expect(dialog).toHaveAccessibleDescription(/^Creates a new VM in the tenant's own project from the backup you choose\./)
      expect(dialog).toHaveTextContent('The original is not touched.')
      expect(dialog).toHaveTextContent("free of charge and outside the tenant's quota until the tenant deletes it")
      expect(dialog).toHaveTextContent('the tenant sees it in their console')
      expect(dialog).toHaveTextContent('left stopped')
      expect(dialog).toHaveTextContent('same hostname and SSH host keys')
      expect(dialog).toHaveTextContent('Every volume attached to the original VM right now is restored with it, each from its own backup closest in time to the chosen one.')
      expect(dialog).toHaveTextContent('refused when one of them has no backup within 24 hours of it')
    })

    it('names every control of the dialog, the one that closes it included', async () => {
      serve([restorableVm()])
      const user = userEvent.setup()
      renderPage()

      const dialog = await openRestore(user, 'web-1')
      const controls = [...within(dialog).getAllByRole('button'), ...within(dialog).getAllByRole('radio'), within(dialog).getByRole('textbox')]
      expect(controls).toHaveLength(6)
      for (const control of controls) {
        expect(control).toHaveAccessibleName()
      }
      await user.click(within(dialog).getByRole('button', { name: 'Close' }))
      await dialogIsGone()
    })

    it('asks the volume route for a volume, and says nothing there about a stopped VM or attached volumes', async () => {
      let asked: { path: string; body: unknown; key: string | null } | null = null
      serve([restorableVm(), restorableVolume()])
      server.use(http.post('*/v1/admin/backups/volumes/:volumeId/restore', async ({ request }) => {
        asked = { path: new URL(request.url).pathname, body: await request.json(), key: request.headers.get('Idempotency-Key') }
        return HttpResponse.json({ newVolumeId: '0a1b2c3d-0000-4000-8000-0000000000c2' }, { status: 202 })
      }))
      const user = userEvent.setup()
      renderPage()

      const dialog = await openRestore(user, 'data-1')
      expect(dialog).toHaveAccessibleName('Restore data-1')
      expect(dialog).toHaveAccessibleDescription(/^Creates a new volume in the tenant's own project from the backup you choose\./)
      expect(dialog).toHaveTextContent("free of charge and outside the tenant's quota until the tenant deletes it")
      expect(dialog).not.toHaveTextContent(/left stopped|hostname|SSH|attached/)
      expect(within(dialog).getByRole('radio')).toBeChecked()
      expect(within(dialog).getByLabelText('Name of the new volume')).toHaveValue('data-1-restored')

      await user.click(within(dialog).getByRole('button', { name: 'Restore' }))

      await waitFor(() => expect(asked).toEqual({
        path: `/v1/admin/backups/volumes/${volumeId}/restore`,
        body: { backupKey: '20261123T120000Z', name: 'data-1-restored' },
        key: expect.stringMatching(/\S/),
      }))
      await dialogIsGone()
    })

    it('shows only the date of a backup whose size is not known', async () => {
      serve([restorableVolume({ archives: [{ ...newestArchive, sizeBytes: null }] })])
      const user = userEvent.setup()
      renderPage()

      const dialog = await openRestore(user, 'data-1')
      expect(within(dialog).getByRole('radio')).toHaveAccessibleName(new RegExp(`^${when(newestArchive.takenAt)}$`))
    })

    it('keeps Restore disabled while the VM name is empty, has a character a VM name cannot have, or is over 64 characters', async () => {
      const longName = 'a'.repeat(60)
      serve([restorableVm({ name: longName })])
      const user = userEvent.setup()
      renderPage()

      const dialog = await openRestore(user, longName)
      const name = within(dialog).getByLabelText('Name of the new VM')
      const submit = within(dialog).getByRole('button', { name: 'Restore' })
      // The suggested name is cut, not the suffix: the whole fits a VM name.
      expect(name).toHaveValue(`${'a'.repeat(55)}-restored`)
      expect(submit).toBeEnabled()
      expect(name).not.toBeInvalid()

      await user.clear(name)
      expect(submit).toBeDisabled()
      expect(name).toBeInvalid()
      expect(within(dialog).getByText('Enter a name.')).toBeInTheDocument()

      await user.type(name, 'web_1')
      expect(submit).toBeDisabled()
      expect(within(dialog).getByText('Use only letters a–z or A–Z, digits and hyphens, starting with a letter or a digit.')).toBeInTheDocument()

      await user.clear(name)
      await user.type(name, '-web')
      expect(submit).toBeDisabled()

      await user.clear(name)
      await user.type(name, 'web 1')
      expect(submit).toBeDisabled()

      await user.clear(name)
      await user.paste('b'.repeat(65))
      expect(submit).toBeDisabled()
      expect(within(dialog).getByText('At most 64 characters.')).toBeInTheDocument()

      await user.clear(name)
      await user.paste('b'.repeat(64))
      expect(submit).toBeEnabled()
      expect(name).not.toBeInvalid()
      expect(within(dialog).queryByText('At most 64 characters.')).not.toBeInTheDocument()
    })

    it('takes a volume name of 1 to 100 characters, whatever the characters', async () => {
      const longName = 'd'.repeat(95)
      serve([restorableVolume({ name: longName })])
      const user = userEvent.setup()
      renderPage()

      const dialog = await openRestore(user, longName)
      const name = within(dialog).getByLabelText('Name of the new volume')
      const submit = within(dialog).getByRole('button', { name: 'Restore' })
      expect(name).toHaveValue(`${'d'.repeat(91)}-restored`)
      expect(submit).toBeEnabled()

      await user.clear(name)
      expect(submit).toBeDisabled()
      expect(within(dialog).getByText('Enter a name.')).toBeInTheDocument()

      await user.type(name, '   ')
      expect(submit).toBeDisabled()

      await user.clear(name)
      await user.type(name, 'my data_1 (copy)')
      expect(submit).toBeEnabled()

      await user.clear(name)
      await user.paste('e'.repeat(101))
      expect(submit).toBeDisabled()
      expect(within(dialog).getByText('At most 100 characters.')).toBeInTheDocument()

      await user.clear(name)
      await user.paste('e'.repeat(100))
      expect(submit).toBeEnabled()
    })

    it('asks nothing when Enter is pressed on a name that cannot be used', async () => {
      let posts = 0
      serve([restorableVm()])
      server.use(http.post('*/v1/admin/backups/vms/:vmId/restore', () => {
        posts += 1
        return HttpResponse.json({ newVmId: '0a1b2c3d-0000-4000-8000-0000000000c1' }, { status: 202 })
      }))
      const user = userEvent.setup()
      renderPage()

      const dialog = await openRestore(user, 'web-1')
      const name = within(dialog).getByLabelText('Name of the new VM')
      await user.clear(name)
      await user.type(name, 'web_1{Enter}')

      expect(within(dialog).getByRole('button', { name: 'Restore' })).toBeDisabled()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(posts).toBe(0)
    })

    it('works from the keyboard: an arrow key chooses the backup, Enter in the name field asks for the restore', async () => {
      let body: unknown = null
      serve([restorableVm()])
      server.use(http.post('*/v1/admin/backups/vms/:vmId/restore', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ newVmId: '0a1b2c3d-0000-4000-8000-0000000000c1' }, { status: 202 })
      }))
      const user = userEvent.setup()
      renderPage()
      const table = await screen.findByRole('table')

      within(table).getByRole('button', { name: 'Restore' }).focus()
      await user.keyboard('{Enter}')
      const dialog = await screen.findByRole('dialog')
      const radios = within(dialog).getAllByRole('radio')
      // Reading order is focus order: the backups, the name, Cancel, Restore.
      await waitFor(() => expect(radios[0]).toHaveFocus())
      await user.keyboard('{ArrowDown}')
      expect(radios[1]).toBeChecked()
      await user.tab()
      expect(within(dialog).getByLabelText('Name of the new VM')).toHaveFocus()
      await user.tab()
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
      await user.tab()
      expect(within(dialog).getByRole('button', { name: 'Restore' })).toHaveFocus()
      await user.tab({ shift: true })
      await user.tab({ shift: true })
      await user.keyboard('{Enter}')

      await waitFor(() => expect(body).toEqual({ backupKey: '20261122T120000Z', name: 'web-1-restored' }))
      await dialogIsGone()
    })

    it('reads Restoring… and cannot be pressed again while the request runs', async () => {
      let posts = 0
      let answer: () => void = () => {}
      const held = new Promise<void>(resolve => { answer = resolve })
      serve([restorableVm()])
      server.use(http.post('*/v1/admin/backups/vms/:vmId/restore', async () => {
        posts += 1
        await held
        return HttpResponse.json({ newVmId: '0a1b2c3d-0000-4000-8000-0000000000c1' }, { status: 202 })
      }))
      const user = userEvent.setup()
      renderPage()

      const dialog = await openRestore(user, 'web-1')
      await user.click(within(dialog).getByRole('button', { name: 'Restore' }))

      expect(await within(dialog).findByRole('button', { name: 'Restoring…' })).toBeDisabled()
      expect(within(dialog).queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
      answer()
      await dialogIsGone()
      expect(posts).toBe(1)
    })

    it.each([
      ['VM_NAME_TAKEN', 409, 'The tenant already has a VM with this name. Choose another name.'],
      ['BACKUP_NOT_FOUND', 404, 'This backup is no longer there. Close this dialog and open it again to see the backups there are now.'],
      ['BACKUP_SOURCE_INVALID_STATE', 422, 'The original, or for a VM a volume attached to it, is in a state it cannot be restored from. Nothing was created.'],
    ])('says %s in words, and the dialog stays open', async (code, status, words) => {
      serve([restorableVm()])
      server.use(http.post('*/v1/admin/backups/vms/:vmId/restore', () =>
        HttpResponse.json({ status, title: `the server's own title of ${code}`, code }, { status })))
      const user = userEvent.setup()
      renderPage()

      const dialog = await openRestore(user, 'web-1')
      await user.click(within(dialog).getByRole('button', { name: 'Restore' }))

      const { toast } = await import('sonner')
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(words))
      expect(toast.success).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Name of the new VM')).toHaveValue('web-1-restored')
      await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Restore' })).toBeEnabled())
    })

    it('reads the backups again when the chosen backup is no longer there, so the dialog opened again lists the ones there are', async () => {
      let reads = 0
      serve([])
      server.use(
        http.get('*/v1/admin/backups', () => {
          reads += 1
          return HttpResponse.json({ readAt: minutesAgo(1), items: [restorableVm()] })
        }),
        http.post('*/v1/admin/backups/vms/:vmId/restore', () =>
          HttpResponse.json({ status: 404, title: 'Backup not found.', code: 'BACKUP_NOT_FOUND' }, { status: 404 })),
      )
      const user = userEvent.setup()
      renderPage()

      const dialog = await openRestore(user, 'web-1')
      const readsBefore = reads
      await user.click(within(dialog).getByRole('button', { name: 'Restore' }))

      const { toast } = await import('sonner')
      await waitFor(() => expect(toast.error).toHaveBeenCalled())
      await waitFor(() => expect(reads).toBeGreaterThan(readsBefore))
    })

    it('names the attached volume that has no backup close enough, from the answer of the control plane', async () => {
      const title = "Volume 'data-1' (0a1b2c3d-0000-4000-8000-00000000000b) has no backup within 24 hours of the chosen backup."
      serve([restorableVm()])
      server.use(http.post('*/v1/admin/backups/vms/:vmId/restore', () =>
        HttpResponse.json({ status: 422, title, code: 'BACKUP_OF_ATTACHED_VOLUME_NOT_FOUND' }, { status: 422 })))
      const user = userEvent.setup()
      renderPage()

      const dialog = await openRestore(user, 'web-1')
      await user.click(within(dialog).getByRole('button', { name: 'Restore' }))

      const { toast } = await import('sonner')
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
        `A volume attached to this VM has no backup within 24 hours of the chosen one, so nothing was created. ${title}`))
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('shows any other refusal as the page shows errors: the code and the title, or that the request failed', async () => {
      let answer: Response = HttpResponse.json({ status: 404, title: 'VM not found', code: 'VM_NOT_FOUND' }, { status: 404 })
      serve([restorableVm()])
      server.use(http.post('*/v1/admin/backups/vms/:vmId/restore', () => answer))
      const user = userEvent.setup()
      renderPage()

      const dialog = await openRestore(user, 'web-1')
      await user.click(within(dialog).getByRole('button', { name: 'Restore' }))
      const { toast } = await import('sonner')
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('VM_NOT_FOUND — VM not found'))

      answer = new HttpResponse(null, { status: 502 })
      await user.click(await within(dialog).findByRole('button', { name: 'Restore' }))
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to ask for the restore.'))
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('starts from the newest backup and the suggested name each time it opens', async () => {
      serve([restorableVm(), restorableVolume()])
      const user = userEvent.setup()
      renderPage()

      let dialog = await openRestore(user, 'web-1')
      await user.click(within(dialog).getAllByRole('radio')[1])
      await user.clear(within(dialog).getByLabelText('Name of the new VM'))
      await user.type(within(dialog).getByLabelText('Name of the new VM'), 'mine')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      await dialogIsGone()

      dialog = await openRestore(user, 'data-1')
      expect(within(dialog).getByLabelText('Name of the new volume')).toHaveValue('data-1-restored')
      expect(within(dialog).getByRole('radio')).toBeChecked()
      await user.keyboard('{Escape}')
      await dialogIsGone()

      dialog = await openRestore(user, 'web-1')
      expect(within(dialog).getByLabelText('Name of the new VM')).toHaveValue('web-1-restored')
      expect(within(dialog).getAllByRole('radio')[0]).toBeChecked()
      expect(within(dialog).getAllByRole('radio')[1]).not.toBeChecked()
    })

    it('leaves the dialog of another resource open when an earlier restore is answered', async () => {
      let answer: () => void = () => {}
      const held = new Promise<void>(resolve => { answer = resolve })
      serve([restorableVm(), restorableVolume()])
      server.use(http.post('*/v1/admin/backups/vms/:vmId/restore', async () => {
        await held
        return HttpResponse.json({ newVmId: '0a1b2c3d-0000-4000-8000-0000000000c1' }, { status: 202 })
      }))
      const user = userEvent.setup()
      renderPage()

      let dialog = await openRestore(user, 'web-1')
      await user.click(within(dialog).getByRole('button', { name: 'Restore' }))
      await within(dialog).findByRole('button', { name: 'Restoring…' })
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      await dialogIsGone()
      dialog = await openRestore(user, 'data-1')
      answer()

      const { toast } = await import('sonner')
      await waitFor(() => expect(toast.success).toHaveBeenCalled())
      await within(dialog).findByRole('button', { name: 'Restore' })
      expect(screen.getByRole('dialog')).toHaveAccessibleName('Restore data-1')
    })

    it('keeps two volumes of one tenant that share a name as two rows, each restoring its own volume', async () => {
      const second = '0a1b2c3d-0000-4000-8000-00000000000d'
      let restored: string | null = null
      serve([restorableVolume(), restorableVolume({ resourceId: second })])
      server.use(http.post('*/v1/admin/backups/volumes/:volumeId/restore', ({ params }) => {
        restored = String(params.volumeId)
        return HttpResponse.json({ newVolumeId: '0a1b2c3d-0000-4000-8000-0000000000c2' }, { status: 202 })
      }))
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const user = userEvent.setup()
        renderPage()

        const rows = (await screen.findAllByText('data-1')).map(cell => cell.closest('tr') as HTMLElement)
        expect(rows).toHaveLength(2)
        await user.click(within(rows[1]).getByRole('button', { name: 'Restore' }))
        await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Restore' }))

        await waitFor(() => expect(restored).toBe(second))
        expect(consoleError.mock.calls.filter(call => String(call[0]).includes('same key'))).toEqual([])
      } finally {
        consoleError.mockRestore()
      }
    })

    it('shows its rows and offers no Restore when the control plane sends no resource id, no archives and no restores', async () => {
      serve([postgres(), disk(), disk({ kind: 'volume', name: 'data-1' })])
      renderPage()

      const table = await screen.findByRole('table', { name: 'Newest backup of each resource' })
      expect(within(table).getByText('titan-db')).toBeInTheDocument()
      expect(within(within(table).getByText('web-1').closest('tr') as HTMLElement).getByText('636.1 MB')).toBeInTheDocument()
      expect(within(within(table).getByText('data-1').closest('tr') as HTMLElement).getByText('Volume')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Recent restores' })).not.toBeInTheDocument()
    })

    it('reads in Vietnamese: the button, the dialog and what the control plane refuses', async () => {
      serve([restorableVm()])
      server.use(http.post('*/v1/admin/backups/vms/:vmId/restore', () =>
        HttpResponse.json({ status: 409, title: 'x', code: 'VM_NAME_TAKEN' }, { status: 409 })))
      const user = userEvent.setup()
      renderPage('vi')

      const dialog = await openRestore(user, 'web-1', 'Khôi phục')
      expect(dialog).toHaveAccessibleName('Khôi phục web-1')
      expect(dialog).toHaveAccessibleDescription(/^Tạo một VM mới trong project của chính tenant từ bản sao lưu bạn chọn\./)
      expect(dialog).toHaveTextContent('VM gốc không bị đụng tới.')
      expect(dialog).toHaveTextContent('VM mới được để ở trạng thái dừng')
      expect(dialog).toHaveTextContent('cùng hostname và cùng khoá host SSH')
      const radios = within(within(dialog).getByRole('group', { name: 'Bản sao lưu dùng để khôi phục' })).getAllByRole('radio')
      expect(radios[0]).toHaveAccessibleName(new RegExp(`^${when(newestArchive.takenAt, 'vi')} · 636\\.1 MB$`))
      const name = within(dialog).getByLabelText('Tên của VM mới')
      expect(name).toHaveValue('web-1-restored')
      expect(within(dialog).getByRole('button', { name: 'Huỷ' })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Đóng' })).toBeInTheDocument()

      await user.clear(name)
      expect(within(dialog).getByText('Hãy nhập tên.')).toBeInTheDocument()
      await user.type(name, 'web_1')
      expect(within(dialog).getByText('Chỉ dùng chữ cái a–z hoặc A–Z, chữ số và dấu gạch nối, bắt đầu bằng chữ cái hoặc chữ số.')).toBeInTheDocument()
      await user.clear(name)
      await user.type(name, 'web-1')
      await user.click(within(dialog).getByRole('button', { name: 'Khôi phục' }))

      const { toast } = await import('sonner')
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Tenant đã có một VM mang tên này. Hãy chọn tên khác.'))
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('says in Vietnamese that the restore was asked', async () => {
      serve([restorableVolume()])
      server.use(http.post('*/v1/admin/backups/volumes/:volumeId/restore', () =>
        HttpResponse.json({ newVolumeId: '0a1b2c3d-0000-4000-8000-0000000000c2' }, { status: 202 })))
      const user = userEvent.setup()
      renderPage('vi')

      const dialog = await openRestore(user, 'data-1', 'Khôi phục')
      expect(dialog).toHaveAccessibleDescription(/^Tạo một ổ đĩa mới trong project của chính tenant từ bản sao lưu bạn chọn\. Ổ đĩa gốc không bị đụng tới\./)
      expect(dialog).not.toHaveTextContent(/trạng thái dừng|hostname|SSH|gắn/)
      expect(within(dialog).getByLabelText('Tên của ổ đĩa mới')).toHaveValue('data-1-restored')
      await user.click(within(dialog).getByRole('button', { name: 'Khôi phục' }))

      const { toast } = await import('sonner')
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã gửi yêu cầu khôi phục. Xem ở mục “Khôi phục gần đây”.'))
      await dialogIsGone()
    })
  })

  // titan-ops features/backup/design.md#restore-as-new-resource: what was asked from the Restore button, and how each ended.
  describe('recent restores', () => {
    const serveRestores = (restores?: unknown[], items: unknown[] = [postgres()]) =>
      serve(items, target(), minutesAgo(1), undefined, restores)

    it('has a line for each restore: what, whose, from which backup, its state and when it was asked', async () => {
      serveRestores([
        restore(),
        restore({
          kind: 'volume', resourceId: '0a1b2c3d-0000-4000-8000-0000000000c2', name: 'data-1', state: 'done',
          takenAt: '2026-11-20T12:00:00Z', askedAt: '2026-11-21T12:00:00Z',
        }),
        restore({
          resourceId: '0a1b2c3d-0000-4000-8000-0000000000c3', name: null, tenantId: null, takenAt: null, state: 'failed',
          askedAt: '2026-11-19T12:00:00Z', reason: 'import instance vm123: not enough space in the pool',
        }),
      ])
      renderPage()

      const section = await screen.findByRole('region', { name: 'Recent restores' })
      expect(within(section).getByText('Restores asked from this page in the last 30 days.')).toBeInTheDocument()
      const lines = within(section).getAllByRole('listitem')
      expect(lines).toHaveLength(3)
      // The tenant's name comes with the list of tenants, a moment after the restores.
      await waitFor(() => expect(lines[0]).toHaveTextContent(new RegExp(
        `^VM web-1-restored · Acme · from the backup of ${when('2026-11-22T12:00:00Z')} running asked ${when('2026-11-23T12:00:00Z')}$`)))
      expect(lines[1]).toHaveTextContent(new RegExp(
        `^Volume data-1 · Acme · from the backup of ${when('2026-11-20T12:00:00Z')} done asked ${when('2026-11-21T12:00:00Z')}$`))
      expect(lines[2]).toHaveTextContent(new RegExp(`^VM — · — · from the backup of — failed asked ${when('2026-11-19T12:00:00Z')}`))
      expect(within(lines[2]).getByText('import instance vm123: not enough space in the pool')).toBeInTheDocument()
      // The state is a word, and its colour agrees with it.
      expect(within(lines[0]).getByText('running')).toHaveClass('text-info')
      expect(within(lines[1]).getByText('done')).toHaveClass('text-ok')
      expect(within(lines[2]).getByText('failed')).toHaveClass('text-bad')
    })

    it('shows a reason only on a restore that failed', async () => {
      serveRestores([restore({ state: 'done', reason: 'left over from an earlier attempt' })])
      renderPage()

      const section = await screen.findByRole('region', { name: 'Recent restores' })
      expect(within(section).getByText('done')).toBeInTheDocument()
      expect(within(section).queryByText('left over from an earlier attempt')).not.toBeInTheDocument()
    })

    it('comes after the latest verified restore', async () => {
      serve([postgres()], target(), minutesAgo(1), [drill()], [restore()])
      renderPage()

      const drills = await screen.findByRole('region', { name: 'Latest verified restore' })
      const restores = screen.getByRole('region', { name: 'Recent restores' })
      expect(drills.compareDocumentPosition(restores) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(restores.compareDocumentPosition(screen.getByRole('region', { name: 'Backup target' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('is absent when the control plane sends no restores field', async () => {
      serveRestores(undefined)
      renderPage()

      await screen.findByRole('table', { name: 'Newest backup of each resource' })
      expect(screen.queryByRole('region', { name: 'Recent restores' })).not.toBeInTheDocument()
      expect(screen.queryByText('Restores asked from this page in the last 30 days.')).not.toBeInTheDocument()
    })

    it('is absent when no restore was asked', async () => {
      serveRestores([])
      renderPage()

      await screen.findByRole('table', { name: 'Newest backup of each resource' })
      expect(screen.queryByRole('region', { name: 'Recent restores' })).not.toBeInTheDocument()
    })

    it('is in Vietnamese when the language is, the state word staying the server\'s own', async () => {
      serveRestores([restore({ kind: 'volume', name: 'data-1', state: 'failed', reason: 'pool: not enough space' })])
      renderPage('vi')

      const section = await screen.findByRole('region', { name: 'Khôi phục gần đây' })
      expect(within(section).getByText('Các lần khôi phục được yêu cầu từ trang này trong 30 ngày qua.')).toBeInTheDocument()
      const line = within(section).getByRole('listitem')
      await waitFor(() => expect(line).toHaveTextContent(new RegExp(
        `^Ổ đĩa data-1 · Acme · từ bản sao lưu lúc ${when('2026-11-22T12:00:00Z', 'vi')} failed yêu cầu lúc ${when('2026-11-23T12:00:00Z', 'vi')}`)))
      expect(within(line).getByText('pool: not enough space')).toBeInTheDocument()
    })
  })
})
