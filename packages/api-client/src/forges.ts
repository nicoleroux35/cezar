import type { ForgeKind, ForgeConnectInput, ForgesStatusResponse, ForgeConnectResponse } from '@open-mercato/cezar-contract';
import { apiPath } from './utils/project-scope.ts';

/**
 * Forge API client error.
 */
export class ForgeApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ForgeApiError';
  }
}

/**
 * Get the status of all forge CLIs (GitHub, GitLab, Gitea, Forgejo).
 *
 * @param opts.refresh - Force a fresh check instead of using cached status
 */
export async function getForgesStatus(opts?: { refresh?: boolean }): Promise<ForgesStatusResponse> {
  const query = opts?.refresh ? '?refresh=1' : '';
  const response = await fetch(apiPath(`/forges/status${query}`));
  if (!response.ok) throw new ForgeApiError(response.status, 'Failed to fetch forges status');
  return response.json() as Promise<ForgesStatusResponse>;
}

/**
 * Initiate connection to a forge (returns the auth command to run).
 *
 * @param kind - The forge type (github, gitlab, gitea, forgejo)
 * @param input - Connection options (optional host for self-hosted instances)
 */
export async function connectForge(
  kind: ForgeKind,
  input: ForgeConnectInput = {},
): Promise<ForgeConnectResponse> {
  const response = await fetch(apiPath(`/forges/${kind}/connect`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new ForgeApiError(response.status, `Failed to connect ${kind}`);
  return response.json() as Promise<ForgeConnectResponse>;
}
