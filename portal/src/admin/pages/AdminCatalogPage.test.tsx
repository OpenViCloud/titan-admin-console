import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { AdminCatalogPage } from './AdminCatalogPage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

// Mirrors AdminTemplateQueryResult (control-plane) — GET /v1/admin/templates returns every template with its
// existence per cluster (docs/features/catalog/design.md#template-state-is-existence).
const clusterState = (o = {}) => ({
  clusterId: 'mock', currentExistence: 'Exists', desiredExistence: 'Exists', transition: null,
  requestFailureReason: null, requestFailureDetail: null, requestFailedAt: null, externalTemplateId: 'tpl-205',
  ...o,
})
const template = (o = {}, clusters = [clusterState()]) => ({
  id: 'tpl1', name: 'ubuntu-22', description: null, os: 'Ubuntu 22.04',
  vmOfferingId: 'm', diskGb: 20,
  clusters,
  ...o,
})

// The tier catalog the page resolves vmOfferingId against. Sizes chosen far apart so an assertion
// on one of them cannot be satisfied by accidentally reading the other.
const tiers = [
  { id: 'm', name: 'Medium', cpu: 1, vcpu: 2, memoryMb: 4096, pricePerHour: 311.256 },
  { id: 'l', name: 'Large', cpu: 2, vcpu: 4, memoryMb: 8192, pricePerHour: 634.05 },
]

describe('AdminCatalogPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows empty state when no templates', async () => {
    server.use(http.get('*/v1/admin/templates', () => HttpResponse.json([])))
    renderWithProviders(<AdminCatalogPage />)
    await waitFor(() => expect(screen.getByText('No templates')).toBeInTheDocument())
  })

  it('renders a template row with an Available status badge', async () => {
    server.use(http.get('*/v1/admin/templates', () => HttpResponse.json([template()])))
    renderWithProviders(<AdminCatalogPage />)
    await waitFor(() => expect(screen.getByText('ubuntu-22')).toBeInTheDocument())
    expect(screen.getByText('Ubuntu 22.04')).toBeInTheDocument()
    expect(screen.getByText('mock · Available')).toBeInTheDocument()
  })

  // One template, two clusters: each cluster's state on its own badge.
  it('shows each cluster’s sync state on its own badge', async () => {
    server.use(http.get('*/v1/admin/templates', () => HttpResponse.json([
      template({}, [clusterState({ clusterId: 'singapore01', currentExistence: 'NotCreated', transition: 'Syncing', externalTemplateId: null }), clusterState()]),
    ])))
    renderWithProviders(<AdminCatalogPage />)
    await waitFor(() => expect(screen.getByText('singapore01 · Syncing')).toBeInTheDocument())
    expect(screen.getByText('mock · Available')).toBeInTheDocument()
  })

  it('shows a dash for a template no sync has asked into any cluster yet', async () => {
    server.use(http.get('*/v1/admin/templates', () => HttpResponse.json([template({}, [])])))
    renderWithProviders(<AdminCatalogPage />)
    await waitFor(() => expect(screen.getByText('ubuntu-22')).toBeInTheDocument())
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  // The poll reads the cluster rows: a sync waiting in one cluster keeps the list refreshing until it lands.
  it('keeps re-reading while a sync waits in one cluster, until it lands', async () => {
    let reads = 0
    server.use(http.get('*/v1/admin/templates', () => {
      reads++
      if (reads === 1) {
        return HttpResponse.json([template({}, [clusterState({ clusterId: 'singapore01', currentExistence: 'NotCreated', transition: 'Syncing', externalTemplateId: null }), clusterState()])])
      }
      return HttpResponse.json([template({}, [clusterState({ clusterId: 'singapore01', externalTemplateId: 'tpl-3' }), clusterState()])])
    }))
    renderWithProviders(<AdminCatalogPage />)
    await waitFor(() => expect(screen.getByText('singapore01 · Syncing')).toBeInTheDocument())

    await waitFor(() => expect(screen.getByText('singapore01 · Available')).toBeInTheDocument(), { timeout: 6000 })
  }, 10000)

  // docs/features/catalog/design.md#template-borrows-sizing — the Size cell shows the TIER the template points at, spelled out. The raw id "m"
  // means nothing to an operator; "Medium — 2 vCPU · 4 GB" is the thing they can act on. Two
  // templates on two tiers, so a page that rendered one shared size contradicts one of the rows.
  it('renders each template size as the tier it points at, spelled out', async () => {
    server.use(
      http.get('*/v1/vm-offerings', () => HttpResponse.json(tiers)),
      http.get('*/v1/admin/templates', () => HttpResponse.json([
        template(),
        template({ id: 'tpl2', name: 'rocky-9', vmOfferingId: 'l' }),
      ])),
    )
    renderWithProviders(<AdminCatalogPage />)

    await waitFor(() => expect(screen.getByText('Medium — 2 vCPU · 4 GB')).toBeInTheDocument())
    expect(screen.getByText('Large — 4 vCPU · 8 GB')).toBeInTheDocument()
  })

  // A tier that is gone must not render as a blank cell: the id is ugly but it is evidence.
  it('falls back to the raw tier id when the offering is not in the catalog', async () => {
    server.use(
      http.get('*/v1/vm-offerings', () => HttpResponse.json(tiers)),
      http.get('*/v1/admin/templates', () =>
        HttpResponse.json([template({ vmOfferingId: 'tier-that-was-deleted' })])),
    )
    renderWithProviders(<AdminCatalogPage />)

    await waitFor(() => expect(screen.getByText('tier-that-was-deleted')).toBeInTheDocument())
  })

  it('marks a cluster never synced distinctly from one that has the alias', async () => {
    server.use(http.get('*/v1/admin/templates', () =>
      HttpResponse.json([template({ id: 'p1', name: 'debian-pending' }, [clusterState({ currentExistence: 'NotCreated', externalTemplateId: null })])]),
    ))
    renderWithProviders(<AdminCatalogPage />)
    await waitFor(() => expect(screen.getByText('debian-pending')).toBeInTheDocument())
    expect(screen.getByText('mock · Not synced')).toBeInTheDocument()
  })

  it('shows a failed sync with its reason and raw error so the admin can diagnose', async () => {
    server.use(http.get('*/v1/admin/templates', () =>
      HttpResponse.json([template({ id: 'f1', name: 'broken' }, [clusterState({
        currentExistence: 'NotCreated', externalTemplateId: null,
        requestFailureReason: 'The cluster has no cluster.', requestFailureDetail: 'cluster not found', requestFailedAt: '2026-10-11T09:00:00Z',
      })])]),
    ))
    renderWithProviders(<AdminCatalogPage />)
    await waitFor(() => expect(screen.getByText('broken')).toBeInTheDocument())
    const badge = screen.getByText('mock · Failed')
    expect(badge).toHaveAttribute('title', 'The cluster has no cluster.\ncluster not found')
  })

  // The reconciler saw the alias gone: the template is hidden from customers in that cluster.
  it('shows an alias seen gone as Not found', async () => {
    server.use(http.get('*/v1/admin/templates', () =>
      HttpResponse.json([template({ id: 'n1', name: 'alma-9' }, [clusterState({ currentExistence: 'NotFound' })])]),
    ))
    renderWithProviders(<AdminCatalogPage />)
    await waitFor(() => expect(screen.getByText('alma-9')).toBeInTheDocument())
    expect(screen.getByText('mock · Not found')).toBeInTheDocument()
    expect(screen.getByText('mock · Not found')).not.toHaveAttribute('title')
  })

  // The server says a sync is waiting; the page shows that instead of what the cluster holds.
  it('shows Syncing while a sync request waits for the worker', async () => {
    server.use(http.get('*/v1/admin/templates', () =>
      HttpResponse.json([template({ id: 's1', name: 'rocky-9' }, [clusterState({ currentExistence: 'NotFound', transition: 'Syncing' })])]),
    ))
    renderWithProviders(<AdminCatalogPage />)
    await waitFor(() => expect(screen.getByText('rocky-9')).toBeInTheDocument())
    expect(screen.getByText('mock · Syncing')).toBeInTheDocument()
    expect(screen.queryByText('mock · Not found')).not.toBeInTheDocument()
  })

  // CQRS-5 D-5 — the sync answers 202 with no body, so the page has no counts to show. It confirms the
  // trigger and reads the outcome back from the template list: Not synced before, Available after.
  it('sync button POSTs, confirms the trigger, and re-reads the list for the outcome', async () => {
    const { toast } = await import('sonner')
    let synced = false
    server.use(
      http.get('*/v1/admin/templates', () =>
        HttpResponse.json([template({}, [clusterState(synced ? {} : { currentExistence: 'NotCreated', externalTemplateId: null })])])),
      http.post('*/v1/admin/templates/sync', () => {
        synced = true
        return new HttpResponse(null, { status: 202 })
      }),
    )
    renderWithProviders(<AdminCatalogPage />)
    await waitFor(() => expect(screen.getByText('mock · Not synced')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Sync templates' }))

    await waitFor(() => expect(screen.getByText('mock · Available')).toBeInTheDocument())
    expect(toast.success).toHaveBeenCalledWith('Sync triggered')
    expect(screen.getByTestId('sync-result')).toHaveTextContent('Sync triggered')
    expect(screen.getByTestId('sync-result')).not.toHaveTextContent(/undefined|NaN/)
  })

  it('shows error code when sync fails', async () => {
    const { toast } = await import('sonner')
    server.use(
      http.get('*/v1/admin/templates', () => HttpResponse.json([])),
      http.post('*/v1/admin/templates/sync', () =>
        HttpResponse.json({ status: 500, title: 'x', code: 'INTERNAL_ERROR' }, { status: 500 }),
      ),
    )
    renderWithProviders(<AdminCatalogPage />)
    await waitFor(() => expect(screen.getByText('No templates')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Sync templates' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('INTERNAL_ERROR'))
  })

  it('renders in Vietnamese', async () => {
    server.use(
      http.get('*/v1/admin/templates', () => HttpResponse.json([template()])),
      http.get('*/v1/vm-offerings', () => HttpResponse.json(tiers)),
    )
    renderWithProviders(<AdminCatalogPage />, { lang: 'vi' })
    await waitFor(() => expect(screen.getByText('ubuntu-22')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Danh mục' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Đồng bộ template' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Hệ điều hành' })).toBeInTheDocument()
    expect(screen.getByText('mock · Available')).toBeInTheDocument()
  })
})
