import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

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
}

export interface BackupsResult {
  readAt: string | null
  items: BackupItem[]
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
