import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const signoutRedirect = vi.fn()
vi.mock('react-oidc-context', () => ({
  useAuth: vi.fn(() => ({ signoutRedirect })),
}))

import { getConfig, setConfig, type AppConfig } from '@/lib/config'
import { FixedLanguage } from '@/test/FixedLanguage'
import { AdminLayout } from './AdminLayout'

function renderAt(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><AdminLayout /></MemoryRouter>)
}

describe('AdminLayout', () => {
  let baseConfig: AppConfig
  beforeAll(() => {
    baseConfig = getConfig()
  })
  afterEach(() => setConfig(baseConfig))

  it('renders the OpenViCloud Admin brand', () => {
    renderAt()
    expect(screen.getAllByText('OpenViCloud').length).toBeGreaterThan(0)
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.queryByText(/titan admin/i)).not.toBeInTheDocument()
  })

  it('groups every admin page under its section', () => {
    renderAt()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('heading', { level: 2 }).map(h => h.textContent))
      .toEqual(['Customers', 'Resources', 'Money', 'Platform'])
    expect(within(nav).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual([
      '/', '/tenants', '/promotional-credits', '/vms', '/networks', '/invoices', '/catalog', '/clusters', '/backups', '/audit-log',
    ])
  })

  it('links to the metrics tool in a new tab when the environment has one', () => {
    setConfig({ ...baseConfig, metricsUrl: 'https://metrics.example.test/vmui/' })
    renderAt()
    const link = screen.getByRole('link', { name: /Metrics/ })
    expect(link).toHaveAttribute('href', 'https://metrics.example.test/vmui/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).queryByRole('link', { name: /Metrics/ })).not.toBeInTheDocument()
  })

  it('shows no metrics link when the environment has no metrics tool', () => {
    renderAt()
    expect(screen.queryByRole('link', { name: /Metrics/ })).not.toBeInTheDocument()
  })

  it('names the metrics link in Vietnamese', () => {
    setConfig({ ...baseConfig, metricsUrl: 'https://metrics.example.test/vmui/' })
    render(
      <FixedLanguage lang="vi">
        <MemoryRouter><AdminLayout /></MemoryRouter>
      </FixedLanguage>,
    )
    expect(screen.getByRole('link', { name: /Số liệu vận hành/ })).toHaveAttribute('href', 'https://metrics.example.test/vmui/')
  })

  it('marks the current page and shows crumbs back to Dashboard', () => {
    renderAt('/clusters')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const current = within(nav).getAllByRole('link').filter(a => a.getAttribute('aria-current') === 'page')
    expect(current.map(a => a.textContent)).toEqual(['Clusters'])
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/')
  })

  it('logout in the account menu calls signoutRedirect', async () => {
    renderAt()
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }))
    await userEvent.click(await screen.findByTestId('admin-logout'))
    expect(signoutRedirect).toHaveBeenCalled()
  })

  it('renders the navigation in Vietnamese, keeping the Admin brand suffix', async () => {
    render(
      <FixedLanguage lang="vi">
        <MemoryRouter initialEntries={['/clusters']}><AdminLayout /></MemoryRouter>
      </FixedLanguage>,
    )
    expect(screen.getByText('Admin')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' })
    expect(within(nav).getAllByRole('heading', { level: 2 }).map(h => h.textContent))
      .toEqual(['Khách hàng', 'Tài nguyên', 'Tiền', 'Nền tảng'])
    expect(within(nav).getByRole('link', { name: 'Nhật ký quản trị' })).toHaveAttribute('href', '/audit-log')
    const crumbs = screen.getByRole('navigation', { name: 'Đường dẫn' })
    expect(within(crumbs).getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('button', { name: /Quản trị nền tảng/ })).toBeInTheDocument()
  })
})
