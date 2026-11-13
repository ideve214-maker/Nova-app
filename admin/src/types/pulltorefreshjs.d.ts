declare module "pulltorefreshjs" {
  export type PullToRefreshHandler = {
    destroy: () => void;
    ptrElement?: HTMLElement | null;
    mainElement?: HTMLElement | null;
  };

  export type PullToRefreshOptions = {
    distThreshold?: number;
    distMax?: number;
    distReload?: number;
    distIgnore?: number;
    mainElement?: string | Element;
    triggerElement?: string | Element;
    ptrElement?: string | Element;
    classPrefix?: string;
    cssProp?: string;
    iconArrow?: string;
    iconRefreshing?: string;
    instructionsPullToRefresh?: string;
    instructionsReleaseToRefresh?: string;
    instructionsRefreshing?: string;
    refreshTimeout?: number;
    getMarkup?: () => string;
    getStyles?: () => string;
    onInit?: (handler: PullToRefreshHandler) => void;
    onRefresh?: () => void | Promise<void>;
    resistanceFunction?: (t: number) => number;
    shouldPullToRefresh?: () => boolean;
  };

  const PullToRefresh: {
    init: (options?: PullToRefreshOptions) => PullToRefreshHandler;
    destroyAll: () => void;
  };

  export default PullToRefresh;
}
