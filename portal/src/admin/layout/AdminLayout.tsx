import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { LayoutDashboard, Building2, Gift, Receipt, Package, Server, Network, Boxes, DatabaseBackup, ScrollText, LogOut } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { AppShell, type Crumb, type NavGroup } from '@/components/shell/AppShell'
import { useT } from '@/i18n/LanguageContext'
import type { Messages } from '@/i18n/en'

function navGroups(t: Messages): NavGroup[] {
  return [
    { items: [{ to: '/', label: t.adminNav.dashboard, icon: LayoutDashboard, end: true }] },
    {
      title: t.adminNav.customers,
      items: [
        { to: '/tenants', label: t.adminNav.tenants, icon: Building2 },
        { to: '/promotional-credits', label: t.adminNav.promotionalCredit, icon: Gift },
      ],
    },
    {
      title: t.adminNav.resources,
      items: [
        { to: '/vms', label: t.adminNav.vms, icon: Server },
        { to: '/networks', label: t.adminNav.networks, icon: Network },
      ],
    },
    { title: t.adminNav.money, items: [{ to: '/invoices', label: t.adminNav.invoices, icon: Receipt }] },
    {
      title: t.adminNav.platform,
      items: [
        { to: '/catalog', label: t.adminNav.catalog, icon: Package },
        { to: '/clusters', label: t.adminNav.clusters, icon: Boxes },
        { to: '/backups', label: t.adminNav.backups, icon: DatabaseBackup },
        { to: '/audit-log', label: t.adminNav.auditLog, icon: ScrollText },
      ],
    },
  ]
}

function crumbsFor(pathname: string, t: Messages): Crumb[] {
  for (const group of navGroups(t)) {
    for (const item of group.items) {
      if (item.to !== '/' && pathname.startsWith(item.to)) {
        return [{ label: t.adminNav.dashboard, to: '/' }, { label: item.label }]
      }
    }
  }
  return []
}

export function AdminLayout() {
  const auth = useAuth()
  const location = useLocation()
  const t = useT()

  const accountItems = (
    <DropdownMenuItem destructive data-testid="admin-logout" onSelect={() => auth.signoutRedirect()}>
      <LogOut className="h-3.5 w-3.5" />
      {t.shell.logOut}
    </DropdownMenuItem>
  )

  return (
    <AppShell
      brand="OpenViCloud"
      brandSuffix="Admin"
      groups={navGroups(t)}
      crumbs={crumbsFor(location.pathname, t)}
      accountLabel={t.adminNav.platformAdmin}
      accountItems={accountItems}
    >
      <Outlet />
    </AppShell>
  )
}
