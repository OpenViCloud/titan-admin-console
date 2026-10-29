import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { AdminTenantsPage } from './AdminTenantsPage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const tenant = (o = {}) => ({
  id: 't1', name: 'alice', status: 'Active', maxVms: 10, maxNetworks: 1,
  // The seven other caps, each distinct, so a field showing or sending the wrong cap reads as the wrong number.
  maxVolumes: 13, maxVmSnapshotsPerVm: 14, maxVolumeSnapshotsPerVolume: 15, maxFirewallRulesPerNetwork: 16,
  maxPublicIpv6: 17, maxSshKeys: 18, maxLoadBalancers: 19,
  createdAt: '2026-01-01T00:00:00Z',
  // titan-ops architecture/money-and-wallet.md#postpaid-no-brake — null override = follows the system default (5.000.000 ₫ here).
  debtCeiling: 500000,
  ...o,
})

describe('AdminTenantsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows empty state when no tenants', async () => {
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([])))
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('No tenants')).toBeInTheDocument())
  })

  it('shows tenant row with name and status', async () => {
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([tenant()])))
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('suspend button PATCHes status to Suspended for an active tenant', async () => {
    let patched: unknown = null
    server.use(
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
      http.patch('*/v1/tenants/t1/status', async ({ request }) => {
        patched = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Suspend' }))
    await waitFor(() => expect(patched).toEqual({ status: 'Suspended' }))
  })

  it('shows Activate action + warning badge for a suspended tenant', async () => {
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([tenant({ status: 'Suspended' })])))
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('Suspended')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument()
  })

  // titan-ops architecture/tenancy-and-admin.md#approval-is-activation — a tenant has no provider account any more, so
  // there is no account column, badge or "Retry provisioning" to offer.
  it('shows no provider account and offers no retry', async () => {
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([tenant()])))
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())
    expect(screen.queryByRole('columnheader', { name: 'Account' })).not.toBeInTheDocument()
    expect(screen.queryByText('Present')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry provisioning' })).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Debt ceiling' })).toBeInTheDocument()
  })

  // B-A02 — quota editor
  // ── debt ceiling (2026-09-04) ──────────────────────────────────────────

  // One plain number per tenant. There is no "follows the default" state any more: every tenant row
  // carries its own ceiling, seeded at signup, so there is no default left for a change to move.
  it('shows each tenant debt ceiling with no default marker', async () => {
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([
      tenant({ id: 't1', name: 'alice', debtCeiling: 500000 }),
      tenant({ id: 't2', name: 'bob', debtCeiling: 12000000 }),
    ])))
    renderWithProviders(<AdminTenantsPage />)

    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())
    expect(screen.getByRole('columnheader', { name: 'Debt ceiling' })).toBeInTheDocument()
    expect(screen.getByText(/^500[.,]000\s*₫$/)).toBeInTheDocument()
    expect(screen.getByText(/^12[.,]000[.,]000\s*₫$/)).toBeInTheDocument()
    expect(screen.queryByText('default')).not.toBeInTheDocument()
  })

  // Seeded with the tenant's actual number, never blank: blank is not a value here, and a Save from a
  // blank field used to mean "follow the default", which no longer exists.
  it('Debt ceiling dialog opens seeded with the current number', async () => {
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([tenant({ debtCeiling: 500000 })])))
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Debt ceiling' }))

    expect(screen.getByLabelText(/ceiling \(vnd\)/i)).toHaveValue('500000')
  })

  // The dialog must not promise enforcement: the ceiling stopped gating anything on 2026-09-04, so
  // copy like "before new resources are blocked" would describe a mechanism that no longer exists.
  it('does not claim the ceiling blocks the tenant', async () => {
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([tenant()])))
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Debt ceiling' }))

    // Scoped to the dialog on purpose: the page itself has a Suspend button, and a document-wide
    // query would pass or fail for reasons that have nothing to do with this copy.
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.queryByText(/blocked|blocks them|suspend/i)).not.toBeInTheDocument()
    expect(dialog.getByText(/does not block them from creating resources/i)).toBeInTheDocument()
  })

  it('Save PATCHes /debt-ceiling with the entered number', async () => {
    let patched: unknown = null
    server.use(
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
      http.patch('*/v1/tenants/t1/debt-ceiling', async ({ request }) => {
        patched = await request.json()
        return new HttpResponse(null, { status: 204 }) // titan-ops architecture/http-contract.md#commands-return-no-data
      }),
    )
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Debt ceiling' }))
    await userEvent.clear(screen.getByLabelText(/ceiling \(vnd\)/i))
    // Typed the way the table shows it: 9.000.000 is nine million, not nine thousand.
    await userEvent.type(screen.getByLabelText(/ceiling \(vnd\)/i), '9.000.000')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(patched).toEqual({ debtCeiling: 9000000 }))
  })

  // Empty is no longer a legal value — it used to mean "follow the default". A UI that sent 0 for a
  // cleared field would mean the opposite of what the admin intended.
  it('Save is disabled for an empty or negative ceiling', async () => {
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([tenant()])))
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Debt ceiling' }))
    await userEvent.clear(screen.getByLabelText(/ceiling \(vnd\)/i))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/ceiling \(vnd\)/i), '-5')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('Edit quota opens a dialog seeded with the current caps', async () => {
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([tenant({ maxVms: 10, maxNetworks: 1 })])))
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Edit quota' }))

    expect(screen.getByLabelText('Max VMs')).toHaveValue('10')
    expect(screen.getByLabelText('Max Networks')).toHaveValue('1')
    expect(screen.getByLabelText('Max volumes')).toHaveValue('13')
    expect(screen.getByLabelText('Max snapshots per VM')).toHaveValue('14')
    expect(screen.getByLabelText('Max snapshots per volume')).toHaveValue('15')
    expect(screen.getByLabelText('Max firewall rules per network')).toHaveValue('16')
    expect(screen.getByLabelText('Max networks with public IPv6')).toHaveValue('17')
    expect(screen.getByLabelText('Max SSH keys')).toHaveValue('18')
    expect(screen.getByLabelText('Max load balancers')).toHaveValue('19')
  })

  it('Save PATCHes /quota with the edited caps', async () => {
    let patched: unknown = null
    server.use(
      http.get('*/v1/tenants', () => HttpResponse.json([tenant({ maxVms: 10, maxNetworks: 1 })])),
      http.patch('*/v1/tenants/t1/quota', async ({ request }) => {
        patched = await request.json()
        return new HttpResponse(null, { status: 204 }) // titan-ops architecture/http-contract.md#commands-return-no-data
      }),
    )
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Edit quota' }))
    const vms = screen.getByLabelText('Max VMs')
    const nets = screen.getByLabelText('Max Networks')
    await userEvent.clear(vms)
    await userEvent.type(vms, '25')
    await userEvent.clear(nets)
    await userEvent.type(nets, '5')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    // All nine go out, the untouched seven at the values the dialog was seeded with.
    await waitFor(() => expect(patched).toEqual({
      maxVms: 25, maxNetworks: 5, maxVolumes: 13, maxVmSnapshotsPerVm: 14, maxVolumeSnapshotsPerVolume: 15,
      maxFirewallRulesPerNetwork: 16, maxPublicIpv6: 17, maxSshKeys: 18, maxLoadBalancers: 19,
    }))
  })

  it('Save PATCHes a changed load balancer cap', async () => {
    let patched: { maxLoadBalancers?: number } | null = null
    server.use(
      http.get('*/v1/tenants', () => HttpResponse.json([tenant()])),
      http.patch('*/v1/tenants/t1/quota', async ({ request }) => {
        patched = await request.json() as { maxLoadBalancers?: number }
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Edit quota' }))
    const lbs = screen.getByLabelText('Max load balancers')
    await userEvent.clear(lbs)
    await userEvent.type(lbs, '0')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(patched?.maxLoadBalancers).toBe(0))
  })

  it('Save is disabled for a negative quota (well-formed request guard)', async () => {
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([tenant({ maxVms: 10, maxNetworks: 1 })])))
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Edit quota' }))
    const vms = screen.getByLabelText('Max VMs')
    await userEvent.clear(vms)
    await userEvent.type(vms, '-3')

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  // US-SL-01d — PendingApproval queue. AC11/AC14: a pending tenant gets Approve/Reject,
  // NOT the Suspend/Activate toggle (whose "Suspend" label on a pending row would silently reject).
  it('shows Approve + Reject and no Suspend/Activate for a pending tenant', async () => {
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([tenant({ status: 'PendingApproval' })])))
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument()
  })

  // Badge humanises the raw enum: "PendingApproval" reads as "Pending Approval".
  it('renders the humanised "Pending Approval" label, not the raw enum', async () => {
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([tenant({ status: 'PendingApproval' })])))
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())
    expect(screen.getByText('Pending Approval')).toBeInTheDocument()
    expect(screen.queryByText('PendingApproval')).not.toBeInTheDocument()
  })

  // AC12 — Approve → PATCH status=Active.
  it('Approve PATCHes status to Active for a pending tenant', async () => {
    let patched: unknown = null
    server.use(
      http.get('*/v1/tenants', () => HttpResponse.json([tenant({ status: 'PendingApproval' })])),
      http.patch('*/v1/tenants/t1/status', async ({ request }) => {
        patched = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(patched).toEqual({ status: 'Active' }))
  })

  // AC13 — Reject → PATCH status=Suspended.
  it('Reject PATCHes status to Suspended for a pending tenant', async () => {
    let patched: unknown = null
    server.use(
      http.get('*/v1/tenants', () => HttpResponse.json([tenant({ status: 'PendingApproval' })])),
      http.patch('*/v1/tenants/t1/status', async ({ request }) => {
        patched = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(patched).toEqual({ status: 'Suspended' }))
  })

  // AC14 regression — a non-pending tenant keeps the existing Suspend + Edit quota UI,
  // and shows no Approve/Reject.
  it('keeps Suspend + Edit quota (no Approve/Reject) for an active tenant', async () => {
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([tenant()])))
    renderWithProviders(<AdminTenantsPage />)
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit quota' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
  })

  it('renders in Vietnamese: heading, table headers, buttons and money in Vietnamese format', async () => {
    server.use(http.get('*/v1/tenants', () => HttpResponse.json([tenant()])))
    renderWithProviders(<AdminTenantsPage />, { lang: 'vi' })
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Tenant' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Hạn mức (VM / Mạng)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sửa hạn mức' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tạm ngưng' })).toBeInTheDocument()
    expect(screen.getByText('500.000 ₫')).toBeInTheDocument()
    // The status badge stays English in both languages.
    expect(screen.getByText('Active')).toBeInTheDocument()
  })
})
