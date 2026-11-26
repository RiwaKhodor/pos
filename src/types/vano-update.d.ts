export type VanoUpdateState = {
  status: "checking" | "none" | "downloading" | "ready" | "error";
  version: string | null;
  current: string;
};

declare global {
  interface Window {
    vanoDesktop?: {
      electron: boolean;
      platform: string;
    };
    vanoUpdate?: {
      getState: () => Promise<VanoUpdateState>;
      install: () => Promise<boolean>;
      onChange: (callback: (state: VanoUpdateState) => void) => () => void;
    };
  }
}

export {};
