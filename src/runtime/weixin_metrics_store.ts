import path from 'node:path';
import { JsonFileStore } from '../store/file_json/json_file_store.js';

export interface WeixinMetricsTotals {
  messagesReceived: number;
  turnsCompleted: number;
  turnsFailed: number;
  deliveriesSucceeded: number;
  deliveriesFailed: number;
  errors: number;
  pollErrors: number;
  runtimeErrors: number;
  commitErrors: number;
  totalTurnDurationMs: number;
  lastTurnDurationMs: number;
}

export type WeixinAccountMetrics = Record<string, Record<string, number>>;

export interface WeixinMetricErrorEvent {
  at: number;
  stage: string;
  message: string;
}

export interface WeixinMetricsData {
  version: 1;
  totals: WeixinMetricsTotals;
  byAccount: WeixinAccountMetrics;
  recentErrors: WeixinMetricErrorEvent[];
}

export const EMPTY_WEIXIN_METRICS_TOTALS: WeixinMetricsTotals = {
  messagesReceived: 0,
  turnsCompleted: 0,
  turnsFailed: 0,
  deliveriesSucceeded: 0,
  deliveriesFailed: 0,
  errors: 0,
  pollErrors: 0,
  runtimeErrors: 0,
  commitErrors: 0,
  totalTurnDurationMs: 0,
  lastTurnDurationMs: 0,
};

/**
 * Persists cumulative weixin runtime counters to `<stateDir>/weixin/metrics.json`
 * so usage totals survive service restarts. Writes go through JsonFileStore which
 * stages to a temp file and renames, so a crash never corrupts the metrics file.
 */
export class WeixinMetricsStore {
  constructor(stateDir: string) {
    this.store = new JsonFileStore<WeixinMetricsData>(
      path.join(stateDir, 'weixin', 'metrics.json'),
      { version: 1, totals: { ...EMPTY_WEIXIN_METRICS_TOTALS }, byAccount: {}, recentErrors: [] },
    );
  }

  store: JsonFileStore<WeixinMetricsData>;

  read(): WeixinMetricsData {
    try {
      const data = this.store.read();
      return {
        version: 1,
        totals: { ...EMPTY_WEIXIN_METRICS_TOTALS, ...(data?.totals ?? {}) },
        byAccount: isRecord(data?.byAccount) ? data.byAccount : {},
        recentErrors: normalizeRecentErrors(data?.recentErrors),
      };
    } catch {
      return { version: 1, totals: { ...EMPTY_WEIXIN_METRICS_TOTALS }, byAccount: {}, recentErrors: [] };
    }
  }

  write(
    totals: Partial<WeixinMetricsTotals>,
    byAccount: WeixinAccountMetrics = {},
    recentErrors: WeixinMetricErrorEvent[] = [],
  ): void {
    this.store.write({
      version: 1,
      totals: { ...EMPTY_WEIXIN_METRICS_TOTALS, ...totals },
      byAccount: isRecord(byAccount) ? byAccount : {},
      recentErrors: normalizeRecentErrors(recentErrors),
    });
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRecentErrors(value: unknown): WeixinMetricErrorEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const at = Number(item.at);
      if (!Number.isFinite(at) || at <= 0) {
        return null;
      }
      const stage = typeof item.stage === 'string' && item.stage.trim()
        ? item.stage.trim()
        : 'runtime';
      const message = typeof item.message === 'string' ? item.message : '';
      return {
        at,
        stage,
        message: message.slice(0, 500),
      };
    })
    .filter(Boolean) as WeixinMetricErrorEvent[];
}
