export interface IEntity {
  readonly id: string
}

export interface IOptimisticOptions {
  readonly showSuccessToast?: boolean
  readonly showErrorToast?: boolean
  readonly successMessage?: string
  readonly errorMessage?: string
}

export interface IPendingState {
  readonly pendingIds: ReadonlySet<string>
}
