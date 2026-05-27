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
  sidebarOpen: boolean
  sidebarPinned: boolean
  leftPanelCollapsed: boolean
  rightPanelCollapsed: boolean
  bottomPanelCollapsed: boolean
  agentsSidebarVisible: boolean
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
  // Per-user, per-agent sidebar visibility. Keyed by agent id (built-in
  // ids like `_researcher` or custom Firestore doc ids). Opt-out: a
  // missing key means visible, so newly-added agents appear by default.
  // Only explicitly-toggled agents are stored; `true` is written (not the
  // key deleted) when re-showing so it overrides a remote `false` under
  // Firestore's merge semantics.
  agentVisibility?: Record<string, boolean>
}
