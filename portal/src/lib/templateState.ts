// A template's sync in one cluster as the server sends it (titan-ops features/catalog/design.md#template-state-is-existence):
// Incus has no status word for an image alias, so the one `status` is Titan's — Syncing while a sync waits for the
// worker, Available when the cluster holds the alias, NotFound when the reconciler saw it gone, Failed when a sync gave
// up before any alias was there. requestFailureReason / requestFailureDetail say why the last sync gave up.

import { POLL_MS } from '@/hooks/pollUntilSettled'

export interface TemplateClusterFields {
  status: string
}

const LABEL: Record<string, string> = {
  Syncing: 'Syncing',
  Available: 'Available',
  NotFound: 'Not found',
  Failed: 'Failed',
}

/** The badge: the status word, spelled for the operator. A status this page does not know shows as the server spelled it. */
export function templateClusterLabel(cluster: TemplateClusterFields): string {
  return LABEL[cluster.status] ?? cluster.status
}

/** React Query `refetchInterval`: refresh while a sync waits in any cluster, then stop. */
export function pollWhileASyncWaits(clusters: readonly TemplateClusterFields[] | undefined): number | false {
  if (clusters === undefined) {
    return false
  }
  const anyWaiting = clusters.some(cluster => cluster.status === 'Syncing')
  if (anyWaiting) {
    return POLL_MS
  }
  return false
}
