export type Result<T, E = Error> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E }

export function success<T>(data: T): Result<T, never> {
  return { success: true, data }
}

export function failure<E = Error>(error: E): Result<never, E> {
  return { success: false, error }
}
