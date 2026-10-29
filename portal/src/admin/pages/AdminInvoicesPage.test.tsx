import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { AdminInvoicesPage } from './AdminInvoicesPage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const invoice = (o = {}) => ({
  id: 'i1', tenantId: 'tenant-1', periodYear: 2026, periodMonth: 4, status: 'New',
  issuedAt: '2026-04-01T00:00:00Z', dueAt: '2026-04-15T00:00:00Z', paidAt: null, paidBy: null,
  total: 225000, currency: 'VND',
  ...o,
})

describe('AdminInvoicesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no tenant list, so the tenant cell falls back to the raw id. Individual tests
    // opt into a real tenant list to assert name resolution.
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([])))
  })

  it('shows empty state when no invoices', async () => {
    server.use(http.get('*/v1/admin/invoices', () => HttpResponse.json([])))
    renderWithProviders(<AdminInvoicesPage />)
    await waitFor(() => expect(screen.getByText('No invoices')).toBeInTheDocument())
  })

  it('renders invoice row with tenant, period, total and status', async () => {
    server.use(http.get('*/v1/admin/invoices', () => HttpResponse.json([invoice()])))
    renderWithProviders(<AdminInvoicesPage />)
    await waitFor(() => expect(screen.getByText('tenant-1')).toBeInTheDocument())
    expect(screen.getByText('2026-04')).toBeInTheDocument()
    expect(screen.getByText('225,000 ₫')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
  })

  it('resolves the tenant id to the tenant name from /v1/tenants', async () => {
    server.use(
      http.get('*/v1/tenants', () =>
        HttpResponse.json([{ id: 'tenant-1', name: 'Acme Corp', status: 'Active', maxVms: 10, maxNetworks: 1 }]),
      ),
      http.get('*/v1/admin/invoices', () => HttpResponse.json([invoice()])),
    )
    renderWithProviders(<AdminInvoicesPage />)
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument())
    // The raw id must not leak into the cell when a name is available.
    expect(screen.queryByText('tenant-1')).not.toBeInTheDocument()
  })

  it('mark paid PATCHes the /pay route for an unpaid invoice', async () => {
    let hit = false
    server.use(
      http.get('*/v1/admin/invoices', () => HttpResponse.json([invoice()])),
      http.patch('*/v1/admin/invoices/i1/pay', () => {
        hit = true
        return new HttpResponse(null, { status: 204 }) // titan-ops architecture/http-contract.md#commands-return-no-data
      }),
    )
    renderWithProviders(<AdminInvoicesPage />)
    await waitFor(() => expect(screen.getByText('tenant-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Mark paid' }))
    await waitFor(() => expect(hit).toBe(true))
  })

  it('disables mark paid for an already-paid invoice (no double-mark)', async () => {
    server.use(http.get('*/v1/admin/invoices', () => HttpResponse.json([invoice({ status: 'Paid' })])))
    renderWithProviders(<AdminInvoicesPage />)
    await waitFor(() => expect(screen.getByText('Paid')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Mark paid' })).toBeDisabled()
  })

  // US-PW-P4 / AC-P4.2 — a wallet-settled invoice is already paid from prepaid credit; Mark paid must
  // be disabled so an admin cannot double-pay it.
  it('disables mark paid for a wallet-settled invoice', async () => {
    server.use(http.get('*/v1/admin/invoices', () => HttpResponse.json([invoice({ status: 'Settled' })])))
    renderWithProviders(<AdminInvoicesPage />)
    await waitFor(() => expect(screen.getByText('Settled')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Mark paid' })).toBeDisabled()
  })

  it('shows error code from res.data.code when mark paid fails', async () => {
    const { toast } = await import('sonner')
    server.use(
      http.get('*/v1/admin/invoices', () => HttpResponse.json([invoice()])),
      http.patch('*/v1/admin/invoices/i1/pay', () =>
        HttpResponse.json({ code: 'INVOICE_ALREADY_PAID' }, { status: 422 }),
      ),
    )
    renderWithProviders(<AdminInvoicesPage />)
    await waitFor(() => expect(screen.getByText('tenant-1')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Mark paid' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('INVOICE_ALREADY_PAID'))
  })
})

// ── titan-ops architecture/money-and-wallet.md#human-confirmed-debit PAY-5 — admin settles from the tenant's wallet ─────────────────
//
// Two buttons that must never be confused: "Mark paid" records money that arrived OUTSIDE Titan and
// touches no wallet; "Settle from wallet" spends the customer's credit. Mixing them up either takes a
// customer's credit for a bill they already paid by bank transfer, or leaves real money unrecorded —
// so these tests pin that they hit DIFFERENT routes.
describe('AdminInvoicesPage — settle from wallet vs mark paid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([])))
  })

  it('offers both actions on an owed invoice, with distinct labels', async () => {
    server.use(http.get('*/v1/admin/invoices', () => HttpResponse.json([invoice()])))
    renderWithProviders(<AdminInvoicesPage />)

    expect(await screen.findByRole('button', { name: 'Mark paid' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Settle from wallet' })).toBeEnabled()
  })

  it('settle-from-wallet posts to the wallet-settlement route, not the mark-paid route', async () => {
    server.use(http.get('*/v1/admin/invoices', () => HttpResponse.json([invoice()])))
    const hits: string[] = []
    server.use(
      http.post('*/v1/admin/invoices/:id/settle-from-wallet', ({ params }) => {
        hits.push(`settle:${params.id}`)
        return new HttpResponse(null, { status: 202 }) // titan-ops architecture/http-contract.md#async-actions-return-202
      }),
      http.patch('*/v1/admin/invoices/:id/pay', ({ params }) => {
        hits.push(`markpaid:${params.id}`)
        return new HttpResponse(null, { status: 204 })
      }),
    )

    renderWithProviders(<AdminInvoicesPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Settle from wallet' }))

    await waitFor(() => expect(hits).toEqual(['settle:i1']))
  })

  it('surfaces the shortfall rejection instead of a bare error code', async () => {
    server.use(http.get('*/v1/admin/invoices', () => HttpResponse.json([invoice()])))
    server.use(http.post('*/v1/admin/invoices/:id/settle-from-wallet', () =>
      HttpResponse.json({ status: 422, title: 'short', code: 'INVOICE_WALLET_INSUFFICIENT' }, { status: 422 })))
    const { toast } = await import('sonner')

    renderWithProviders(<AdminInvoicesPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Settle from wallet' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/does not cover/i)))
  })

  it('disables both actions once the invoice is settled either way', async () => {
    server.use(http.get('*/v1/admin/invoices', () =>
      HttpResponse.json([invoice({ status: 'SettledByWallet' })])))
    renderWithProviders(<AdminInvoicesPage />)

    expect(await screen.findByRole('button', { name: 'Mark paid' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Settle from wallet' })).toBeDisabled()
  })
})

// titan-ops architecture/money-and-wallet.md#single-writer-outbox S7 / AC-S7.4 — an admin spends the TENANT'S wallet (titan-ops architecture/money-and-wallet.md#human-confirmed-debit PAY-5). Since S5 the settle
// request returns 202 with the debit still in flight, so a row can sit there looking unpaid while
// money is already moving. Both buttons have to be off in that window, and for different reasons:
// settling twice debits the wallet twice, and marking paid on top of a wallet payment destroys the
// audit trail's ability to say who spent whose money — the exact distinction the two routes exist
// to preserve.
describe('AdminInvoicesPage — payment in flight (S7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([])))
  })

  it('disables BOTH buttons while a wallet payment is being applied', async () => {
    server.use(
      http.get('*/v1/admin/invoices', () =>
        HttpResponse.json([invoice({ status: 'New', paymentState: 'Processing' })]),
      ),
    )
    renderWithProviders(<AdminInvoicesPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: /settle from wallet/i })).toBeDisabled())
    expect(screen.getByRole('button', { name: /mark paid/i })).toBeDisabled()
  })

  it('shows the row as processing rather than as unpaid', async () => {
    server.use(
      http.get('*/v1/admin/invoices', () =>
        HttpResponse.json([invoice({ status: 'New', paymentState: 'Processing' })]),
      ),
    )
    renderWithProviders(<AdminInvoicesPage />)
    await waitFor(() => expect(screen.getByText('Processing')).toBeInTheDocument())
    // "New" is the honest stored status but the misleading thing to show: it reads as "nothing
    // happened" to an admin who just pressed the button.
    expect(screen.queryByText('New')).not.toBeInTheDocument()
  })

  it('re-enables both buttons after a payment fails, so it can be retried', async () => {
    server.use(
      http.get('*/v1/admin/invoices', () =>
        HttpResponse.json([invoice({ status: 'New', paymentState: 'Failed' })]),
      ),
    )
    renderWithProviders(<AdminInvoicesPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: /settle from wallet/i })).toBeEnabled())
    expect(screen.getByRole('button', { name: /mark paid/i })).toBeEnabled()
  })

  it('leaves both buttons enabled when nobody has paid the invoice', async () => {
    server.use(
      http.get('*/v1/admin/invoices', () =>
        HttpResponse.json([invoice({ status: 'New', paymentState: null })]),
      ),
    )
    renderWithProviders(<AdminInvoicesPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: /settle from wallet/i })).toBeEnabled())
    expect(screen.getByRole('button', { name: /mark paid/i })).toBeEnabled()
  })

  it('renders in Vietnamese: heading, table headers, buttons and money in Vietnamese format', async () => {
    server.use(http.get('*/v1/admin/invoices', () => HttpResponse.json([invoice()])))
    renderWithProviders(<AdminInvoicesPage />, { lang: 'vi' })
    await waitFor(() => expect(screen.getByText('tenant-1')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Hoá đơn' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Kỳ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Đánh dấu đã trả' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Trả từ ví' })).toBeEnabled()
    expect(screen.getByText('225.000 ₫')).toBeInTheDocument()
  })
})
