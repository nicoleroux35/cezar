/**
 * System resource telemetry collection.
 * Monitors CPU, memory, disk usage for the dashboard and alerts.
 * 
 * Spec: .ai/specs/briefs/2026-09-20-host-resource-telemetry.md
 */

import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  SystemTelemetry,
  CpuMetrics,
  MemoryMetrics,
  DiskMetrics,
  ProcessMetrics,
  RunResource,
  SystemHealth,
} from '@open-mercato/maestro-contract';

const exec = promisify(execFile);

/** In-memory ring buffer for recent metrics */
interface MetricHistory {
  timestamp: number;
  cpu: number;
  memory: number;
  disk: number;
}

const HISTORY_SIZE = 60; // Keep last 60 data points (1 minute at 1s intervals)
const metricHistory: MetricHistory[] = [];

/**
 * Collect CPU metrics.
 * Returns usage percentage and load average.
 */
function collectCpuMetrics(): CpuMetrics {
  const cpus = os.cpus();
  const loadAvg = os.loadavg() as [number, number, number];
  
  // Calculate overall CPU usage from all cores
  let totalIdle = 0;
  let totalTick = 0;
  
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof typeof cpu.times];
    }
    totalIdle += cpu.times.idle;
  }
  
  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;
  const usage = total > 0 ? Math.min(100, Math.max(0, 100 - (idle / total) * 100)) : 0;
  
  // Per-core usage (approximation based on time spent in different states)
  const cores = cpus.map((cpu) => {
    let coreTotal = 0;
    for (const type in cpu.times) {
      coreTotal += cpu.times[type as keyof typeof cpu.times];
    }
    const coreUsage = coreTotal > 0 ? 100 - (cpu.times.idle / coreTotal) * 100 : 0;
    return Math.min(100, Math.max(0, coreUsage));
  });
  
  return {
    usage: Math.round(usage * 100) / 100,
    cores,
    count: cpus.length,
    loadAverage: loadAvg,
  };
}

/**
 * Collect memory metrics.
 * Returns total, used, free memory and usage percentage.
 */
function collectMemoryMetrics(): MemoryMetrics {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const usage = total > 0 ? (used / total) * 100 : 0;
  
  return {
    total,
    used,
    free,
    usage: Math.round(usage * 100) / 100,
    available: free,
  };
}

/**
 * Collect disk metrics for all mount points.
 * Uses 'df' command on Unix-like systems.
 */
async function collectDiskMetrics(): Promise<DiskMetrics[]> {
  try {
    const { stdout } = await exec('df', ['-k'], { timeout: 5000 });
    const lines = stdout.trim().split('\n').slice(1); // Skip header
    
    const disks: DiskMetrics[] = [];
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;

      const mount = parts[5];
      if (!mount) continue;
      // Skip special filesystems
      if (mount.startsWith('/dev') || mount.startsWith('/sys') || mount.startsWith('/proc')) {
        continue;
      }

      const totalParsed = parseInt(parts[1] ?? '', 10);
      const usedParsed = parseInt(parts[2] ?? '', 10);
      const freeParsed = parseInt(parts[3] ?? '', 10);
      const usageParsed = parseFloat((parts[4] ?? '').replace('%', ''));

      if (isNaN(totalParsed) || isNaN(usedParsed) || isNaN(freeParsed) || isNaN(usageParsed)) {
        continue;
      }

      const total = totalParsed * 1024; // Convert KB to bytes
      const used = usedParsed * 1024;
      const free = freeParsed * 1024;
      const usage = usageParsed;

      disks.push({ mount, total, used, free, usage });
    }
    
    return disks;
  } catch (err) {
    // Fallback: return root filesystem info if df fails
    return [
      {
        mount: '/',
        total: 0,
        used: 0,
        free: 0,
        usage: 0,
      },
    ];
  }
}

/**
 * Collect process-level metrics for the current Node.js process.
 */
function collectProcessMetrics(): ProcessMetrics {
  const memUsage = process.memoryUsage();
  const totalMem = os.totalmem();
  const memory = memUsage.heapUsed + memUsage.external;
  const memoryPercent = totalMem > 0 ? (memory / totalMem) * 100 : 0;
  
  return {
    pid: process.pid,
    cpu: process.cpuUsage().user / 1000000, // Convert microseconds to percentage (approximate)
    memory,
    memoryPercent: Math.round(memoryPercent * 100) / 100,
    uptime: Math.floor(process.uptime() * 1000),
  };
}

/**
 * Collect resource usage for active runs.
 * This is a placeholder - actual implementation would query RunManager.
 */
async function collectRunResources(): Promise<RunResource[]> {
  // TODO: Integrate with RunManager to get actual run resource usage
  return [];
}

/**
 * Collect complete system telemetry snapshot.
 */
export async function collectSystemTelemetry(): Promise<SystemTelemetry> {
  const [cpu, memory, disks, process, runs] = await Promise.all([
    Promise.resolve(collectCpuMetrics()),
    Promise.resolve(collectMemoryMetrics()),
    collectDiskMetrics(),
    Promise.resolve(collectProcessMetrics()),
    collectRunResources(),
  ]);
  
  const telemetry: SystemTelemetry = {
    timestamp: new Date().toISOString(),
    cpu,
    memory,
    disks,
    process,
    runs: runs.length > 0 ? runs : undefined,
    platform: {
      type: os.platform(),
      release: os.release(),
      arch: os.arch(),
    },
  };
  
  // Store in history ring buffer
  metricHistory.push({
    timestamp: Date.now(),
    cpu: cpu.usage,
    memory: memory.usage,
    disk: disks[0]?.usage ?? 0,
  });
  
  // Keep only last HISTORY_SIZE entries
  if (metricHistory.length > HISTORY_SIZE) {
    metricHistory.shift();
  }
  
  return telemetry;
}

/**
 * Get historical metrics for a time range.
 */
export function getMetricHistory(
  metric: 'cpu' | 'memory' | 'disk',
  fromMs?: number,
  toMs?: number,
): Array<{ timestamp: string; value: number }> {
  const now = Date.now();
  const from = fromMs ?? now - 60000; // Default: last 1 minute
  const to = toMs ?? now;
  
  return metricHistory
    .filter((m) => m.timestamp >= from && m.timestamp <= to)
    .map((m) => ({
      timestamp: new Date(m.timestamp).toISOString(),
      value: m[metric],
    }));
}

/**
 * Evaluate system health based on thresholds.
 */
export async function evaluateSystemHealth(thresholds: {
  cpu?: number;
  memory?: number;
  disk?: number;
}): Promise<SystemHealth> {
  const telemetry = await collectSystemTelemetry();
  const issues: SystemHealth['issues'] = [];
  
  // Check CPU threshold
  if (thresholds.cpu !== undefined && telemetry.cpu.usage > thresholds.cpu) {
    issues.push({
      severity: telemetry.cpu.usage > thresholds.cpu * 1.5 ? 'critical' : 'warning',
      metric: 'cpu',
      message: `CPU usage is ${telemetry.cpu.usage.toFixed(1)}%`,
      value: telemetry.cpu.usage,
      threshold: thresholds.cpu,
    });
  }
  
  // Check memory threshold
  if (thresholds.memory !== undefined && telemetry.memory.usage > thresholds.memory) {
    issues.push({
      severity: telemetry.memory.usage > thresholds.memory * 1.5 ? 'critical' : 'warning',
      metric: 'memory',
      message: `Memory usage is ${telemetry.memory.usage.toFixed(1)}%`,
      value: telemetry.memory.usage,
      threshold: thresholds.memory,
    });
  }
  
  // Check disk thresholds
  if (thresholds.disk !== undefined) {
    for (const disk of telemetry.disks) {
      if (disk.usage > thresholds.disk) {
        issues.push({
          severity: disk.usage > thresholds.disk * 1.2 ? 'critical' : 'warning',
          metric: 'disk',
          message: `Disk ${disk.mount} usage is ${disk.usage.toFixed(1)}%`,
          value: disk.usage,
          threshold: thresholds.disk,
        });
      }
    }
  }
  
  const status = issues.length === 0 
    ? 'healthy' 
    : issues.some((i) => i.severity === 'critical') 
    ? 'critical' 
    : 'warning';
  
  return {
    status,
    issues,
    timestamp: telemetry.timestamp,
  };
}

/**
 * Format bytes to human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
