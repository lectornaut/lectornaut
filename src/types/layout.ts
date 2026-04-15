export type IconDisplay = "icon" | "text"
export type TabIndicatorTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"

export interface LayoutTab {
  id: string
  name: string
  fullPath: string
  pinned?: boolean
}

export interface LayoutTabIndicator {
  label: string
  tone?: TabIndicatorTone
  pulse?: boolean
  spin?: boolean
}

export interface NavigationUiState {
  headerIconDisplay: IconDisplay
  footerIconDisplay: IconDisplay
  sidebarOpen: boolean
  sidebarPinned: boolean
  leftPanelCollapsed: boolean
  rightPanelCollapsed: boolean
  bottomPanelCollapsed: boolean
}

export interface LayoutTabsDoc {
  tabs?: LayoutTab[]
  active?: string
  recentlyClosed?: LayoutTab[]
}

export interface LayoutNavigationDoc {
  visibleItems?: Record<string, boolean>
  order?: string[]
  ui?: Partial<NavigationUiState>
}
