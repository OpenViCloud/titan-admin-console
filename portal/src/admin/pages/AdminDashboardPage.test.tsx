import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { AdminDashboardPage } from './AdminDashboardPage'

// Current UTC month, computed the same way the page does, so the revenue KPI is deterministic
// regardless of when the suite runs.
const now = new Date()
const Y = now.getUTCFullYear()
const M = now.getUTCMonth() + 1
const OLDER = M === 1 ? { periodYear: Y - 1, periodMonth: 12 } : { periodYear: Y, periodMonth: M - 1 }

const tenant = (o = {}) => ({
  id: 't1', name: 'alice', status: 'Active', maxVms: 10, maxNetworks: 1,
  createdAt: '2026-01-01T00:00:00Z', ...o,
})
const vm = (o = {}) => ({
  id: 'v1', tenantId: 't1', name: 'web', currentState: 'Running', desiredState: 'Running', transition: null as string | null, ipAddress: null, networkId: 'n1',
  vmOfferingId: 'm', templateId: 'tpl', clusterId: 'z', createdAt: '2026-01-01T00:00:00Z',
  currentExistence: 'Exists', desiredExistence: 'Exists',
  requestFailureReason: null as string | null, requestFailureDetail: null as string | null, requestFailedAt: null as string | null, ...o,
})
const invoice = (o = {}) => ({
  id: 'i1', tenantId: 't1', periodYear: Y, periodMonth: M, status: 'New',
  issuedAt: '2026-01-01T00:00:00Z', dueAt: '2026-01-15T00:00:00Z', paidAt: null, paidBy: null,
  total: 10000, currency: 'VND', ...o,
})

function seed({ tenants = [], vms = [], invoices = [], promoCredits = [] }: {
  tenants?: unknown[]; vms?: unknown[]; invoices?: unknown[]; promoCredits?: unknown[]
} = {}) {
  server.use(
    http.get('*/v1/tenants', () => HttpResponse.json(tenants)),
    http.get('*/v1/admin/vms', () => HttpResponse.json(vms)),
    http.get('*/v1/admin/invoices', () => HttpResponse.json(invoices)),
    http.get('*/v1/admin/topups', () => HttpResponse.json(promoCredits)),
  )
}

describe('AdminDashboardPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the dashboard heading', () => {
    seed()
    renderWithProviders(<AdminDashboardPage />)
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeTruthy()
  })

  it('derives the four KPIs from the admin tenant/VM/invoice/promo-credit APIs', async () => {
    seed({
      tenants: [
        tenant(),
        tenant({ id: 't2', name: 'bob', status: 'Active' }),
        tenant({ id: 't3', name: 'cara', status: 'Suspended' }),
      ],
      vms: [vm(), vm({ id: 'v2', currentState: 'Ready' }), vm({ id: 'v3', currentState: 'Stopped', desiredState: 'Stopped' })],
      invoices: [
        invoice({ total: 100000 }),
        invoice({ id: 'i2', total: 42500 }),
        // An older period must be excluded from the revenue sum.
        invoice({ id: 'i3', ...OLDER, total: 999000 }),
      ],
      // US-PROMO-01 — the KPI counts promotional-credit GRANTS (no request queue any more).
      promoCredits: [
        { id: 'pc1', tenantId: 't1', amount: 500000, currency: 'VND', reason: null, status: 'Confirmed', paymentRef: 'PROMO-pc1', source: 'PromotionalCredit', confirmedBy: 'admin-1', createdAt: '2026-08-26T00:00:00Z', confirmedAt: '2026-08-26T00:00:00Z' },
        { id: 'pc2', tenantId: 't2', amount: 200000, currency: 'VND', reason: null, status: 'Confirmed', paymentRef: 'PROMO-pc2', source: 'PromotionalCredit', confirmedBy: 'admin-1', createdAt: '2026-08-26T00:00:00Z', confirmedAt: '2026-08-26T00:00:00Z' },
      ],
    })
    renderWithProviders(<AdminDashboardPage />)

    await waitFor(() => expect(screen.getByTestId('kpi-tenants')).toHaveTextContent('3'))
    // Running + Ready of 3 total: Ready is a running guest that also told Incus it is ready
    expect(screen.getByTestId('kpi-vms')).toHaveTextContent('2')
    // 100,000 + 42,500 ₫, the older-period invoice excluded, formatted like every other amount
    expect(screen.getByTestId('kpi-revenue')).toHaveTextContent('142,500 ₫')
    // 2 promo-credit grants
    expect(screen.getByTestId('kpi-pending')).toHaveTextContent('2')
  })

  // Invoices are issued on day 1 for the month that just closed, so the current month has none until it
  // closes. The card must show the latest period that has invoices, labelled with that period.
  it('sums the latest invoiced period and names it, not the current month', async () => {
    seed({
      invoices: [
        invoice({ id: 'a', periodYear: 2026, periodMonth: 9, total: 700000 }),
        invoice({ id: 'b', periodYear: 2026, periodMonth: 9, total: 42390 }),
        invoice({ id: 'c', periodYear: 2026, periodMonth: 8, total: 999000 }),
      ],
    })
    renderWithProviders(<AdminDashboardPage />)
    await waitFor(() => expect(screen.getByTestId('kpi-revenue')).toHaveTextContent('742,390 ₫'))
    expect(screen.getByText('Invoiced · Sep 2026')).toBeInTheDocument()
  })

  it('orders periods by year before month', async () => {
    seed({
      invoices: [
        invoice({ id: 'dec', periodYear: 2025, periodMonth: 12, total: 500000 }),
        invoice({ id: 'jan', periodYear: 2026, periodMonth: 1, total: 120000 }),
      ],
    })
    renderWithProviders(<AdminDashboardPage />)
    await waitFor(() => expect(screen.getByTestId('kpi-revenue')).toHaveTextContent('120,000 ₫'))
    expect(screen.getByText('Invoiced · Jan 2026')).toBeInTheDocument()
  })

  it('shows zeros (not a crash) when every admin list is empty', async () => {
    seed()
    renderWithProviders(<AdminDashboardPage />)
    await waitFor(() => expect(screen.getByTestId('kpi-tenants')).toHaveTextContent('0'))
    expect(screen.getByTestId('kpi-revenue')).toHaveTextContent('0 ₫')
    expect(screen.getByText('None granted yet')).toBeInTheDocument()
    expect(screen.getByText('No invoices yet')).toBeInTheDocument()
  })

  it('renders in Vietnamese: heading, KPI titles, the period and money in Vietnamese format', async () => {
    seed({
      invoices: [
        invoice({ id: 'a', periodYear: 2026, periodMonth: 9, total: 700000 }),
        invoice({ id: 'b', periodYear: 2026, periodMonth: 9, total: 42390 }),
      ],
    })
    renderWithProviders(<AdminDashboardPage />, { lang: 'vi' })
    await waitFor(() => expect(screen.getByTestId('kpi-revenue')).toHaveTextContent('742.390 ₫'))
    expect(screen.getByRole('heading', { name: 'Tổng quan' })).toBeInTheDocument()
    expect(screen.getByText('Đã phát hành hoá đơn · 09/2026')).toBeInTheDocument()
    expect(screen.getByText('2 hoá đơn')).toBeInTheDocument()
    expect(screen.getByText('Tổng số tenant')).toBeInTheDocument()
    expect(screen.getByText('Chưa cấp lần nào')).toBeInTheDocument()
  })
})
