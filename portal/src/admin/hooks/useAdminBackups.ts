import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { api } from '@/lib/api'
import { useIdempotencyKey } from '@/lib/idempotency'

// Shapes mirror BackupsQueryResult, BackupTargetQueryResult and BackupTargetTestResult (control plane;
// titan-ops features/backup/design.md). The control plane sends null, not an absent field, for what does not apply.
export type BackupHealth = 'Ok' | 'Stale' | 'Missing' | 'Unknown'

export interface BackupItem {
  kind: string
  name: string
  tenantId: string | null
  takenAt: string | null
  sizeBytes: number | null
  health: BackupHealth
  reason: string | null
  lastWalAt: string | null
  // The Titan id of the VM or volume; null for Postgres and a cluster's config. Absent, like `archives`, from a
  // control plane older than the Restore button.
  resourceId?: string | null
  // Every complete archive of the resource, newest first (titan-ops features/backup/design.md#restore-as-new-resource).
  archives?: BackupArchive[]
}

export interface BackupArchive {
  backupKey: string
  takenAt: string
  sizeBytes: number | null
}

// A restore asked from the Backups page. `resourceId` and `name` are the new resource's; `name` is null when the
// control plane finds no row for it. `reason` is the worker's own text, set when `state` is 'failed'.
export interface BackupRestore {
  kind: 'vm' | 'volume'
  resourceId: string
  name: string | null
  tenantId: string | null
  takenAt: string | null
  state: 'running' | 'done' | 'failed'
  askedAt: string
  reason: string | null
}

// A cluster's latest restore drill (control plane RestoreDrillQueryResult). 'verified': the newest ended drill is Done.
// 'notVerified': it failed, `reason` says why and `verifiedAt` is when one last worked (null if none did in 30 days).
// 'none': no drill ended in the last 30 days. `kind` and `name` are null when there is nothing to name.
export interface RestoreDrill {
  clusterId: string
  clusterName: string
  state: 'verified' | 'notVerified' | 'none'
  verifiedAt: string | null
  kind: string | null
  name: string | null
  reason: string | null
}

export interface BackupsResult {
  readAt: string | null
  items: BackupItem[]
  // Absent from a control plane older than the restore drill.
  restoreDrills?: RestoreDrill[]
  // The restores asked in the last 30 days, newest first. Absent from a control plane older than the Restore button.
  restores?: BackupRestore[]
}

// The target is the environment's GitOps config, read-only here: no secret and no way to change it from the console.
export interface BackupTarget {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
}

export interface BackupTargetTestResult {
  ok: boolean
  latencyMs: number | null
  error: string | null
}

export function useAdminBackups() {
  return useQuery({
    queryKey: ['admin', 'backups'],
    queryFn: () => api.get<BackupsResult>('/v1/admin/backups').then(r => r.data),
    // The control plane re-reads the bucket every few minutes; a page left open follows it.
    refetchInterval: 60_000,
  })
}

// No key pair configured is a normal state (code BACKUP_TARGET_NOT_FOUND, not any 404): null, so the page says so instead of an error.
export function useBackupTarget() {
  return useQuery({
    queryKey: ['admin', 'backup-target'],
    queryFn: async (): Promise<BackupTarget | null> => {
      try {
        const response = await api.get<BackupTarget>('/v1/admin/backup-target')
        return response.data
      } catch (err) {
        const code = (err as { response?: { data?: { code?: string } } }).response?.data?.code
        if (code === 'BACKUP_TARGET_NOT_FOUND') {
          return null
        }
        throw err
      }
    },
  })
}

// Tests the configured target: no body.
export function useTestBackupTarget() {
  return useMutation({
    mutationFn: () => api.post<BackupTargetTestResult>('/v1/admin/backup-target/test').then(r => r.data),
  })
}

export interface RestoreFromBackupInput {
  kind: 'vm' | 'volume'
  resourceId: string
  backupKey: string
  name: string
}

// The answer names only the new resource (titan-ops architecture/http-contract.md#create-returns-id); the page shows
// the restore through the backups query, and the new VM is a row of the VM list.
export type RestoreFromBackupResult = { newVmId: string } | { newVolumeId: string }

// titan-ops features/backup/design.md#restore-as-new-resource
export function useRestoreFromBackup() {
  const qc = useQueryClient()
  const withKey = useIdempotencyKey() // titan-ops architecture/http-contract.md#idempotency-key: one key per submission
  return useMutation({
    mutationFn: ({ kind, resourceId, backupKey, name }: RestoreFromBackupInput) => {
      const route = kind === 'vm' ? `/v1/admin/backups/vms/${resourceId}/restore` : `/v1/admin/backups/volumes/${resourceId}/restore`
      return withKey(headers => api.post<RestoreFromBackupResult>(route, { backupKey, name }, { headers }).then(r => r.data))
    },
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: ['admin', 'backups'] }),
      qc.invalidateQueries({ queryKey: ['admin', 'vms'] }),
    ]),
    // The dialog lists the archives of the cached backups query, which would offer the gone one again.
    onError: (error: unknown) => {
      if (isAxiosError(error) && (error.response?.data as { code?: string } | undefined)?.code === 'BACKUP_NOT_FOUND') {
        return qc.invalidateQueries({ queryKey: ['admin', 'backups'] })
      }
    },
  })
}
