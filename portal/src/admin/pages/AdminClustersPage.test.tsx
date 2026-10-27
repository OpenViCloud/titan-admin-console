import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { AdminClustersPage } from './AdminClustersPage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const PIN = 'ffcf7803b2371e90834c2dd2a454f48bcb9c541b16dd7dc54a93a104b1aa108f'
const TITAN_FINGERPRINT = '7c094b4f42e1d25d78b9d017eaa125827a8824d978e3cf8973916b36d6a379c2'
const TITAN_PEM = '-----BEGIN CERTIFICATE-----\nMIIBtitan\n-----END CERTIFICATE-----\n'

const cluster = (o = {}) => ({
  clusterId: 'singapore01', name: 'Singapore 01', endpoint: 'https://localhost:8443', serverFingerprint: PIN,
  providerSettings: { ovnUplinkNetwork: 'ovnup', storagePool: 'default', ipv6Block: '2001:41d0:d00:d400::/56' },
  ...o,
})

function serve(clusters: unknown[]) {
  server.use(
    http.get('*/v1/admin/clusters', () => HttpResponse.json(clusters)),
    http.get('*/v1/admin/clusters/client-certificate', () =>
      HttpResponse.json({ certificatePem: TITAN_PEM, fingerprint: TITAN_FINGERPRINT })),
  )
}

describe('AdminClustersPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it("shows Titan's client certificate to trust on the cluster, public half only", async () => {
    serve([cluster()])
    renderWithProviders(<AdminClustersPage />)

    const block = await screen.findByRole('region', { name: 'Titan client certificate' })
    await waitFor(() => expect(within(block).getByText(TITAN_FINGERPRINT)).toBeInTheDocument())
    expect(within(block).getByText(/MIIBtitan/)).toBeInTheDocument()
    expect(within(block).getByText(/incus config trust add-certificate/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/PRIVATE KEY/)
  })

  it('copies the certificate PEM', async () => {
    serve([cluster()])
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    renderWithProviders(<AdminClustersPage />)

    await user.click(await screen.findByRole('button', { name: 'Copy certificate' }))

    expect(writeText).toHaveBeenCalledWith(TITAN_PEM)
  })

  it('reports an unreadable certificate in its block and still lists the clusters', async () => {
    server.use(
      http.get('*/v1/admin/clusters', () => HttpResponse.json([cluster()])),
      http.get('*/v1/admin/clusters/client-certificate', () =>
        HttpResponse.json({ status: 503, title: 'x', code: 'CLUSTER_IDENTITY_UNREADABLE' }, { status: 503 })),
    )
    renderWithProviders(<AdminClustersPage />)

    const block = await screen.findByRole('region', { name: 'Titan client certificate' })
    await waitFor(() => expect(within(block).getByText(/CLUSTER_IDENTITY_UNREADABLE/)).toBeInTheDocument())
    expect(await screen.findByText('https://localhost:8443')).toBeInTheDocument()
  })

  it('shows each configured cluster with its connection and provider settings', async () => {
    serve([cluster(), cluster({ clusterId: 'local-mac', name: 'Local Mac', endpoint: 'https://192.168.104.1:8443',
      providerSettings: { ovnUplinkNetwork: 'ovnup', storagePool: 'default', ipv6Block: null } })])
    renderWithProviders(<AdminClustersPage />)

    const sg = await screen.findByRole('region', { name: 'Cluster singapore01' })
    expect(within(sg).getByText('Singapore 01')).toBeInTheDocument()
    expect(within(sg).getByText('https://localhost:8443')).toBeInTheDocument()
    expect(within(sg).getByText(PIN)).toBeInTheDocument()
    expect(within(sg).getByText('ovnup')).toBeInTheDocument()
    expect(within(sg).getByText('2001:41d0:d00:d400::/56')).toBeInTheDocument()
    const local = screen.getByRole('region', { name: 'Cluster local-mac' })
    expect(within(local).getByText('https://192.168.104.1:8443')).toBeInTheDocument()
    expect(within(local).getByText('Not set')).toBeInTheDocument()
  })

  // Clusters are the control plane's configuration: nothing on the page writes one.
  it('offers no field to edit and no Save or Delete', async () => {
    serve([cluster()])
    renderWithProviders(<AdminClustersPage />)
    await screen.findByRole('region', { name: 'Cluster singapore01' })

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.getByText(/configuration of the control plane/)).toBeInTheDocument()
  })

  it('says so when no cluster is configured', async () => {
    serve([])
    renderWithProviders(<AdminClustersPage />)

    expect(await screen.findByText('No cluster is configured.')).toBeInTheDocument()
  })

  it('tests the connection with the configured endpoint and fingerprint', async () => {
    let body: Record<string, unknown> | null = null
    serve([cluster()])
    server.use(http.post('*/v1/admin/clusters/test', async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>
      return HttpResponse.json({ ok: true, latencyMs: 24 })
    }))
    const user = userEvent.setup()
    renderWithProviders(<AdminClustersPage />)

    await user.click(await screen.findByRole('button', { name: 'Test connection' }))

    await waitFor(() => expect(screen.getByText(/Connected · 24ms/)).toBeInTheDocument())
    expect(body).toEqual({ endpoint: 'https://localhost:8443', serverFingerprint: PIN })
  })

  it('shows the whole error when the cluster does not trust Titan', async () => {
    const error = `The cluster at https://localhost:8443 does not trust Titan: add Titan's client certificate (fingerprint ${TITAN_FINGERPRINT}) to its trust store.`
    serve([cluster()])
    server.use(http.post('*/v1/admin/clusters/test', () => HttpResponse.json({ ok: false, error })))
    const user = userEvent.setup()
    renderWithProviders(<AdminClustersPage />)

    await user.click(await screen.findByRole('button', { name: 'Test connection' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(`Failed: ${error}`)
  })

  it('renders in Vietnamese', async () => {
    serve([cluster({ providerSettings: { ovnUplinkNetwork: null, storagePool: null, ipv6Block: null } })])
    renderWithProviders(<AdminClustersPage />, { lang: 'vi' })

    expect(screen.getByRole('heading', { level: 1, name: 'Cluster' })).toBeInTheDocument()
    const block = await screen.findByRole('region', { name: 'Chứng chỉ client của Titan' })
    expect(await within(block).findByRole('button', { name: 'Sao chép chứng chỉ' })).toBeInTheDocument()
    const sg = await screen.findByRole('region', { name: 'Cluster singapore01' })
    expect(within(sg).getByText('Fingerprint máy chủ')).toBeInTheDocument()
    expect(within(sg).getAllByText('Chưa đặt').length).toBe(3)
    expect(within(sg).getByRole('button', { name: 'Kiểm tra kết nối' })).toBeInTheDocument()
  })
})
