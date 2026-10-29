import { useState } from 'react'
import { toast } from 'sonner'
import {
  useVmOfferingsCatalog,
  useVolumeOfferingsCatalog,
  useUpdateVmOfferingPrice,
  type VmOfferingRow,
} from '../hooks/useAdminCatalog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { useT, useFormat, useLang } from '@/i18n/LanguageContext'
import { parseRate, rateInputValue } from '@/lib/money'

// Hours in the month a price preview is quoted against. Admins decide prices in monthly terms; a
// rate of "311 ₫/h" gives nobody a sense of the invoice it produces, and making them multiply by 720
// in their head moves the work onto the person the screen exists to help.
const HOURS_PER_MONTH = 720

// titan-ops architecture/money-and-wallet.md#price-belongs-to-offering — a product and its price belong on the same row. Before this, an admin who wanted to know
// what tier "m" cost had to open /pricing, find a row keyed by the slug "m", then open the catalog to
// learn that "m" means 2 vCPU / 4 GB, and hold the mapping in their head.
export function OfferingsSection() {
  const t = useT()
  const f = useFormat()
  const vmOfferings = useVmOfferingsCatalog()
  const volumeOfferings = useVolumeOfferingsCatalog()
  const [editing, setEditing] = useState<VmOfferingRow | null>(null)

  return (
    <section className="mt-10">
      <h2 className="text-base font-semibold tracking-tight">{t.adminOfferings.title}</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        {t.adminOfferings.intro}
      </p>

      <h3 className="text-sm font-medium mb-2">{t.adminOfferings.vmTiers}</h3>
      {vmOfferings.isLoading ? (
        <p className="text-sm text-muted-foreground">{t.adminOfferings.loadingVmTiers}</p>
      ) : vmOfferings.isError ? (
        <p className="text-sm text-bad">{t.adminOfferings.vmTiersLoadFailed}</p>
      ) : !vmOfferings.data?.length ? (
        <p className="text-sm text-muted-foreground">{t.adminOfferings.noVmTiers}</p>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.adminOfferings.tier}</TableHead>
                <TableHead>{t.adminOfferings.cpuVcpu}</TableHead>
                <TableHead>{t.adminOfferings.memoryMb}</TableHead>
                <TableHead>{t.adminOfferings.pricePerHour}</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {vmOfferings.data.map(o => (
                <TableRow key={o.id} data-testid={`vm-offering-${o.id}`}>
                  <TableCell>{o.name}</TableCell>
                  <TableCell>{o.cpu} / {o.vcpu}</TableCell>
                  <TableCell>{o.memoryMb}</TableCell>
                  <TableCell data-testid={`vm-offering-price-${o.id}`}>
                    {f.rate(o.pricePerHour)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      className="h-11 px-4"
                      onClick={() => setEditing(o)}
                      aria-label={t.adminOfferings.editPriceFor(o.name)}
                    >
                      {t.adminOfferings.editPrice}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <h3 className="text-sm font-medium mt-8 mb-2">{t.adminOfferings.storageTiers}</h3>
      {volumeOfferings.isLoading ? (
        <p className="text-sm text-muted-foreground">{t.adminOfferings.loadingStorageTiers}</p>
      ) : volumeOfferings.isError ? (
        <p className="text-sm text-bad">{t.adminOfferings.storageTiersLoadFailed}</p>
      ) : !volumeOfferings.data?.length ? (
        <p className="text-sm text-muted-foreground">{t.adminOfferings.noStorageTiers}</p>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.adminOfferings.tier}</TableHead>
                <TableHead>{t.adminOfferings.size}</TableHead>
                <TableHead>{t.adminOfferings.pricePerGbPerHour}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {volumeOfferings.data.map(o => (
                <TableRow key={o.id} data-testid={`volume-offering-${o.id}`}>
                  <TableCell>{o.name}</TableCell>
                  <TableCell>{o.isCustomized ? t.adminOfferings.customerSized : `${o.sizeGb} GB`}</TableCell>
                  <TableCell data-testid={`volume-offering-price-${o.id}`}>
                    {f.rate(o.pricePerGbPerHour)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <EditPriceDialog offering={editing} onClose={() => setEditing(null)} />
    </section>
  )
}

function EditPriceDialog({
  offering, onClose,
}: {
  offering: VmOfferingRow | null
  onClose: () => void
}) {
  const t = useT()
  const f = useFormat()
  const { lang } = useLang()
  const [value, setValue] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const update = useUpdateVmOfferingPrice()

  // Re-seed the field each time a different tier is opened. Keying the dialog on the offering id
  // would do the same thing, but this keeps the mounted/unmounted state simpler to reason about.
  const [seededFor, setSeededFor] = useState<string | null>(null)
  if (offering && seededFor !== offering.id) {
    setSeededFor(offering.id)
    setValue(rateInputValue(offering.pricePerHour, lang))
    setServerError(null)
  }

  // The decimal mark follows the language the page is shown in (311,256 ₫ in Vietnamese); Number() reads only '.'.
  const typed = parseRate(value, lang)
  const isValid = typed !== null && typed > 0
  let parsed = 0
  if (typed !== null) {
    parsed = typed
  }

  function submit() {
    if (!offering || !isValid) return
    setServerError(null)
    update.mutate(
      { id: offering.id, pricePerHour: parsed },
      {
        onSuccess: () => {
          toast.success(t.adminOfferings.priceUpdated(offering.name))
          setSeededFor(null)
          onClose()
        },
        // The dialog deliberately stays open on failure. This is the money path: closing it and
        // showing a toast would leave an admin believing a price changed when it did not, and the
        // number they typed would be gone too.
        onError: e => {
          const data = (e as { response?: { data?: { code?: string; title?: string } } })?.response?.data
          setServerError(data?.title ?? data?.code ?? t.adminOfferings.updateFailed)
        },
      },
    )
  }

  return (
    <Dialog
      open={offering !== null}
      onOpenChange={open => {
        if (!open && !update.isPending) {
          setSeededFor(null)
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {offering ? t.adminOfferings.dialogTitle(offering.name, offering.vcpu, offering.memoryMb) : t.adminOfferings.dialogTitleEmpty}
          </DialogTitle>
          <DialogDescription>
            {t.adminOfferings.dialogDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {/* Unit spelled out in the label rather than sitting as a glyph beside the field: a
              screen reader announcing "Price" alone leaves the reader guessing per what. */}
          <label htmlFor="price-per-hour" className="text-sm font-medium">
            {t.adminOfferings.priceLabel}
          </label>
          <Input
            id="price-per-hour"
            type="text"
            inputMode="decimal"
            value={value}
            disabled={update.isPending}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && isValid) submit() }}
            aria-invalid={!isValid || serverError !== null}
            aria-describedby="price-help"
          />
          <p id="price-help" className="text-sm text-muted-foreground">
            {serverError ? (
              <span className="text-bad">{serverError}</span>
            ) : isValid ? (
              t.adminOfferings.preview(f.rate(parsed), f.money(parsed * HOURS_PER_MONTH))
            ) : (
              t.adminOfferings.priceInvalid
            )}
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="h-11 px-4"
            disabled={update.isPending}
            onClick={() => { setSeededFor(null); onClose() }}
          >
            {t.common.cancel}
          </Button>
          <Button className="h-11 px-4" disabled={!isValid || update.isPending} onClick={submit}>
            {update.isPending ? t.common.saving : t.adminOfferings.savePrice}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
