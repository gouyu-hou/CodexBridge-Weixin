type AdminJson = Record<string, any>;

type AdminRequestOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
};

interface AdminElement extends HTMLElement {
  checked: boolean;
  disabled: boolean;
  files: FileList | null;
  options: HTMLOptionsCollection;
  value: string;
}

type AdminState = {
  accounts?: AdminJson[];
  closeBeacon: HTMLImageElement | null;
  currentModelProvider: AdminJson | null;
  diagnostics: AdminJson | null;
  lifecycleClosed: boolean;
  lifecycleTimer: number | null;
  pageId: string;
  pairingTimer: number | null;
  providerModelCatalogGenerations: Map<string, number>;
  providerModelCatalogPromises: Map<string, Promise<AdminJson>>;
  providerModelCatalogs: Map<string, AdminJson>;
  providerProfiles: AdminJson[];
  providerUsageProfileId: string;
  providerUsageRequestId: number;
  settingsLoaded: boolean;
  setup: AdminJson | null;
  setupAutoOpened: boolean;
  setupStep: number;
  shutdownOnClose: boolean;
  statusTimer: number | null;
  updaterStatus: AdminJson | null;
  updaterUnsubscribe: (() => void) | null;
};

interface Window {
  codexbridgeLightweightUpdater?: any;
  codexbridgeSetup?: any;
  codexbridgeUpdater?: any;
}
