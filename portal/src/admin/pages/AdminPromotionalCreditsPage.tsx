import { useState } from 'react'
import { toast } from 'sonner'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT, useFormat } from '@/i18n/LanguageContext'
import {
  useAdminPromotionalCredits, useGrantPromotionalCredit, type PromotionalCredit,
} from '../hooks/useAdminPromotionalCredits'
import { useAdminTenants } from '../hooks/useAdminTenants'
import { useAdminPendingTopUps, useConfirmTopUp, type AdminTopUp } from '../hooks/useAdminTopUps'
import { parseWholeVnd } from '@/lib/money'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

// US-PROMO-01 — admin grants free credit to a tenant, effective immediately. This replaced the old
// approval queue: there is no request to approve any more, so the page is a grant form plus a history.
export function AdminPromotionalCreditsPage() {
  const t = useT()
  const f = useFormat()
  const { data: credits, isLoading, isError } = useAdminPromotionalCredits()
  const { data: tenants } = useAdminTenants()
  const grant = useGrantPromotionalCredit()

  const [tenantId, setTenantId] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')

  const nameOf = (id: string) => tenants?.find(tenant => tenant.id === id)?.name ?? id

  // Whole đồng, typed the way the page shows it: 500.000 is five hundred thousand.
  const numeric = parseWholeVnd(amount)
  const canSubmit = tenantId !== '' && numeric !== null && numeric > 0 && !grant.isPending

  function submit() {
    if (!canSubmit || numeric === null) {
      return
    }
    grant.mutate(
      { tenantId, amount: numeric, reason: reason.trim() || null },
      {
        onSuccess: () => {
          toast.success(t.adminCredits.granted)
          setAmount('')
          setReason('')
        },
        onError: e => {
          const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code
          toast.error(code ?? t.adminCredits.grantFailed)
        },
      },
    )
  }

  return (
    <div>
      <h1 className="text-lg font-semibold mb-1">{t.adminCredits.title}</h1>
      <p className="text-[13px] text-faint mb-4">{t.adminCredits.subtitle}</p>

      <div className="rounded-xl border border-border p-4 mb-6 flex items-end flex-wrap gap-3">
        <div className="space-y-1">
          <label htmlFor="grant-tenant" className="text-xs text-muted-foreground">{t.adminCredits.tenant}</label>
          <select
            id="grant-tenant"
            value={tenantId}
            onChange={e => setTenantId(e.target.value)}
            className="h-9 w-56 rounded-md border border-border bg-transparent px-3 text-sm text-foreground"
          >
            <option value="">{t.adminCredits.selectTenant}</option>
            {tenants?.map(tenant => (
              <option key={tenant.id} value={tenant.id} className="bg-popover">{tenant.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="grant-amount" className="text-xs text-muted-foreground">{t.adminCredits.amountVnd}</label>
          <Input
            id="grant-amount"
            type="text"
            inputMode="numeric"
            value={amount}
            placeholder={t.adminCredits.amountPlaceholder}
            onChange={e => setAmount(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="space-y-1 flex-1 min-w-48">
          <label htmlFor="grant-reason" className="text-xs text-muted-foreground">{t.adminCredits.reasonOptional}</label>
          <Input
            id="grant-reason"
            value={reason}
            maxLength={500}
            placeholder={t.adminCredits.reasonPlaceholder}
            onChange={e => setReason(e.target.value)}
          />
        </div>
        <Button onClick={submit} disabled={!canSubmit}>{t.adminCredits.grantCredit}</Button>
      </div>

      <PendingTopUps nameOf={nameOf} />

      <h2 className="text-sm font-medium text-foreground mb-3">{t.adminCredits.history}</h2>
      {isLoading ? (
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      ) : isError ? (
        <p className="text-muted-foreground text-sm">{t.adminCredits.loadFailed}</p>
      ) : !credits?.length ? (
        <p className="text-sm text-muted-foreground">{t.adminCredits.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.adminCredits.tenant}</TableHead>
              <TableHead>{t.adminCredits.amount}</TableHead>
              <TableHead>{t.adminCredits.reason}</TableHead>
              <TableHead>{t.adminCredits.grantedBy}</TableHead>
              <TableHead>{t.adminCredits.grantedAt}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {credits.map((c: PromotionalCredit) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{nameOf(c.tenantId)}</TableCell>
                <TableCell className="font-mono text-sm">{f.money(c.amount, c.currency)}</TableCell>
                <TableCell className="text-soft-foreground">{c.reason ?? '—'}</TableCell>
                <TableCell className="text-soft-foreground">{c.grantedBy}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{f.date(c.grantedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

// titan-ops features/billing/topup/design.md — the manual fallback when the SePay webhook did not match a transfer: the admin
// checks the bank account, then confirms the top-up here (POST /v1/admin/topups/{id}/confirm).
function PendingTopUps({ nameOf }: { nameOf: (tenantId: string) => string }) {
  const t = useT()
  const f = useFormat()
  const { data: pending, isLoading, isError } = useAdminPendingTopUps()
  const [target, setTarget] = useState<AdminTopUp | null>(null)

  return (
    <section aria-labelledby="pending-topups-title" className="mb-6">
      <h2 id="pending-topups-title" className="text-sm font-medium text-foreground mb-1">{t.adminCredits.pendingTitle}</h2>
      <p className="text-[13px] text-faint mb-3">{t.adminCredits.pendingHint}</p>
      {isLoading ? (
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      ) : isError ? (
        <p className="text-muted-foreground text-sm">{t.adminCredits.pendingLoadFailed}</p>
      ) : !pending?.length ? (
        <p className="text-sm text-muted-foreground">{t.adminCredits.pendingEmpty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.adminCredits.tenant}</TableHead>
              <TableHead>{t.adminCredits.amount}</TableHead>
              <TableHead>{t.adminCredits.reference}</TableHead>
              <TableHead>{t.adminCredits.created}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending.map(topUp => (
              <TableRow key={topUp.id}>
                <TableCell className="font-medium">{nameOf(topUp.tenantId)}</TableCell>
                <TableCell className="font-mono text-sm">{f.money(topUp.amount, topUp.currency)}</TableCell>
                <TableCell className="font-mono text-sm">{topUp.paymentRef}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{f.dateTime(topUp.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setTarget(topUp)}>{t.adminCredits.confirm}</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <ConfirmTopUpDialog topUp={target} tenantName={target ? nameOf(target.tenantId) : ''} onClose={() => setTarget(null)} />
    </section>
  )
}

function ConfirmTopUpDialog({
  topUp, tenantName, onClose,
}: { topUp: AdminTopUp | null; tenantName: string; onClose: () => void }) {
  const t = useT()
  const f = useFormat()
  const confirm = useConfirmTopUp()
  const [bankRef, setBankRef] = useState('')

  function close() {
    setBankRef('')
    onClose()
  }

  function submit() {
    if (topUp === null) {
      return
    }
    const trimmed = bankRef.trim()
    let paymentTxnRef: string | null = null
    if (trimmed !== '') {
      paymentTxnRef = trimmed
    }
    confirm.mutate(
      { id: topUp.id, paymentTxnRef },
      {
        onSuccess: () => {
          toast.success(t.adminCredits.confirmed)
          close()
        },
        onError: e => {
          const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code
          toast.error(code ?? t.adminCredits.confirmFailed)
        },
      },
    )
  }

  return (
    <Dialog open={topUp !== null} onOpenChange={open => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.adminCredits.confirmTitle}</DialogTitle>
          <DialogDescription>
            {topUp ? t.adminCredits.confirmDescription(f.money(topUp.amount, topUp.currency), tenantName, topUp.paymentRef) : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="confirm-bank-ref" className="text-sm text-soft-foreground">{t.adminCredits.bankRef}</label>
          <Input id="confirm-bank-ref" value={bankRef} maxLength={200} onChange={e => setBankRef(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>{t.common.cancel}</Button>
          <Button onClick={submit} disabled={confirm.isPending}>
            {confirm.isPending ? t.common.saving : t.adminCredits.confirmAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
