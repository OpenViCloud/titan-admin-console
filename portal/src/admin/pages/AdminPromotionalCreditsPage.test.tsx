import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { AdminPromotionalCreditsPage } from './AdminPromotionalCreditsPage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

// US-TOPUP-CONSOLIDATE — the wire shape is now TopUpDto (Source=PromotionalCredit); the hook maps
// confirmedBy/confirmedAt to the page's granted-by/at.
const credit = (o = {}) => ({
  id: 'pc-1', tenantId: 't1', amount: 500000, currency: 'VND', reason: 'Launch promo',
  status: 'Confirmed', paymentRef: 'PROMO-pc-1', source: 'PromotionalCredit',
  confirmedBy: 'admin-1', createdAt: '2026-09-10T00:00:00Z', confirmedAt: '2026-09-10T00:00:00Z', ...o,
})
const tenant = (o = {}) => ({
  id: 't1', name: 'alice', status: 'Active', maxVms: 10, maxNetworks: 1,
  createdAt: '2026-01-01T00:00:00Z', ...o,
})

// A customer's real-money top-up still waiting for the bank transfer to be matched.
const pendingTopUp = (o = {}) => ({
  id: 'tu-9', tenantId: 't1', amount: 750000, currency: 'VND', reason: null,
  status: 'Pending', paymentRef: 'TITAN-7F3KQ9A2', source: null,
  confirmedBy: null, createdAt: '2026-10-16T08:00:00Z', confirmedAt: null, ...o,
})

// The page reads /v1/admin/topups twice: ?source=PromotionalCredit for the grant history, unfiltered for the
// top-ups waiting on an admin.
function stub(credits: unknown[] = [credit()], tenants: unknown[] = [tenant()], allTopUps: unknown[] = credits) {
  server.use(
    http.get('*/v1/admin/topups', ({ request }) => {
      const source = new URL(request.url).searchParams.get('source')
      if (source === 'PromotionalCredit') {
        return HttpResponse.json(credits)
      }
      return HttpResponse.json(allTopUps)
    }),
    http.get('*/v1/tenants', () => HttpResponse.json(tenants)),
  )
}

describe('AdminPromotionalCreditsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows empty history state when no credits granted', async () => {
    stub([])
    renderWithProviders(<AdminPromotionalCreditsPage />)
    await waitFor(() => expect(screen.getByText(/no promotional credits granted yet/i)).toBeInTheDocument())
  })

  it('shows a granted credit with tenant name, amount, reason and grantedBy', async () => {
    stub()
    renderWithProviders(<AdminPromotionalCreditsPage />)
    // 'alice' appears both in the tenant picker <option> and (once tenants load) the history row.
    await waitFor(() => expect(screen.getAllByText('alice').length).toBeGreaterThan(1))
    expect(screen.getByText('Launch promo')).toBeInTheDocument()
    expect(screen.getByText('admin-1')).toBeInTheDocument()
    expect(screen.getByText(/500[.,]000\s*₫/)).toBeInTheDocument()
  })

  it('grant button is disabled until a tenant and a positive amount are chosen', async () => {
    stub([])
    renderWithProviders(<AdminPromotionalCreditsPage />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'alice' })).toBeInTheDocument())

    const grantBtn = screen.getByRole('button', { name: /grant credit/i })
    expect(grantBtn).toBeDisabled()

    await userEvent.selectOptions(screen.getByLabelText(/tenant/i), 't1')
    await userEvent.type(screen.getByLabelText(/amount/i), '500000')
    expect(grantBtn).toBeEnabled()
  })

  it('POSTs the grant with tenantId, amount and reason', async () => {
    let body: unknown = null
    stub([])
    server.use(
      http.post('*/v1/admin/topups/grant', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(credit(), { status: 201 })
      }),
    )
    renderWithProviders(<AdminPromotionalCreditsPage />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'alice' })).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByLabelText(/tenant/i), 't1')
    await userEvent.type(screen.getByLabelText(/amount/i), '500000')
    await userEvent.type(screen.getByLabelText(/reason/i), 'welcome')
    await userEvent.click(screen.getByRole('button', { name: /grant credit/i }))

    await waitFor(() => expect(body).toEqual({ tenantId: 't1', amount: 500000, reason: 'welcome' }))
  })

  // titan-ops features/cloud-console/design.md#portal-language — 500.000 is five hundred thousand đồng, the way the page shows it.
  it('grants the amount typed with a grouping mark', async () => {
    let body: unknown = null
    stub([])
    server.use(
      http.post('*/v1/admin/topups/grant', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ topUpId: 'pc-2' }, { status: 201 })
      }),
    )
    renderWithProviders(<AdminPromotionalCreditsPage />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'alice' })).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByLabelText(/tenant/i), 't1')
    await userEvent.type(screen.getByLabelText(/amount/i), '500.000')
    await userEvent.click(screen.getByRole('button', { name: /grant credit/i }))

    await waitFor(() => expect(body).toEqual({ tenantId: 't1', amount: 500000, reason: null }))
  })

  // titan-ops features/billing/topup/design.md — the manual path for a transfer the webhook did not match.
  it('lists a pending top-up with its tenant, amount and reference', async () => {
    stub([credit()], [tenant()], [credit(), pendingTopUp()])
    renderWithProviders(<AdminPromotionalCreditsPage />)

    const pending = await screen.findByRole('region', { name: /top-ups waiting for confirmation/i })
    await waitFor(() => expect(within(pending).getByText('TITAN-7F3KQ9A2')).toBeInTheDocument())
    expect(within(pending).getByText(/750[.,]000\s*₫/)).toBeInTheDocument()
    expect(within(pending).getByText('alice')).toBeInTheDocument()
    // A grant is already confirmed: it is history, not something to confirm.
    expect(within(pending).queryByText(/500[.,]000\s*₫/)).not.toBeInTheDocument()
  })

  it('confirms a pending top-up with the bank reference the admin typed', async () => {
    let confirmed: { url: string; body: unknown } | null = null
    stub([], [tenant()], [pendingTopUp()])
    server.use(
      http.post('*/v1/admin/topups/:id/confirm', async ({ request }) => {
        confirmed = { url: new URL(request.url).pathname, body: await request.json() }
        return new HttpResponse(null, { status: 202 })
      }),
    )
    renderWithProviders(<AdminPromotionalCreditsPage />)

    await userEvent.click(await screen.findByRole('button', { name: /^confirm$/i }))
    await userEvent.type(screen.getByLabelText(/bank transaction reference/i), 'FT26289001')
    await userEvent.click(screen.getByRole('button', { name: /confirm top-up/i }))

    await waitFor(() => expect(confirmed).toEqual({
      url: '/v1/admin/topups/tu-9/confirm',
      body: { paymentTxnRef: 'FT26289001' },
    }))
  })

  it('offers nothing to confirm when no top-up is waiting', async () => {
    stub([credit()], [tenant()], [credit(), pendingTopUp({ status: 'Confirmed', confirmedAt: '2026-10-16T09:00:00Z' })])
    renderWithProviders(<AdminPromotionalCreditsPage />)

    const pending = await screen.findByRole('region', { name: /top-ups waiting for confirmation/i })
    await waitFor(() => expect(within(pending).getByText(/no top-up is waiting/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument()
  })

  it('renders in Vietnamese: heading, button, table header, money and date in Vietnamese format', async () => {
    stub([credit({ confirmedAt: '2026-09-10T12:00:00Z' })])
    renderWithProviders(<AdminPromotionalCreditsPage />, { lang: 'vi' })
    await waitFor(() => expect(screen.getByText('Launch promo')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Tiền khuyến mãi' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cấp tiền' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Người cấp' })).toBeInTheDocument()
    expect(screen.getByText('500.000 ₫')).toBeInTheDocument()
    expect(screen.getByText('10/09/2026')).toBeInTheDocument()
  })
})
