import { screen, waitFor, within } from '@testing-library/react'
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
  accessKeyId: 'key-id-123', updatedAt: '2026-10-25T10:00:00Z', ...o,
})

function serve(items: unknown[], savedTarget: unknown = target(), readAt: string | null = minutesAgo(1)) {
  server.use(
    http.get('*/v1/admin/backups', () => HttpResponse.json({ readAt, items })),
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
    await waitFor(() => expect(screen.getByDisplayValue('titan-backup-dev')).toBeInTheDocument())
    expect(screen.getByDisplayValue('key-id-123')).toBeInTheDocument()
    expect(screen.getByDisplayValue('https://acct.r2.cloudflarestorage.com')).toBeInTheDocument()
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

  it('says a missing backup is missing, with the reason a wrong bucket gives', async () => {
    serve([postgres({ health: 'Missing', reason: 'NoPostgresBackupInBucket', takenAt: null, sizeBytes: null, lastWalAt: null })])
    renderPage()

    expect(await screen.findByText('Missing')).toBeInTheDocument()
    expect(screen.getByText('No Postgres backup in this bucket: wrong bucket, or no backup yet.')).toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByDisplayValue('titan-backup-dev')).toBeInTheDocument())

    const names = screen.getAllByRole('button').map(b => b.textContent ?? '')
    expect(names.join('|')).not.toMatch(/restore|delete|download|back up now|backup now/i)
    expect(screen.queryByRole('link', { name: /restore now|download/i })).not.toBeInTheDocument()
  })

  it('reminds that restoring runs outside the console, with the runbook and the audit log', async () => {
    serve([postgres()])
    renderPage()

    const section = await screen.findByRole('region', { name: 'Restoring' })
    expect(section).toHaveTextContent('runs outside this console')
    expect(within(section).getByRole('link', { name: 'Disaster recovery runbook' }))
      .toHaveAttribute('href', expect.stringContaining('docs/infra/oci/runbook.md'))
    expect(within(section).getByRole('link', { name: 'See changes in the audit log' })).toHaveAttribute('href', '/audit-log')
  })

  it('opens the secret field empty, with a note that empty keeps the stored one', async () => {
    serve([postgres()])
    renderPage()

    const secret = await screen.findByLabelText('Secret access key')
    expect(secret).toHaveValue('')
    expect(secret).toHaveAttribute('type', 'password')
    expect(screen.getByText('Leave empty to keep the stored secret.')).toBeInTheDocument()
  })

  it('saves without a secret field when none was typed, and with it when it was', async () => {
    const bodies: Record<string, unknown>[] = []
    serve([postgres()])
    server.use(
      http.put('*/v1/admin/backup-target', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const user = userEvent.setup()
    renderPage()
    await screen.findByDisplayValue('titan-backup-dev')

    await user.type(screen.getByLabelText('Access key id'), '4')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({
      endpoint: 'https://acct.r2.cloudflarestorage.com', region: 'auto', bucket: 'titan-backup-dev', accessKeyId: 'key-id-1234',
    })
    expect('secretAccessKey' in bodies[0]).toBe(false)

    await user.type(await screen.findByLabelText('Secret access key'), 'S3CR3T-value')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1].secretAccessKey).toBe('S3CR3T-value')
  })

  it('needs a secret the first time, and cannot test a target that is not saved', async () => {
    serve([], null)
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Required the first time.')).toBeInTheDocument()
    expect(screen.getByText('No backup target is set yet. Enter the S3 bucket and its key.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled()
    await user.type(screen.getByLabelText('Endpoint'), 'https://acct.r2.cloudflarestorage.com')
    await user.type(screen.getByLabelText('Bucket'), 'titan-backup-dev')
    await user.type(screen.getByLabelText('Access key id'), 'key-id')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.type(screen.getByLabelText('Secret access key'), 'S3CR3T-value')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('shows the connection result with its latency, or the reason it failed', async () => {
    let answer: { ok: boolean; latencyMs: number | null; error: string | null } = { ok: true, latencyMs: 87, error: null }
    serve([postgres()])
    server.use(http.post('*/v1/admin/backup-target/test', () => HttpResponse.json(answer)))
    const user = userEvent.setup()
    renderPage()
    await screen.findByDisplayValue('titan-backup-dev')

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

  it('treats only BACKUP_TARGET_NOT_FOUND as "no target yet"', async () => {
    server.use(
      http.get('*/v1/admin/backups', () => HttpResponse.json({ readAt: null, items: [postgres()] })),
      http.get('*/v1/admin/backup-target', () => HttpResponse.json({ status: 404, title: 'x', code: 'SOMETHING_ELSE' }, { status: 404 })),
    )
    renderPage()

    expect(await screen.findByText('Failed to load the backup target.')).toBeInTheDocument()
    expect(screen.queryByText('No backup target is set yet. Enter the S3 bucket and its key.')).not.toBeInTheDocument()
  })

  it('names the reason when Test cannot open the stored secret', async () => {
    serve([postgres()])
    server.use(http.post('*/v1/admin/backup-target/test', () =>
      HttpResponse.json({ status: 503, title: 'x', code: 'BACKUP_TARGET_SECRET_UNREADABLE' }, { status: 503 })))
    const user = userEvent.setup()
    renderPage()
    await screen.findByDisplayValue('titan-backup-dev')

    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText(/cannot decrypt the stored secret/)).toBeInTheDocument()
  })

  it('keeps Save off until something changed on a saved target, and trims what is sent', async () => {
    const bodies: Record<string, unknown>[] = []
    serve([postgres()])
    server.use(http.put('*/v1/admin/backup-target', async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>)
      return new HttpResponse(null, { status: 204 })
    }))
    const user = userEvent.setup()
    renderPage()
    await screen.findByDisplayValue('titan-backup-dev')

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.type(screen.getByLabelText('Bucket'), '-2  ')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].bucket).toBe('titan-backup-dev-2')
  })
})
