import { z } from 'zod';

/**
 * System monitoring and telemetry contract schemas.
 * Real-time metrics for CPU, memory, disk, and process health.
 * 
 * Spec: .ai/specs/briefs/2026-09-20-host-resource-telemetry.md
 */

/** CPU usage metrics */
export const cpuMetricsSchema = z.object({
  /** Overall CPU usage percentage (0-100) */
  usage: z.number().min(0).max(100),
  /** Per-core usage percentages */
  cores: z.array(z.number().min(0).max(100)).optional(),
  /** Number of CPU cores */
  count: z.number().int().positive(),
  /** Load average (1, 5, 15 minutes) */
  loadAverage: z.tuple([z.number(), z.number(), z.number()]).optional(),
});
export type CpuMetrics = z.infer<typeof cpuMetricsSchema>;

/** Memory usage metrics */
export const memoryMetricsSchema = z.object({
  /** Total memory in bytes */
  total: z.number().int().nonnegative(),
  /** Used memory in bytes */
  used: z.number().int().nonnegative(),
  /** Free memory in bytes */
  free: z.number().int().nonnegative(),
  /** Memory usage percentage (0-100) */
  usage: z.number().min(0).max(100),
  /** Available memory in bytes (free + buffers + cache) */
  available: z.number().int().nonnegative().optional(),
});
export type MemoryMetrics = z.infer<typeof memoryMetricsSchema>;

/** Disk usage metrics for one mount point */
export const diskMetricsSchema = z.object({
  /** Mount point path */
  mount: z.string(),
  /** Total disk space in bytes */
  total: z.number().int().nonnegative(),
  /** Used disk space in bytes */
  used: z.number().int().nonnegative(),
  /** Free disk space in bytes */
  free: z.number().int().nonnegative(),
  /** Disk usage percentage (0-100) */
  usage: z.number().min(0).max(100),
});
export type DiskMetrics = z.infer<typeof diskMetricsSchema>;

/** Process-level metrics */
export const processMetricsSchema = z.object({
  /** Process ID */
  pid: z.number().int().positive(),
  /** CPU usage percentage (0-100+) */
  cpu: z.number().nonnegative(),
  /** Memory usage in bytes */
  memory: z.number().int().nonnegative(),
  /** Memory usage percentage (0-100) */
  memoryPercent: z.number().min(0).max(100),
  /** Uptime in milliseconds */
  uptime: z.number().int().nonnegative(),
});
export type ProcessMetrics = z.infer<typeof processMetricsSchema>;

/** Active run resource usage */
export const runResourceSchema = z.object({
  /** Run ID */
  runId: z.string(),
  /** Task title */
  title: z.string(),
  /** CPU usage percentage */
  cpu: z.number().nonnegative().optional(),
  /** Memory usage in bytes */
  memory: z.number().int().nonnegative().optional(),
  /** Running time in milliseconds */
  duration: z.number().int().nonnegative(),
});
export type RunResource = z.infer<typeof runResourceSchema>;

/** Complete system telemetry snapshot */
export const systemTelemetrySchema = z.object({
  /** Timestamp of this snapshot (ISO-8601) */
  timestamp: z.string(),
  /** CPU metrics */
  cpu: cpuMetricsSchema,
  /** Memory metrics */
  memory: memoryMetricsSchema,
  /** Disk metrics (all mount points) */
  disks: z.array(diskMetricsSchema),
  /** cezar server process metrics */
  process: processMetricsSchema,
  /** Active runs resource usage */
  runs: z.array(runResourceSchema).optional(),
  /** Platform/OS information */
  platform: z.object({
    type: z.string(),
    release: z.string(),
    arch: z.string(),
  }).optional(),
});
export type SystemTelemetry = z.infer<typeof systemTelemetrySchema>;

/** Historical metrics data point */
export const metricDataPointSchema = z.object({
  /** Timestamp (ISO-8601) */
  timestamp: z.string(),
  /** Metric value */
  value: z.number(),
});
export type MetricDataPoint = z.infer<typeof metricDataPointSchema>;

/** Historical metrics response */
export const metricsHistorySchema = z.object({
  /** Metric name */
  metric: z.string(),
  /** Time range start (ISO-8601) */
  from: z.string(),
  /** Time range end (ISO-8601) */
  to: z.string(),
  /** Data points */
  data: z.array(metricDataPointSchema),
  /** Whether data was truncated */
  truncated: z.boolean().optional(),
});
export type MetricsHistory = z.infer<typeof metricsHistorySchema>;

/** Response for GET /api/v1/monitoring/system */
export const systemTelemetryResponseSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(true),
    telemetry: systemTelemetrySchema,
  }),
  z.object({
    available: z.literal(false),
    reason: z.string(),
  }),
]);
export type SystemTelemetryResponse = z.infer<typeof systemTelemetryResponseSchema>;

/** Alert threshold configuration */
export const alertThresholdSchema = z.object({
  /** Alert when CPU exceeds this percentage */
  cpu: z.number().min(0).max(100).optional(),
  /** Alert when memory exceeds this percentage */
  memory: z.number().min(0).max(100).optional(),
  /** Alert when any disk exceeds this percentage */
  disk: z.number().min(0).max(100).optional(),
});
export type AlertThreshold = z.infer<typeof alertThresholdSchema>;

/** System health status */
export const systemHealthSchema = z.object({
  status: z.enum(['healthy', 'warning', 'critical']),
  issues: z.array(z.object({
    severity: z.enum(['warning', 'critical']),
    metric: z.string(),
    message: z.string(),
    value: z.number(),
    threshold: z.number(),
  })),
  timestamp: z.string(),
});
export type SystemHealth = z.infer<typeof systemHealthSchema>;
