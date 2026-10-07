import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ExternalLinkIcon } from 'lucide-react';
import type { ForgeKind, ForgeStatus } from '@open-mercato/maestro-api-client';
import { getForgesStatus, connectForge } from '@open-mercato/maestro-api-client';
import { StatusDot, type StatusDotTone } from '@/components/status-dot';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';

interface ForgeInfo {
  kind: ForgeKind;
  label: string;
  description: string;
  docsUrl: string;
  supportsMultiHost: boolean;
}

const FORGES: ForgeInfo[] = [
  {
    kind: 'github',
    label: 'GitHub',
    description: 'GitHub.com and GitHub Enterprise',
    docsUrl: 'https://cli.github.com',
    supportsMultiHost: false,
  },
  {
    kind: 'gitlab',
    label: 'GitLab',
    description: 'GitLab.com and self-hosted GitLab',
    docsUrl: 'https://gitlab.com/gitlab-org/cli',
    supportsMultiHost: true,
  },
  {
    kind: 'gitea',
    label: 'Gitea',
    description: 'Gitea.com and self-hosted Gitea',
    docsUrl: 'https://gitea.com/gitea/tea',
    supportsMultiHost: true,
  },
  {
    kind: 'forgejo',
    label: 'Forgejo',
    description: 'Codeberg.org and self-hosted Forgejo',
    docsUrl: 'https://gitea.com/gitea/tea',
    supportsMultiHost: true,
  },
];

function getStatusTone(status: ForgeStatus | undefined): StatusDotTone {
  if (!status) return 'neutral';
  if (status.authenticated) return 'success';
  if (status.available) return 'pending';
  return 'neutral';
}

function ForgeCard({
  forge,
  status,
  onConnect,
}: {
  forge: ForgeInfo;
  status: ForgeStatus | undefined;
  onConnect: (host?: string) => void;
}) {
  const [selfHostedUrl, setSelfHostedUrl] = useState('');
  const [showSelfHosted, setShowSelfHosted] = useState(false);

  const handleConnect = (host?: string) => {
    onConnect(host);
    if (host) setSelfHostedUrl('');
  };

  return (
    <div className="rounded-md border border-border bg-card px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-foreground">{forge.label}</h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <StatusDot tone={getStatusTone(status)} />
            <span>
              {status?.authenticated ? 'Connected' : status?.available ? 'Not connected' : 'Not installed'}
            </span>
            {status?.authenticated && status.user && (
              <span>• {status.user}</span>
            )}
          </div>

          <p className="mt-1.5 text-xs text-soft-foreground">
            {forge.description}
          </p>

          {status?.hint && (
            <div className="mt-2 rounded-sm bg-pending/10 px-2 py-1.5">
              <p className="text-[13px] text-pending-foreground">{status.hint}</p>
            </div>
          )}

          {status?.version && (
            <p className="mt-1.5 text-xs text-soft-foreground">
              {status.cli} {status.version}
              {status.host && ` • ${status.host}`}
            </p>
          )}

          {!status?.authenticated && forge.supportsMultiHost && showSelfHosted && (
            <div className="mt-2 space-y-1.5">
              <Input
                placeholder={`https://${forge.kind}.company.com`}
                className="h-8 text-[13px]"
                value={selfHostedUrl}
                onChange={(e) => setSelfHostedUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && selfHostedUrl.trim()) {
                    handleConnect(selfHostedUrl.trim());
                  }
                }}
              />
              <p className="text-xs text-soft-foreground">
                Press Enter or click Connect to use self-hosted instance
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!showSelfHosted && forge.supportsMultiHost && !status?.authenticated && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowSelfHosted(true)}
              disabled={!status?.available}
            >
              Self-hosted
            </Button>
          )}
          {!status?.authenticated && status?.available && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleConnect()}
            >
              Connect
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.open(forge.docsUrl, '_blank')}
            className="px-2"
            title="Documentation"
          >
            <ExternalLinkIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ForgesSection() {
  const queryClient = useQueryClient();

  const { data: forgesStatus, isLoading } = useQuery({
    queryKey: ['forges', 'status'],
    queryFn: () => getForgesStatus(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const connectMutation = useMutation({
    mutationFn: ({ kind, host }: { kind: ForgeKind; host?: string }) =>
      connectForge(kind, { host }),
    onSuccess: (data, variables) => {
      toast.success(
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Run this command:</p>
          <code className="block rounded bg-muted px-2 py-1 text-xs font-mono">
            {data.command}
          </code>
          <p className="text-xs text-muted-foreground">
            After running it, the status will update automatically.
          </p>
        </div>,
        { duration: 10_000 },
      );

      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['forges', 'status'] });
      }, 2000);
    },
    onError: (error) => {
      toast.error(`Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['forges', 'status'] });
    toast.success('Refreshing forge status...');
  };

  return (
    <section id="forges" data-slot="forge-settings" className="scroll-mt-20">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Forges</h2>
          <p className="text-[13px] text-muted-foreground">
            Configure git forge integrations for issues, PRs, and draft PR creation.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRefresh}
          disabled={isLoading}
          className="h-7 px-2 text-[13px]"
        >
          {isLoading ? 'Checking...' : 'Check again'}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {FORGES.map((forge) => {
          const status = forgesStatus?.forges.find((f) => f.kind === forge.kind);

          return (
            <ForgeCard
              key={forge.kind}
              forge={forge}
              status={status}
              onConnect={(host) =>
                connectMutation.mutate({ kind: forge.kind, host })
              }
            />
          );
        })}
      </div>
    </section>
  );
}
