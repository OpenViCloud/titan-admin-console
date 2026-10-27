import { useState } from 'react'
import { toast } from 'sonner'
import {
  useAdminClusters,
  useProviderClientCertificate,
  useTestClusterConnection,
  type AdminCluster,
  type ClusterTestResult,
} from '../hooks/useAdminClusters'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/LanguageContext'
import type { Messages } from '@/i18n/en'

// docs/features/cluster/design.md#cluster-admin-page
export function AdminClustersPage() {
  const t = useT()
  const { data: clusters, isLoading, isError } = useAdminClusters()

  return (
    <div>
      <h1 className="text-lg font-semibold mb-1">{t.adminClusters.title}</h1>
      <p className="text-sm text-muted-foreground mb-6">
        {t.adminClusters.intro}
      </p>
      <div className="space-y-4 max-w-xl">
        <ClientCertificateBlock />
        {isLoading && <p className="text-sm text-muted-foreground">{t.common.loading}</p>}
        {isError && <p className="text-sm text-muted-foreground">{t.adminClusters.loadFailed}</p>}
        {clusters !== undefined && clusters.length === 0 && <p className="text-sm text-muted-foreground">{t.adminClusters.noClusters}</p>}
        {clusters !== undefined && clusters.map(c => <ClusterCard key={c.zoneId} cluster={c} />)}
      </div>
    </div>
  )
}

interface ErrorBody {
  code?: string
  title?: string
}

function errorBody(err: unknown): ErrorBody | undefined {
  const response = (err as { response?: { data?: ErrorBody } }).response
  if (response === undefined) {
    return undefined
  }
  return response.data
}

function errorCode(err: unknown): string | undefined {
  const body = errorBody(err)
  if (body === undefined) {
    return undefined
  }
  return body.code
}

function ClientCertificateBlock() {
  const t = useT()
  const { data: certificate, isLoading, error } = useProviderClientCertificate()

  function copy() {
    if (certificate === undefined) {
      return
    }
    navigator.clipboard.writeText(certificate.certificatePem).then(
      () => toast.success(t.adminClusters.certificateCopied),
      () => toast.error(t.adminClusters.certificateCopyFailed),
    )
  }

  return (
    <section
      aria-labelledby="titan-client-certificate"
      className="rounded-lg border border-border p-4 space-y-3"
    >
      <h2 id="titan-client-certificate" className="text-sm font-medium text-foreground">
        {t.adminClusters.certificateTitle}
      </h2>
      {isLoading && <p className="text-xs text-muted-foreground">{t.common.loading}</p>}
      {error && (
        <p className="text-xs text-bad">
          {t.adminClusters.certificateReadFailed(errorCode(error) ?? t.adminClusters.certificateRequestFailed)}
        </p>
      )}
      {certificate !== undefined && (
        <>
          <Field label={t.adminClusters.fingerprint}>
            <span className="font-mono text-[12px] text-foreground break-all select-all">{certificate.fingerprint}</span>
          </Field>
          <pre className="max-h-40 overflow-auto rounded bg-overlay p-2 font-mono text-[11px] text-soft-foreground">
            {certificate.certificatePem}
          </pre>
          <div className="flex items-center gap-3">
            <Button type="button" variant="secondary" onClick={copy}>{t.adminClusters.copyCertificate}</Button>
            <span className="text-xs text-muted-foreground">
              {t.adminClusters.onTheCluster}<code className="font-mono">incus config trust add-certificate titan.crt</code>
            </span>
          </div>
        </>
      )}
    </section>
  )
}

// Read-only: a cluster is the control plane's configuration (docs/features/cluster/design.md#cluster-from-config).
function ClusterCard({ cluster }: { cluster: AdminCluster }) {
  const t = useT()
  const test = useTestClusterConnection()
  const [testResult, setTestResult] = useState<ClusterTestResult | null>(null)
  const settings = cluster.providerSettings

  function runTest() {
    setTestResult(null)
    test.mutate(
      { endpoint: cluster.endpoint, serverFingerprint: cluster.serverFingerprint },
      { onSuccess: setTestResult, onError: () => setTestResult({ ok: false, latencyMs: null, error: t.adminClusters.requestFailed }) },
    )
  }

  return (
    <section className="rounded-lg border border-border p-4 space-y-3" aria-label={t.adminClusters.formLabel(cluster.zoneId)}>
      <span className="font-mono text-[13px] text-foreground">{cluster.zoneId}</span>
      <Field label={t.adminClusters.clusterName}>
        <span className="text-sm text-foreground">{cluster.name}</span>
      </Field>
      <Field label={t.adminClusters.endpoint}>
        <span className="font-mono text-[12px] text-foreground break-all">{cluster.endpoint}</span>
      </Field>
      <Field label={t.adminClusters.serverFingerprint}>
        <span className="font-mono text-[12px] text-foreground break-all select-all">{cluster.serverFingerprint}</span>
      </Field>
      <Field label={t.adminClusters.ovnUplinkNetwork}><Setting value={settings.ovnUplinkNetwork} /></Field>
      <Field label={t.adminClusters.storagePool}><Setting value={settings.storagePool} /></Field>
      <Field label={t.adminClusters.ipv6Block}><Setting value={settings.ipv6Block} /></Field>

      <div className="flex items-center gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={runTest} disabled={test.isPending}>
          {t.adminClusters.testConnection}
        </Button>
      </div>
      {testResult && (
        <p
          className={testResult.ok ? 'text-xs text-ok' : 'text-xs text-bad break-words'}
          role="status"
        >
          {testResultText(testResult, t)}
        </p>
      )}
    </section>
  )
}

function Setting({ value }: { value: string | null }) {
  const t = useT()
  if (value === null) {
    return <span className="text-sm text-muted-foreground">{t.adminClusters.notSet}</span>
  }
  return <span className="font-mono text-[12px] text-foreground">{value}</span>
}

// The error text after "Failed:" is the control plane's own and stays as sent.
function testResultText(result: ClusterTestResult, t: Messages): string {
  if (result.ok) {
    if (result.latencyMs === null) {
      return t.adminClusters.connected
    }
    return t.adminClusters.connectedWithLatency(result.latencyMs)
  }
  if (result.error === null) {
    return t.adminClusters.testFailed(t.adminClusters.unknownError)
  }
  return t.adminClusters.testFailed(result.error)
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}
