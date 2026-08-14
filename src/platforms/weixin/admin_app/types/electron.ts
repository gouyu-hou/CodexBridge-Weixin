export type UpdateProgress = {
  percent?: number;
  total?: number;
  transferred?: number;
};

export type DesktopUpdateStatus = {
  available?: boolean;
  canCheck?: boolean;
  canDownload?: boolean;
  canInstall?: boolean;
  checking?: boolean;
  currentVersion?: string;
  downloaded?: boolean;
  downloading?: boolean;
  error?: string | null;
  errorCode?: string | null;
  lastCheckedAt?: string;
  latestVersion?: string;
  packaged?: boolean;
  progress?: UpdateProgress;
  reason?: string;
  releaseNotes?: string;
  supported?: boolean;
};

export type LightweightUpdateHistory = {
  action?: 'verify' | 'install' | 'failure' | 'rollback';
  at?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  fromVersion?: string | null;
  id?: string;
  keyId?: string | null;
  result?: 'success' | 'failure' | 'skipped';
  source?: string;
  stage?: string;
  timestamp?: string;
  version?: string | null;
};

export type LightweightUpdateStatus = {
  available?: boolean;
  builtInVersion?: string;
  busy?: boolean;
  canCheck?: boolean;
  canDownloadInstall?: boolean;
  canRollback?: boolean;
  checking?: boolean;
  currentRoot?: string;
  currentVersion?: string | null;
  downloading?: boolean;
  error?: string | null;
  history?: LightweightUpdateHistory[];
  historyError?: string | null;
  lastActionAt?: string;
  latestVersion?: string;
  progress?: UpdateProgress;
  supported?: boolean;
  usingLightweight?: boolean;
};

export type DesktopUpdaterBridge = {
  check: () => Promise<DesktopUpdateStatus>;
  download: () => Promise<DesktopUpdateStatus>;
  getStatus: () => Promise<DesktopUpdateStatus>;
  install: () => Promise<unknown>;
  onStatus?: (callback: (status: DesktopUpdateStatus) => void) => () => void;
};

export type LightweightUpdaterBridge = {
  check: () => Promise<LightweightUpdateStatus>;
  downloadInstall: () => Promise<LightweightUpdateStatus>;
  getStatus: () => Promise<LightweightUpdateStatus>;
  installLocal: (payload: { path: string }) => Promise<LightweightUpdateStatus>;
  pickLocal: () => Promise<{ canceled?: boolean; path?: string }>;
  rollback: () => Promise<LightweightUpdateStatus>;
};

declare global {
  interface Window {
    codexbridgeLightweightUpdater?: LightweightUpdaterBridge;
    codexbridgeUpdater?: DesktopUpdaterBridge;
  }
}
