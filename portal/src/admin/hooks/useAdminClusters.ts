import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

// Shape mirrors AdminClusterDto (control-plane): a cluster as the control plane's configuration holds it
// (docs/features/cluster/design.md#cluster-from-config). Null = not set.
export interface AdminCluster {
  zoneId: string
  name: string
  endpoint: string
  serverFingerprint: string
  providerSettings: {
    ovnUplinkNetwork: string | null
    storagePool: string | null
    ipv6Block: string | null
  }
}

// The control plane sends null, not an absent field, for the half that does not apply.
export interface ClusterTestResult {
  ok: boolean
  latencyMs: number | null
  error: string | null
}

export interface TestClusterInput {
  endpoint: string
  serverFingerprint: string
}

// The public half only: the private key never leaves the control plane
// (docs/features/cluster/design.md#provider-client-identity).
export interface ProviderClientCertificate {
  certificatePem: string
  fingerprint: string
}

export function useAdminClusters() {
  return useQuery({
    queryKey: ['admin', 'clusters'],
    queryFn: () => api.get<AdminCluster[]>('/v1/admin/clusters').then(r => r.data),
  })
}

export function useProviderClientCertificate() {
  return useQuery({
    queryKey: ['admin', 'provider-client-certificate'],
    queryFn: () =>
      api.get<ProviderClientCertificate>('/v1/admin/clusters/client-certificate').then(r => r.data),
  })
}

export function useTestClusterConnection() {
  return useMutation({
    mutationFn: (input: TestClusterInput) =>
      api.post<ClusterTestResult>('/v1/admin/clusters/test', input).then(r => r.data),
  })
}
