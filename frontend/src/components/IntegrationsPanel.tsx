import { useEffect, useState } from "react";
import GlassCard from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { connectIntegration, disconnectIntegration, listIntegrations } from "@/services/api/integrations";

type Provider = "google" | "notion";

interface Integration {
  id: string;
  provider: Provider;
  status: string | null;
  target_display_name?: string | null;
  last_sync_at?: string | null;
  last_sync_status?: string | null;
  last_sync_error?: string | null;
}

const providers: Array<{ key: Provider; label: string; description: string }> = [
  { key: "google", label: "Google Sheets", description: "Sync assignments to a single Sheet." },
  { key: "notion", label: "Notion", description: "Sync assignments to a single Database." },
];

export function IntegrationsPanel() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const data = await listIntegrations();
      setIntegrations(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const integrationFor = (provider: Provider) =>
    integrations.find((i) => i.provider === provider) || null;

  async function handleConnect(provider: Provider) {
    try {
      setAction(provider);
      const authUrl = await connectIntegration(provider);
      window.open(authUrl, "_blank", "noopener,noreferrer");
      // Give the user a chance to finish OAuth, then they can hit refresh.
    } catch (err: any) {
      setError(err?.message || `Failed to start ${provider} auth`);
    } finally {
      setAction(null);
    }
  }

  async function handleDisconnect(provider: Provider) {
    try {
      setAction(provider);
      await disconnectIntegration(provider);
      await load();
    } catch (err: any) {
      setError(err?.message || `Failed to disconnect ${provider}`);
    } finally {
      setAction(null);
    }
  }

  return (
    <GlassCard hover={false} className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Sync Integrations</h3>
          <p className="text-xs text-muted-foreground">
            Connect one destination per provider. OAuth opens in a new tab.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="text-xs text-red-500 border border-red-500/30 p-2 rounded">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {providers.map(({ key, label, description }) => {
          const integ = integrationFor(key);
          const connected = Boolean(integ);
          const status = integ?.last_sync_status || "not synced yet";
          const lastSync = integ?.last_sync_at
            ? new Date(integ.last_sync_at).toLocaleString()
            : "—";
          const targetName = integ?.target_display_name || integ?.external_target_id;

          return (
            <div
              key={key}
              className="border border-border/70 rounded-md p-3 flex items-start justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{label}</span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full ${
                      connected ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {connected ? "Connected" : "Not connected"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{description}</p>
                {connected && (
                  <div className="text-xs text-foreground/80 space-y-0.5">
                    <div>
                      Target: <span className="font-medium">{targetName || "—"}</span>
                    </div>
                    <div>
                      Last sync: <span className="font-medium">{lastSync}</span> ({status})
                    </div>
                    {integ?.last_sync_error && (
                      <div className="text-red-400">Error: {integ.last_sync_error}</div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {!connected ? (
                  <Button
                    size="sm"
                    onClick={() => handleConnect(key)}
                    disabled={!!action || loading}
                  >
                    {action === key ? "Opening..." : "Connect"}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDisconnect(key)}
                    disabled={!!action || loading}
                  >
                    {action === key ? "Disconnecting..." : "Disconnect"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

export default IntegrationsPanel;




