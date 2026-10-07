import { z } from 'zod';

/**
 * Forge configuration and status schemas for the Settings UI.
 *
 * This contract enables viewing and managing authentication status for GitHub,
 * GitLab, Gitea, and Forgejo from the Settings → Forges section.
 */

/** The four supported forge types. */
export const forgeKindSchema = z.enum(['github', 'gitlab', 'gitea', 'forgejo']);
export type ForgeKind = z.infer<typeof forgeKindSchema>;

/** Status of one forge's CLI and authentication. */
export const forgeStatusSchema = z.object({
  /** Which forge this status describes. */
  kind: forgeKindSchema,
  /** Is the CLI installed and executable? */
  available: z.boolean(),
  /** Is the user authenticated with this forge? */
  authenticated: z.boolean(),
  /** CLI binary name (gh, glab, tea). */
  cli: z.string(),
  /** CLI version string when available. */
  version: z.string().optional(),
  /** Human-readable hint when not authenticated or CLI missing. */
  hint: z.string().optional(),
  /** Authenticated username when logged in. */
  user: z.string().optional(),
  /** Forge host (for self-hosted instances). */
  host: z.string().optional(),
});
export type ForgeStatus = z.infer<typeof forgeStatusSchema>;

/** `GET /api/v1/forges/status` — status of all forge CLIs. */
export const forgesStatusResponseSchema = z.object({
  forges: z.array(forgeStatusSchema),
});
export type ForgesStatusResponse = z.infer<typeof forgesStatusResponseSchema>;

/** `POST /api/v1/forges/:kind/connect` request body. */
export const forgeConnectInputSchema = z.object({
  /** Host URL for self-hosted instances (e.g., "https://gitlab.company.com"). */
  host: z.string().optional(),
});
export type ForgeConnectInput = z.infer<typeof forgeConnectInputSchema>;

/** `POST /api/v1/forges/:kind/connect` response. */
export const forgeConnectResponseSchema = z.object({
  /** Whether we successfully opened the terminal/browser for authentication. */
  opened: z.boolean(),
  /** If opened=false and the CLI is already authenticated. */
  authenticated: z.boolean(),
  /** The authentication command for the user to run manually. */
  command: z.string(),
});
export type ForgeConnectResponse = z.infer<typeof forgeConnectResponseSchema>;
