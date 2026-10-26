import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { AdminBackupsPage } from './AdminBackupsPage'

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

function serve(items: unknown[], savedTarget: unknown = target(), readAt: string | null = minutesAgo(1)) {
  server.use(
    http.get('*/v1/admin/backups', () => HttpResponse.json({ readAt, items })),
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

  // docs/features/backup/design.md#incus-backup: one row per VM and volume Incus holds, under its tenant's name.
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

  it('names the kinds and the new reason in Vietnamese too', async () => {
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

  it('offers no Restore, Delete, Download or back-up-now button anywhere', async () => {
    serve([postgres({ health: 'Stale', reason: 'BaseTooOld' })])
    renderPage()
    await screen.findByRole('table')
    await screen.findByText('titan-backup-dev')

    const names = screen.getAllByRole('button').map(b => b.textContent ?? '')
    expect(names.join('|')).not.toMatch(/restore|delete|download|back up now|backup now|save/i)
    expect(screen.queryByRole('link', { name: /restore now|download/i })).not.toBeInTheDocument()
  })

  it('reminds that restoring runs outside the console, with the runbook', async () => {
    serve([postgres()])
    renderPage()

    const section = await screen.findByRole('region', { name: 'Restoring' })
    expect(section).toHaveTextContent('runs outside this console')
    expect(within(section).getByRole('link', { name: 'Disaster recovery runbook' }))
      .toHaveAttribute('href', expect.stringContaining('docs/infra/oci/runbook.md'))
    expect(within(section).queryByRole('link', { name: /audit log/i })).not.toBeInTheDocument()
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
})
