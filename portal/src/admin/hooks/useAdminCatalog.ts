import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

import { pollWhileASyncWaits } from '@/lib/templateState'

// Shape mirrors AdminTemplateQueryResult (control-plane). GET /v1/admin/templates returns EVERY template with its
// internal sync per cluster — unlike the customer GET /v1/templates (titan-ops features/catalog/design.md#template-per-cluster):
// each cluster holds its own image alias, so a template can be there in one cluster and not in another.

// Mirrors AdminTemplateClusterQueryResult (titan-ops features/catalog/design.md#template-state-is-existence).
export interface AdminTemplateCluster {
  clusterId: string
  currentExistence: 'NotCreated' | 'Exists' | 'NotFound'
  desiredExistence: 'Exists'
  transition: 'Syncing' | null
  requestFailureReason: string | null
  requestFailureDetail: string | null
  requestFailedAt: string | null
  externalTemplateId: string | null
}

export interface AdminTemplate {
  id: string
  name: string
  description: string | null
  os: string
  // titan-ops features/catalog/design.md#template-borrows-sizing — the tier this template borrows its base sizing from. Not a size itself: resolve it
  // against the offerings this page already loads, so one catalog defines what "m" means.
  vmOfferingId: string
  diskGb: number | null
  clusters: AdminTemplateCluster[] // ordered by cluster id
}

// Every cluster row of every template: what the poll and the status column read.
export function templateClusters(templates: readonly AdminTemplate[] | undefined): AdminTemplateCluster[] | undefined {
  if (templates === undefined) {
    return undefined
  }
  return templates.flatMap(t => t.clusters)
}

// Refreshes itself while a sync waits in any cluster, then stops — so the status column moves without the page
// remembering it clicked Sync.
export function useTemplatesCatalog() {
  return useQuery({
    queryKey: ['admin', 'templates'],
    queryFn: () => api.get<AdminTemplate[]>('/v1/admin/templates').then(r => r.data),
    refetchInterval: query => pollWhileASyncWaits(templateClusters(query.state.data)),
  })
}

// POST .../sync answers 202 with no body (titan-ops architecture/http-contract.md#commands-return-no-data, CQRS-5 D-5): the sync is enqueued, not done. The
// outcome is read back from the template list, which is why success re-fetches it.
export function useSyncTemplates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/v1/admin/templates/sync').then(() => undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'templates'] }),
  })
}

// ── Offerings (titan-ops architecture/money-and-wallet.md#price-belongs-to-offering) ─────────────────────────────────────────────────────
// Price lives on the offering now, so the catalog page reads it from the same rows it already shows
// tiers from. These are the customer-facing endpoints (not /v1/admin/*) — an admin sees exactly the
// prices a customer sees, which is the point of putting them on the product.

// Mirrors VmOfferingQueryResult.
export interface VmOfferingRow {
  id: string
  name: string
  cpu: number
  vcpu: number
  memoryMb: number
  pricePerHour: number
}

// Mirrors VolumeOfferingQueryResult.
export interface VolumeOfferingRow {
  id: string
  name: string
  sizeGb: number
  isCustomized: boolean
  pricePerGbPerHour: number
}

export function useVmOfferingsCatalog() {
  return useQuery({
    queryKey: ['admin', 'vm-offerings'],
    queryFn: () => api.get<VmOfferingRow[]>('/v1/vm-offerings').then(r => r.data),
  })
}

export function useVolumeOfferingsCatalog() {
  return useQuery({
    queryKey: ['admin', 'volume-offerings'],
    queryFn: () => api.get<VolumeOfferingRow[]>('/v1/volume-offerings').then(r => r.data),
  })
}

export function useUpdateVmOfferingPrice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, pricePerHour }: { id: string; pricePerHour: number }) =>
      // titan-ops architecture/http-contract.md#commands-return-no-data: 204 with no body.
      api.patch(`/v1/admin/vm-offerings/${id}/price`, { pricePerHour }),
    // Invalidate rather than write into the cache: the price also drives what customers are quoted,
    // so a refetch is the honest thing to show after a change.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'vm-offerings'] }),
  })
}
