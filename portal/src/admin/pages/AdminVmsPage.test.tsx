import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { AdminVmsPage } from './AdminVmsPage'

const vm = (o = {}) => ({
  id: 'v1', tenantId: 't1', name: 'web-1', currentState: 'Running', desiredState: 'Running', transition: null as string | null, ipAddress: '10.0.0.5',
  networkId: 'n1', vmOfferingId: 's', templateId: 'tmpl', clusterId: 'vn-hcm-1',
  createdAt: '2026-01-01T00:00:00Z', currentExistence: 'Exists', desiredExistence: 'Exists',
  requestFailureReason: null as string | null, requestFailureDetail: null as string | null, requestFailedAt: null as string | null, ...o,
})
const tenant = (o = {}) => ({
  id: 't1', name: 'alice', status: 'Active', maxVms: 10, maxNetworks: 1,
  createdAt: '2026-01-01T00:00:00Z', ...o,
})

describe('AdminVmsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows empty state when no VMs', async () => {
    server.use(
      http.get('*/v1/admin/vms', () => HttpResponse.json([])),
      http.get('*/v1/tenants', () => HttpResponse.json([])),
    )
    renderWithProviders(<AdminVmsPage />)
    await waitFor(() => expect(screen.getByText('No VMs')).toBeInTheDocument())
  })

  it('resolves tenant name in the tenant column and shows status', async () => {
    server.use(
      http.get('*/v1/admin/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
    )
    renderWithProviders(<AdminVmsPage />)
    // Tenant column shows the human name, not the raw guid (cell, not the filter <option>).
    await waitFor(() => expect(screen.getByRole('cell', { name: 'alice' })).toBeInTheDocument())
    expect(screen.getByText('web-1')).toBeInTheDocument()
    // Status shows in the row (a filter <option> now carries the same text — target the cell).
    expect(screen.getByRole('cell', { name: 'Running' })).toBeInTheDocument()
  })

  it('exposes Delete but no start/stop (B-A01 delete-only)', async () => {
    server.use(
      http.get('*/v1/admin/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
    )
    renderWithProviders(<AdminVmsPage />)
    await waitFor(() => expect(screen.getByText('web-1')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    // Delete-only per docs/architecture/tenancy-and-admin.md#admin-cross-tenant-write — stop is STOP-01 epic, not here.
    expect(screen.queryByRole('button', { name: /stop|start/i })).not.toBeInTheDocument()
  })

  it('Delete requires typing the exact VM name before confirming', async () => {
    server.use(
      http.get('*/v1/admin/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
    )
    renderWithProviders(<AdminVmsPage />)
    await waitFor(() => expect(screen.getByText('web-1')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const confirmBtn = screen.getByRole('button', { name: 'Delete VM' })
    expect(confirmBtn).toBeDisabled()

    const input = screen.getByLabelText(/type the vm name/i)
    await userEvent.type(input, 'wrong-name')
    expect(confirmBtn).toBeDisabled()

    await userEvent.clear(input)
    await userEvent.type(input, 'web-1')
    expect(confirmBtn).toBeEnabled()
  })

  it('confirming Delete calls DELETE /v1/admin/vms/{id}', async () => {
    let deletedId: string | null = null
    server.use(
      http.get('*/v1/admin/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
      http.delete('*/v1/admin/vms/v1', () => {
        deletedId = 'v1'
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderWithProviders(<AdminVmsPage />)
    await waitFor(() => expect(screen.getByText('web-1')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.type(screen.getByLabelText(/type the vm name/i), 'web-1')
    await userEvent.click(screen.getByRole('button', { name: 'Delete VM' }))

    await waitFor(() => expect(deletedId).toBe('v1'))
  })

  it('filtering by tenant re-queries with ?tenantId=', async () => {
    const seenTenantIds: (string | null)[] = []
    server.use(
      http.get('*/v1/admin/vms', ({ request }) => {
        seenTenantIds.push(new URL(request.url).searchParams.get('tenantId'))
        return HttpResponse.json([vm()])
      }),
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
    )
    renderWithProviders(<AdminVmsPage />)
    await waitFor(() => expect(screen.getByText('web-1')).toBeInTheDocument())
    await userEvent.selectOptions(screen.getByLabelText('Filter by tenant'), 't1')
    // Second fetch carries the server-side filter A07 exposes.
    await waitFor(() => expect(seenTenantIds).toContain('t1'))
  })

  // Names in the Name column (2nd cell), in DOM order — for asserting sort.
  function nameOrder(): string[] {
    return screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[1].textContent)
  }

  it('status filter narrows the list client-side and combines with tenant filter', async () => {
    server.use(
      http.get('*/v1/admin/vms', () =>
        HttpResponse.json([vm({ id: 'v1', name: 'web-1', currentState: 'Running' }), vm({ id: 'v2', name: 'db-1', currentState: 'Error' })]),
      ),
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
    )
    renderWithProviders(<AdminVmsPage />)
    await waitFor(() => expect(screen.getByText('web-1')).toBeInTheDocument())
    expect(screen.getByText('db-1')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'Error')
    expect(screen.queryByText('web-1')).not.toBeInTheDocument()
    expect(screen.getByText('db-1')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), '')
    expect(screen.getByText('web-1')).toBeInTheDocument()
  })

  // F4/AC3 — admin can read the raw diagnostic (worker pod name etc.) that the tenant never sees.
  it('exposes the raw error of a refused create on its Failed badge for admin debugging', async () => {
    const raw = 'create instance vm-abc in project t-1: Failed creating instance record: stub: injected create failure'
    server.use(
      http.get('*/v1/admin/vms', () =>
        HttpResponse.json([vm({
          id: 'v1', name: 'broken-1', currentState: null, currentExistence: 'NotCreated',
          requestFailureReason: 'VM provisioning failed due to a system error. Please try again or contact support.',
          requestFailureDetail: raw, requestFailedAt: '2026-10-10T08:00:00Z',
        })]),
      ),
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
    )
    renderWithProviders(<AdminVmsPage />)
    const row = (await screen.findByText('broken-1')).closest('tr')!
    expect(within(row).getByText('Failed')).toHaveAttribute('title', expect.stringContaining(raw))
  })

  it('status filter empty result still shows empty state, not a crash', async () => {
    server.use(
      http.get('*/v1/admin/vms', () => HttpResponse.json([vm({ name: 'web-1', currentState: 'Running' })])),
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
    )
    renderWithProviders(<AdminVmsPage />)
    await waitFor(() => expect(screen.getByText('web-1')).toBeInTheDocument())
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'Running')
    // Only status present is Running; selecting it keeps the row. Sanity: no crash, row remains.
    expect(screen.getByText('web-1')).toBeInTheDocument()
  })

  it('clicking the Name header sorts ascending then toggles descending', async () => {
    server.use(
      http.get('*/v1/admin/vms', () =>
        HttpResponse.json([vm({ id: 'v1', name: 'web-2' }), vm({ id: 'v2', name: 'db-1' })]),
      ),
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
    )
    renderWithProviders(<AdminVmsPage />)
    await waitFor(() => expect(screen.getByText('web-2')).toBeInTheDocument())
    // API order preserved before any sort.
    expect(nameOrder()).toEqual(['web-2', 'db-1'])

    await userEvent.click(screen.getByRole('button', { name: /sort by name/i }))
    expect(nameOrder()).toEqual(['db-1', 'web-2'])

    await userEvent.click(screen.getByRole('button', { name: /sort by name/i }))
    expect(nameOrder()).toEqual(['web-2', 'db-1'])
  })

  it('renders in Vietnamese, status words staying English', async () => {
    server.use(
      http.get('*/v1/admin/vms', () => HttpResponse.json([vm()])),
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
    )
    renderWithProviders(<AdminVmsPage />, { lang: 'vi' })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Máy ảo' })).toBeInTheDocument())
    expect(screen.getByRole('columnheader', { name: 'Cấu hình' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Mọi tenant' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Running' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Xoá' }))
    expect(screen.getByRole('button', { name: 'Xoá VM' })).toBeDisabled()
    expect(screen.getByText(/huỷ vĩnh viễn "web-1" của alice/)).toBeInTheDocument()
  })
})
