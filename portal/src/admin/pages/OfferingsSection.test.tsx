import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { OfferingsSection } from './OfferingsSection'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

// Mirrors VmOfferingQueryResult / VolumeOfferingQueryResult after titan-ops architecture/money-and-wallet.md#price-belongs-to-offering — price included.
const vmTier = (o = {}) => ({
  id: 'm', name: 'Medium', cpu: 1, vcpu: 2, memoryMb: 4096, pricePerHour: 311.256, ...o,
})

const volumeTier = (o = {}) => ({
  id: 'standard', name: 'Standard', sizeGb: 0, isCustomized: true, pricePerGbPerHour: 1.57914, ...o,
})

function seed(vm = [vmTier()], volume = [volumeTier()]) {
  server.use(
    http.get('*/v1/vm-offerings', () => HttpResponse.json(vm)),
    http.get('*/v1/volume-offerings', () => HttpResponse.json(volume)),
  )
}

describe('OfferingsSection', () => {
  beforeEach(() => vi.clearAllMocks())

  // A6.1 — the product and its price on the same row. Asserting the rendered PRICE, not just the
  // heading: a section stubbed back to a title would still pass a heading-only test (BILL-01, and
  // the admin Dashboard stub of 2026-08-22).
  it('shows each VM tier with its price on the same row', async () => {
    seed()
    renderWithProviders(<OfferingsSection />)

    const row = await screen.findByTestId('vm-offering-m')
    expect(within(row).getByText('Medium')).toBeInTheDocument()
    expect(within(row).getByText('1 / 2')).toBeInTheDocument()
    expect(within(row).getByText('4096')).toBeInTheDocument()
    expect(within(row).getByText(/311\.256\s*₫/)).toBeInTheDocument()
  })

  // A storage rate is 1.57914 ₫/GB/h. formatMoney rounds VND to whole đồng, which would render this
  // as "2 ₫" and make every price change invisible — hence formatRate. Pinned because the wrong
  // helper here is a silent, plausible-looking bug.
  it('shows a sub-đồng storage rate without rounding it away', async () => {
    seed()
    renderWithProviders(<OfferingsSection />)

    const row = await screen.findByTestId('volume-offering-standard')
    expect(within(row).getByText(/1\.57914\s*₫/)).toBeInTheDocument()
    expect(within(row).getByText('Customer-sized')).toBeInTheDocument()
  })

  // A6.2 — after saving, the table shows the new price. The refetch returns the updated row, which
  // is what proves the list is driven by the server rather than by local state.
  it('shows the new price after saving, without a reload', async () => {
    let current = 311.256
    server.use(
      http.get('*/v1/vm-offerings', () => HttpResponse.json([vmTier({ pricePerHour: current })])),
      http.get('*/v1/volume-offerings', () => HttpResponse.json([volumeTier()])),
      http.patch('*/v1/admin/vm-offerings/m/price', async ({ request }) => {
        const body = (await request.json()) as { pricePerHour: number }
        current = body.pricePerHour
        return new HttpResponse(null, { status: 204 }) // titan-ops architecture/http-contract.md#commands-return-no-data: the list is re-read
      }),
    )
    renderWithProviders(<OfferingsSection />)

    await screen.findByTestId('vm-offering-m')
    await userEvent.click(screen.getByRole('button', { name: /edit price for medium/i }))
    const input = await screen.findByLabelText(/price \(₫ per hour\)/i)
    await userEvent.clear(input)
    await userEvent.type(input, '400000')
    await userEvent.click(screen.getByRole('button', { name: /save price/i }))

    await waitFor(() =>
      expect(screen.getByTestId('vm-offering-price-m')).toHaveTextContent(/400,000\s*₫/))
  })

  // The dialog opens on the tier the admin clicked, named by what the tier IS — not by its slug.
  // "m" is the billing key; "Medium (2 vCPU · 4096 MB)" is the thing being priced.
  it('names the tier being priced, not its slug', async () => {
    seed()
    renderWithProviders(<OfferingsSection />)

    await screen.findByTestId('vm-offering-m')
    await userEvent.click(screen.getByRole('button', { name: /edit price for medium/i }))

    expect(await screen.findByText(/Price — Medium \(2 vCPU · 4096 MB\)/)).toBeInTheDocument()
  })

  // Admins decide prices in monthly terms. Without this the screen asks them to multiply by 720.
  it('previews the monthly cost of the price being typed', async () => {
    seed()
    renderWithProviders(<OfferingsSection />)

    await screen.findByTestId('vm-offering-m')
    await userEvent.click(screen.getByRole('button', { name: /edit price for medium/i }))
    const input = await screen.findByLabelText(/price \(₫ per hour\)/i)
    await userEvent.clear(input)
    await userEvent.type(input, '1000')

    expect(screen.getByText(/720,000\s*₫\/month/)).toBeInTheDocument()
  })

  // A6.5 — a non-positive price cannot be submitted, and the reason is text, not just a red border.
  it.each(['0', '-5'])('refuses to submit price %s', async price => {
    seed()
    renderWithProviders(<OfferingsSection />)

    await screen.findByTestId('vm-offering-m')
    await userEvent.click(screen.getByRole('button', { name: /edit price for medium/i }))
    const input = await screen.findByLabelText(/price \(₫ per hour\)/i)
    await userEvent.clear(input)
    await userEvent.type(input, price)

    expect(screen.getByRole('button', { name: /save price/i })).toBeDisabled()
    expect(screen.getByText(/enter a price greater than 0/i)).toBeInTheDocument()
  })

  // Money path: a failed save must not look like a successful one. The dialog stays open, the error
  // is shown, and the number the admin typed is still there to retry with.
  it('keeps the dialog and the typed value when the save fails', async () => {
    seed()
    server.use(
      http.patch('*/v1/admin/vm-offerings/m/price', () =>
        HttpResponse.json({ status: 400, title: 'pricePerHour must be greater than 0', code: 'VALIDATION_ERROR' },
          { status: 400 })),
    )
    renderWithProviders(<OfferingsSection />)

    await screen.findByTestId('vm-offering-m')
    await userEvent.click(screen.getByRole('button', { name: /edit price for medium/i }))
    const input = await screen.findByLabelText(/price \(₫ per hour\)/i)
    await userEvent.clear(input)
    await userEvent.type(input, '400000')
    await userEvent.click(screen.getByRole('button', { name: /save price/i }))

    await waitFor(() =>
      expect(screen.getByText(/pricePerHour must be greater than 0/i)).toBeInTheDocument())
    expect(screen.getByLabelText(/price \(₫ per hour\)/i)).toHaveValue('400000')
  })

  it('shows an empty state when the catalog has no tiers', async () => {
    seed([], [])
    renderWithProviders(<OfferingsSection />)

    await waitFor(() => expect(screen.getByText('No VM tiers')).toBeInTheDocument())
    expect(screen.getByText('No storage tiers')).toBeInTheDocument()
  })

  it('renders in Vietnamese with Vietnamese number format', async () => {
    seed()
    renderWithProviders(<OfferingsSection />, { lang: 'vi' })

    const row = await screen.findByTestId('vm-offering-m')
    expect(screen.getByRole('heading', { name: 'Cấu hình' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Giá / giờ' })).toBeInTheDocument()
    expect(within(row).getByText(/311,256\s*₫/)).toBeInTheDocument()
    expect(screen.getByText('Khách tự chọn dung lượng')).toBeInTheDocument()

    await userEvent.click(within(row).getByRole('button', { name: 'Sửa giá của Medium' }))
    const input = await screen.findByLabelText('Giá (₫ mỗi giờ)')
    await userEvent.clear(input)
    await userEvent.type(input, '1000')
    expect(screen.getByText(/720\.000\s*₫\/tháng/)).toBeInTheDocument()
  })

  // titan-ops features/cloud-console/design.md#portal-language — a rate keeps decimals, and in Vietnamese the decimal mark is a
  // comma: the field starts the way the page shows the price and reads what the admin types the same way.
  it('reads a price typed with the Vietnamese decimal mark', async () => {
    let sent: unknown = null
    seed()
    server.use(http.patch('*/v1/admin/vm-offerings/m/price', async ({ request }) => {
      sent = await request.json()
      return new HttpResponse(null, { status: 204 })
    }))
    renderWithProviders(<OfferingsSection />, { lang: 'vi' })

    const row = await screen.findByTestId('vm-offering-m')
    await userEvent.click(within(row).getByRole('button', { name: 'Sửa giá của Medium' }))
    const input = await screen.findByLabelText('Giá (₫ mỗi giờ)')
    expect(input).toHaveValue('311,256')
    await userEvent.clear(input)
    await userEvent.type(input, '161,388')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu giá' }))

    await waitFor(() => expect(sent).toEqual({ pricePerHour: 161.388 }))
  })

  it('reads a price typed with English grouping', async () => {
    let sent: unknown = null
    seed()
    server.use(http.patch('*/v1/admin/vm-offerings/m/price', async ({ request }) => {
      sent = await request.json()
      return new HttpResponse(null, { status: 204 })
    }))
    renderWithProviders(<OfferingsSection />)

    await screen.findByTestId('vm-offering-m')
    await userEvent.click(screen.getByRole('button', { name: /edit price for medium/i }))
    const input = await screen.findByLabelText(/price \(₫ per hour\)/i)
    await userEvent.clear(input)
    await userEvent.type(input, '1,234.5')
    await userEvent.click(screen.getByRole('button', { name: /save price/i }))

    await waitFor(() => expect(sent).toEqual({ pricePerHour: 1234.5 }))
  })
})
