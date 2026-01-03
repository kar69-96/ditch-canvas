declare module "react-grab/core" {
  export interface ReactGrabTheme {
    enabled?: boolean;
  }

  export interface ReactGrabState {
    isActive: boolean;
  }

  export interface ReactGrabConfig {
    theme?: ReactGrabTheme;
    onStateChange?: (state: ReactGrabState) => void;
  }

  export interface ReactGrabAPI {
    activate: () => void;
    deactivate: () => void;
    isActive: () => boolean;
  }

  export function init(config?: ReactGrabConfig): ReactGrabAPI;
}

