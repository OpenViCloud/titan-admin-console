import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { AdminNetworksPage } from './AdminNetworksPage'

const net = (o = {}) => ({
  id: 'n1', tenantId: 't1', name: 'prod-net', clusterId: 'vn-hcm-1', cidr: '10.0.0.0/24',
  currentState: 'Created' as string | null, currentExistence: 'Exists', desiredExistence: 'Exists', transition: null as string | null,
  requestFailureReason: null as string | null, requestFailureDetail: null as string | null, requestFailedAt: null as string | null,
  createdAt: '2026-01-01T00:00:00Z', ...o,
})
const tenant = (o = {}) => ({
  id: 't1', name: 'alice', status: 'Active', maxVms: 10, maxNetworks: 1,
  createdAt: '2026-01-01T00:00:00Z', ...o,
})

describe('AdminNetworksPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows empty state when no networks', async () => {
    server.use(
      http.get('*/v1/admin/networks', () => HttpResponse.json([])),
      http.get('*/v1/tenants', () => HttpResponse.json([])),
    )
    renderWithProviders(<AdminNetworksPage />)
    await waitFor(() => expect(screen.getByText('No networks')).toBeInTheDocument())
  })

  it('resolves tenant name and shows CIDR + status', async () => {
    server.use(
      http.get('*/v1/admin/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
    )
    renderWithProviders(<AdminNetworksPage />)
    await waitFor(() => expect(screen.getByRole('cell', { name: 'alice' })).toBeInTheDocument())
    expect(screen.getByText('prod-net')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.0/24')).toBeInTheDocument()
    // Status shows in the row (a filter <option> now carries the same text — target the cell).
    expect(screen.getByRole('cell', { name: 'Created' })).toBeInTheDocument()
  })

  // A give-up's raw error is admin-only (docs/architecture/desired-and-current.md#request-failure): the badge
  // says why, its title carries the detail.
  it('shows a failed create as Failed, with the reason and the raw detail on the badge', async () => {
    server.use(
      http.get('*/v1/admin/networks', () => HttpResponse.json([net({
        currentState: null, currentExistence: 'NotCreated',
        requestFailureReason: 'Network creation failed due to a system error. Please try again or contact support.',
        requestFailureDetail: 'create network: project t-1 not found',
      })])),
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
    )
    renderWithProviders(<AdminNetworksPage />)
    const badge = await screen.findByRole('cell', { name: 'Failed' })
    expect(within(badge).getByText('Failed').getAttribute('title')).toContain('create network: project t-1 not found')
  })

  it('is read-only: no create/delete/edit controls (sort header is a view control, allowed)', async () => {
    server.use(
      http.get('*/v1/admin/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
    )
    renderWithProviders(<AdminNetworksPage />)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    // No mutating control on the read-only cross-tenant view.
    expect(screen.queryByRole('button', { name: /delete|create|edit|remove/i })).not.toBeInTheDocument()
  })

  function nameOrder(): string[] {
    return screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[1].textContent)
  }

  it('status filter narrows the list client-side', async () => {
    server.use(
      http.get('*/v1/admin/networks', () =>
        HttpResponse.json([net({ id: 'n1', name: 'prod-net', currentState: 'Created' }), net({ id: 'n2', name: 'broken-net', currentState: 'Errored' })]),
      ),
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
    )
    renderWithProviders(<AdminNetworksPage />)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    expect(screen.getByText('broken-net')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'Errored')
    expect(screen.queryByText('prod-net')).not.toBeInTheDocument()
    expect(screen.getByText('broken-net')).toBeInTheDocument()
  })

  it('clicking the Name header sorts ascending then toggles descending', async () => {
    server.use(
      http.get('*/v1/admin/networks', () =>
        HttpResponse.json([net({ id: 'n1', name: 'prod-net' }), net({ id: 'n2', name: 'broken-net' })]),
      ),
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
    )
    renderWithProviders(<AdminNetworksPage />)
    await waitFor(() => expect(screen.getByText('prod-net')).toBeInTheDocument())
    expect(nameOrder()).toEqual(['prod-net', 'broken-net'])

    await userEvent.click(screen.getByRole('button', { name: /sort by name/i }))
    expect(nameOrder()).toEqual(['broken-net', 'prod-net'])

    await userEvent.click(screen.getByRole('button', { name: /sort by name/i }))
    expect(nameOrder()).toEqual(['prod-net', 'broken-net'])
  })

  it('renders in Vietnamese, status words staying English', async () => {
    server.use(
      http.get('*/v1/admin/networks', () => HttpResponse.json([net()])),
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
    )
    renderWithProviders(<AdminNetworksPage />, { lang: 'vi' })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Mạng' })).toBeInTheDocument())
    expect(screen.getByRole('columnheader', { name: 'Trạng thái' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sắp xếp theo tên' })).toHaveTextContent('Tên')
    expect(screen.getByLabelText('Lọc theo trạng thái')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Created' })).toBeInTheDocument()
  })
})
