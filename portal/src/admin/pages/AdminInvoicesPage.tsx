import { useMemo } from 'react'
import { toast } from 'sonner'
import {
  useAdminInvoices,
  useMarkInvoicePaid,
  useSettleInvoiceFromWallet,
  type AdminInvoice,
} from '../hooks/useAdminInvoices'
import { useAdminTenants } from '../hooks/useAdminTenants'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useT, useFormat } from '@/i18n/LanguageContext'
import { isPaymentInFlight } from '@/lib/invoice'

function statusVariant(status: string): 'success' | 'warning' | 'default' {
  if (status === 'Paid' || isSettled(status)) return 'success'
  if (status === 'Overdue') return 'warning'
  return 'default'
}

// titan-ops architecture/money-and-wallet.md#single-writer-outbox S7 — what the admin should READ off the row. Showing the stored "New" while a debit is in
// flight is accurate and useless: it reads as "the button did nothing".
function statusLabel(inv: AdminInvoice): string {
  if (inv.paymentState === 'Failed') return 'Payment failed'
  if (isPaymentInFlight(inv.paymentState)) return 'Processing'
  return inv.status
}

function badgeVariant(inv: AdminInvoice): 'success' | 'warning' | 'default' {
  if (inv.paymentState === 'Failed') return 'warning'
  if (isPaymentInFlight(inv.paymentState)) return 'warning'
  return statusVariant(inv.status)
}

// A wallet-settled invoice is already paid from prepaid credit — the admin cannot (and must not)
// mark it paid again. Cover both the display value (Settled) and the stored one (SettledByWallet).
function isSettled(status: string): boolean {
  return status === 'Settled' || status === 'SettledByWallet'
}

/// Both buttons are off once an invoice is settled either way — there is no second payment to make.
///
/// titan-ops architecture/money-and-wallet.md#single-writer-outbox S7 — and also while a wallet debit for it is still being applied. `status` stays New in
/// that window (the money has not moved yet), so a check on status alone leaves BOTH buttons live
/// on an invoice that is already being paid: pressing settle again debits the tenant's wallet twice,
/// and pressing mark-paid records an outside payment over a wallet one, which is precisely the
/// distinction the two routes exist to keep apart (titan-ops architecture/money-and-wallet.md#human-confirmed-debit).
function terminal(inv: AdminInvoice) {
  return inv.status === 'Paid' || isSettled(inv.status) || isPaymentInFlight(inv.paymentState)
}

function period(inv: AdminInvoice) {
  return `${inv.periodYear}-${String(inv.periodMonth).padStart(2, '0')}`
}

export function AdminInvoicesPage() {
  const t = useT()
  const f = useFormat()
  const { data: invoices, isLoading, isError } = useAdminInvoices()
  const { data: tenants } = useAdminTenants()
  const markPaid = useMarkInvoicePaid()
  const settleFromWallet = useSettleInvoiceFromWallet()

  // Invoices carry only tenantId; resolve to the friendly name (fall back to the id if the
  // tenant list hasn't loaded or the tenant is unknown).
  const tenantName = useMemo(() => {
    const m = new Map<string, string>()
    tenants?.forEach(tenant => m.set(tenant.id, tenant.name))
    return m
  }, [tenants])

  // Money that arrived OUTSIDE Titan (bank transfer). Records it; the wallet is not touched.
  function pay(inv: AdminInvoice) {
    markPaid.mutate(inv.id, {
      onSuccess: () => toast.success(t.adminInvoices.markedPaid),
      onError: e => {
        const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code
        toast.error(code ?? t.adminInvoices.markPaidFailed)
      },
    })
  }

  // titan-ops architecture/money-and-wallet.md#human-confirmed-debit PAY-5 — SPENDS THE TENANT'S WALLET, on their behalf. Only ever for a customer who asked
  // for it; the shortfall code is surfaced verbatim so an admin can tell them how much is missing.
  function settle(inv: AdminInvoice) {
    settleFromWallet.mutate(inv.id, {
      onSuccess: () => toast.success(t.adminInvoices.settled),
      onError: e => {
        const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code
        toast.error(
          code === 'INVOICE_WALLET_INSUFFICIENT'
            ? t.adminInvoices.walletInsufficient
            : (code ?? t.adminInvoices.settleFailed),
        )
      },
    })
  }

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">{t.common.loading}</div>
  if (isError) return <div className="p-6 text-muted-foreground text-sm">{t.adminInvoices.loadFailed}</div>

  return (
    <div>
      <h1 className="text-lg font-semibold mb-4">{t.adminInvoices.title}</h1>
      {!invoices?.length ? (
        <p className="text-sm text-muted-foreground">{t.adminInvoices.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.adminInvoices.tenant}</TableHead>
              <TableHead>{t.adminInvoices.period}</TableHead>
              <TableHead>{t.adminInvoices.total}</TableHead>
              <TableHead>{t.adminInvoices.status}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map(inv => (
              <TableRow key={inv.id}>
                <TableCell>{tenantName.get(inv.tenantId) ?? inv.tenantId}</TableCell>
                <TableCell>{period(inv)}</TableCell>
                <TableCell>{f.money(inv.total, inv.currency)}</TableCell>
                <TableCell>
                  <Badge variant={badgeVariant(inv)}>{statusLabel(inv)}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 justify-end">
                    <Button
                      variant="outline"
                      onClick={() => pay(inv)}
                      disabled={terminal(inv) || markPaid.isPending}
                      title={t.adminInvoices.markPaidTitle}
                    >
                      {t.adminInvoices.markPaid}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => settle(inv)}
                      disabled={terminal(inv) || settleFromWallet.isPending}
                      title={t.adminInvoices.settleFromWalletTitle}
                    >
                      {t.adminInvoices.settleFromWallet}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
