import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAdminVms, useDeleteAdminVm, type AdminVm } from '../hooks/useAdminResources'
import { useAdminTenants } from '../hooks/useAdminTenants'
import { distinctStatuses, filterAndSort, nextSortDir, type SortDir } from './resourceFilters'
import { vmLabel } from '@/lib/vmState'
import { StatusFilter, SortByName } from './resourceFilterControls'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useT } from '@/i18n/LanguageContext'

// US-A08 — cross-tenant VM view. B-A01 (titan-ops architecture/tenancy-and-admin.md#admin-cross-tenant-write): platform-admin may DELETE any tenant's VM
// (delete-only, no start/stop — STOP-01). Tenant column leads because "whose VM is this" is the point.
// Keys are what vmLabel() returns: an Incus status, a waiting request's move, or why Incus has no status.
function statusVariant(s: string): 'success' | 'warning' | 'destructive' | 'outline' {
  if (s === 'Running' || s === 'Ready') return 'success'
  if (s === 'Error' || s === 'Not found' || s === 'Failed') return 'destructive'
  if (s === 'Stopped' || s === 'Frozen' || s === 'Stopping' || s === 'Deleting') return 'warning'
  return 'outline'
}

export function AdminVmsPage() {
  const t = useT()
  const [tenantId, setTenantId] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState('')
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const { data: vms, isLoading, isError } = useAdminVms(tenantId)
  const { data: tenants } = useAdminTenants()
  const [deleting, setDeleting] = useState<AdminVm | null>(null)

  const tenantName = useMemo(() => {
    const m = new Map<string, string>()
    tenants?.forEach(tenant => m.set(tenant.id, tenant.name))
    return m
  }, [tenants])

  const statuses = useMemo(() => distinctStatuses(vms, vmLabel), [vms])
  const rows = useMemo(() => filterAndSort(vms ?? [], status, sortDir, vmLabel), [vms, status, sortDir])

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">{t.common.loading}</div>
  if (isError) return <div className="p-6 text-muted-foreground text-sm">{t.adminVms.loadFailed}</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">{t.adminVms.title}</h1>
        <div className="flex items-center gap-2">
          <StatusFilter statuses={statuses} value={status} onChange={setStatus} />
          <select
            aria-label={t.adminFilters.filterByTenant}
            value={tenantId ?? ''}
            onChange={e => setTenantId(e.target.value || undefined)}
            className="bg-muted border border-border rounded-md px-2 py-1 text-[13px] text-foreground"
          >
            <option value="">{t.adminFilters.allTenants}</option>
            {tenants?.map(tenant => (
              <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
            ))}
          </select>
        </div>
      </div>
      {!rows.length ? (
        <p className="text-sm text-muted-foreground">{t.adminVms.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.adminFilters.tenant}</TableHead>
              <TableHead><SortByName dir={sortDir} onToggle={() => setSortDir(nextSortDir)} /></TableHead>
              <TableHead>{t.adminFilters.status}</TableHead>
              <TableHead>{t.adminVms.offering}</TableHead>
              <TableHead>{t.adminVms.ip}</TableHead>
              <TableHead>{t.adminFilters.cluster}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(vm => (
              <TableRow key={vm.id}>
                <TableCell>{tenantName.get(vm.tenantId) ?? vm.tenantId}</TableCell>
                <TableCell>{vm.name}</TableCell>
                <TableCell>
                  <Badge
                    variant={statusVariant(vmLabel(vm))}
                    title={[vm.requestFailureReason, vm.requestFailureDetail].filter(Boolean).join('\n') || undefined}
                  >
                    {vmLabel(vm)}
                  </Badge>
                </TableCell>
                <TableCell>{vm.vmOfferingId}</TableCell>
                <TableCell>{vm.ipAddress ?? '—'}</TableCell>
                <TableCell>{vm.clusterId}</TableCell>
                <TableCell className="text-right">
                  <Button variant="destructive" onClick={() => setDeleting(vm)}>{t.common.delete}</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <DeleteVmDialog
        vm={deleting}
        tenantName={deleting ? tenantName.get(deleting.tenantId) ?? deleting.tenantId : ''}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

// B-A01 (titan-ops architecture/tenancy-and-admin.md#admin-cross-tenant-write) — destructive confirm. Admin must type the VM's exact name to enable Delete;
// this guards against mis-clicks on an irreversible cross-tenant action. Not a security control
// (backend gates by role) — a human guard.
function DeleteVmDialog({ vm, tenantName, onClose }: { vm: AdminVm | null; tenantName: string; onClose: () => void }) {
  const t = useT()
  const deleteVm = useDeleteAdminVm()
  const [typed, setTyped] = useState('')

  // Reset the typed confirmation whenever a different VM is opened.
  const openedFor = vm?.id
  const [seededFor, setSeededFor] = useState<string | undefined>(undefined)
  if (openedFor !== seededFor) {
    setSeededFor(openedFor)
    setTyped('')
  }

  const confirmed = !!vm && typed === vm.name

  function doDelete() {
    if (!vm || !confirmed) return
    deleteVm.mutate(vm.id, {
      onSuccess: () => {
        toast.success(t.adminVms.deletingToast(vm.name))
        onClose()
      },
      onError: e => {
        const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code
        toast.error(code ?? t.adminVms.deleteFailed)
      },
    })
  }

  return (
    <Dialog open={!!vm} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.adminVms.deleteVm}</DialogTitle>
          <DialogDescription>
            {vm
              ? t.adminVms.deleteDescription(vm.name, tenantName)
              : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="confirm-vm-name" className="text-sm text-soft-foreground">
            {t.adminVms.typeNameBefore}<span className="text-foreground">{vm?.name}</span>{t.adminVms.typeNameAfter}
          </label>
          <Input
            id="confirm-vm-name"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder={vm?.name}
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="destructive" onClick={doDelete} disabled={!confirmed || deleteVm.isPending}>
            {deleteVm.isPending ? t.adminVms.deleting : t.adminVms.deleteVm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
