import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { AdminLayout } from './layout/AdminLayout'
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { AdminTenantsPage } from './pages/AdminTenantsPage'
import { AdminPromotionalCreditsPage } from './pages/AdminPromotionalCreditsPage'
import { AdminInvoicesPage } from './pages/AdminInvoicesPage'
import { AdminCatalogPage } from './pages/AdminCatalogPage'
import { AdminVmsPage } from './pages/AdminVmsPage'
import { AdminNetworksPage } from './pages/AdminNetworksPage'
import { AdminClustersPage } from './pages/AdminClustersPage'
import { AdminBackupsPage } from './pages/AdminBackupsPage'
import { AdminAuditLogPage } from './pages/AdminAuditLogPage'

export { RouterProvider }

export function createAdminRouter() {
  return createBrowserRouter([
    {
      path: '/',
      element: <AdminLayout />,
      children: [
        { index: true, element: <AdminDashboardPage /> },
        { path: 'tenants', element: <AdminTenantsPage /> },
        { path: 'promotional-credits', element: <AdminPromotionalCreditsPage /> },
        { path: 'invoices', element: <AdminInvoicesPage /> },
        { path: 'catalog', element: <AdminCatalogPage /> },
        { path: 'clusters', element: <AdminClustersPage /> },
        { path: 'backups', element: <AdminBackupsPage /> },
        { path: 'vms', element: <AdminVmsPage /> },
        { path: 'networks', element: <AdminNetworksPage /> },
        { path: 'audit-log', element: <AdminAuditLogPage /> },
      ],
    },
  ])
}
