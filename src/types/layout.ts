export type IconDisplay = "icon" | "text"

export interface LayoutTab {
  id: string
  name: string
  fullPath: string
}

export interface NavigationUiState {
  headerIconDisplay: IconDisplay
  footerIconDisplay: IconDisplay
  sidebarOpen: boolean
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
