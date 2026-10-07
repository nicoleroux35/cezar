import { spawn } from 'node:child_process';

export type OpencodeVersion = 'v1' | 'v2' | 'unknown';

export interface OpencodeVersionInfo {
  version: OpencodeVersion;
  binary: string;
  fullVersion?: string;
}

/**
 * Detect which version of OpenCode is installed by executing `opencode --version`
 * and parsing the output.
 * 
 * OpenCode is an open source AI coding agent that exists in two protocol versions:
 * - v1: Original protocol (OpenCode 1.x)
 * - v2: Modernized protocol (OpenCode 2.x)
 * 
 * Returns v1 as fallback when detection fails (backward compatible).
 */
export async function detectOpencodeVersion(bin?: string): Promise<OpencodeVersionInfo> {
  const binary = bin ?? process.env.CEZ_OPENCODE_BIN ?? 'opencode';

  // Check if CEZ_OPENCODE_VERSION is set (override for development/testing)
  const forced = process.env.CEZ_OPENCODE_VERSION;
  if (forced === 'v1' || forced === 'v2') {
    return { version: forced, binary };
  }

  try {
    const output = await execVersion(binary);
    const parsed = parseVersionOutput(output);

    if (parsed) {
      const parts = parsed.split('.');
      const major = parts[0] ? parseInt(parts[0], 10) : 1;
      const version: OpencodeVersion = major >= 2 ? 'v2' : 'v1';

      return {
        version,
        binary,
        fullVersion: parsed,
      };
    }

    // Failed to parse - fallback to v1
    return { version: 'v1', binary };
  } catch {
    // Binary not found or execution failed - fallback to v1
    return { version: 'v1', binary };
  }
}

/**
 * Execute `opencode --version` and return stdout.
 * Rejects on spawn error or non-zero exit.
 */
function execVersion(binary: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`opencode --version exited with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * Parse version string from `opencode --version` output.
 * Handles various formats:
 * - "opencode 2.1.3"
 * - "OpenCode 2.1.3"
 * - "OpenCode version 1.5.0"
 * - "v2.0.0"
 * - "2.1.3"
 */
function parseVersionOutput(output: string): string | null {
  // Try semver pattern: x.y.z
  const semverMatch = output.match(/(\d+\.\d+\.\d+)/);
  if (semverMatch && semverMatch[1]) {
    return semverMatch[1];
  }

  // Try "vX.Y.Z" format
  const vMatch = output.match(/v(\d+\.\d+\.\d+)/);
  if (vMatch && vMatch[1]) {
    return vMatch[1];
  }

  // Try major.minor only
  const shortMatch = output.match(/(\d+\.\d+)/);
  if (shortMatch) {
    return `${shortMatch[1]}.0`;
  }

  return null;
}
