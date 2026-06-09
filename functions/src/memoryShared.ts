/**
 * Memory — pure, Firebase-free helpers.
 *
 * Everything here is dependency-light (no Firebase, no Genkit, no Vue) so it can
 * be unit-tested with `node --test --experimental-strip-types` (the `botTurn.ts`
 * precedent). The callables (`memory.ts`) and the recall path (`memoryRag.ts`)
 * compose these; later phases append the hybrid-rank scorer / recency decay /
 * dedup-threshold / visibility filter here.
 */

// ---------------------------------------------------------------------------
// Input bounds
// ---------------------------------------------------------------------------

/**
 * Max bytes of memory `content`. Deliberately equal to `MAX_EMBED_INPUT_BYTES`
 * in `botRag.ts` (30 KB) — keeping them equal means a memory is never longer
 * than what we embed, so the whole memory (not just a head) carries retrieval
 * signal. Not imported from `botRag.ts` to keep this module Firebase-free.
 */
export const MEMORY_CONTENT_MAX = 30_000
export const MEMORY_SUMMARY_MAX = 1_000
export const MEMORY_TAG_MAX = 64
export const MEMORY_MAX_TAGS = 32

export const IMPORTANCE_MIN = 0
export const IMPORTANCE_MAX = 100
export const IMPORTANCE_DEFAULT = 50

/**
 * Coerce any importance into the inclusive [0, 100] range; never throws.
 * Callables keep their input schema permissive and clamp here (the same
 * discipline as `clampSearchLimit` in botRag), so a model- or client-supplied
 * out-of-range / fractional value is harmless rather than a turn-aborting
 * `INVALID_ARGUMENT`.
 */
export function clampImportance(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw))
    return IMPORTANCE_DEFAULT
  return Math.min(IMPORTANCE_MAX, Math.max(IMPORTANCE_MIN, Math.round(raw)))
}

/**
 * Normalize a tag list: trim, drop empties, de-duplicate (case-insensitive,
 * keeping first spelling), cap each tag's length and the total count. Returns a
 * fresh array (possibly empty). Used by every write path so tags are uniform.
 */
export function normalizeTags(raw: readonly string[] | undefined): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of raw) {
    if (typeof value !== "string") continue
    const trimmed = value.trim().slice(0, MEMORY_TAG_MAX)
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
    if (out.length >= MEMORY_MAX_TAGS) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Recall — ranking, recency, visibility, dedup (spec §5 / §15.5)
// ---------------------------------------------------------------------------

/**
 * Hybrid-rank weights (spec §15.5, tunable). Similarity dominates; recency and
 * importance nudge; a pin adds a flat bonus that can lift a slightly-less-similar
 * but explicitly-important memory above the pack.
 */
export const RECALL_W_SIM = 0.6
export const RECALL_W_RECENCY = 0.15
export const RECALL_W_IMPORTANCE = 0.15
export const RECALL_PINNED_BONUS = 0.1

/**
 * Cosine-distance cutoff for "plausibly relevant" — reused verbatim from
 * `botRag`'s `RELEVANCE_DISTANCE_THRESHOLD` (0.55). A copy (not an import) keeps
 * this module Firebase-free; the recall path asserts they agree.
 */
export const RECALL_RELEVANCE_DISTANCE = 0.55

/**
 * Near-duplicate cutoff for dedup/merge at create/extract time — far tighter
 * than the relevance threshold so only genuinely-redundant memories collapse.
 */
export const NEAR_DUP_DISTANCE = 0.12

/** Half-life (days) of the recency boost: a memory's recency factor halves every N days. */
export const RECENCY_HALFLIFE_DAYS = 30

const MS_PER_DAY = 86_400_000

/**
 * Recency factor in (0, 1]: 1 for a just-updated memory, 0.5 at one half-life,
 * trending toward 0 for old memories. `0` when the timestamp is unknown.
 */
export function recencyDecay(
  updatedAtMillis: number,
  nowMillis: number
): number {
  if (!updatedAtMillis || updatedAtMillis <= 0) return 0
  const ageDays = Math.max(0, (nowMillis - updatedAtMillis) / MS_PER_DAY)
  return Math.pow(0.5, ageDays / RECENCY_HALFLIFE_DAYS)
}

export interface HybridRankInputs {
  /** Cosine distance in [0, 2] (1 − cosine similarity). */
  distance: number
  updatedAtMillis: number
  /** 0–100 (clamped). */
  importance: number
  pinned: boolean
  nowMillis: number
}

/**
 * Weighted recall score (higher = better). Similarity is mapped from cosine
 * distance to [0, 1] via `1 − distance/2`; importance is normalized to [0, 1];
 * recency decays by half-life; a pin adds a flat bonus.
 */
export function hybridScore(inputs: HybridRankInputs): number {
  const sim = 1 - inputs.distance / 2
  return (
    RECALL_W_SIM * sim +
    RECALL_W_RECENCY * recencyDecay(inputs.updatedAtMillis, inputs.nowMillis) +
    RECALL_W_IMPORTANCE * (clampImportance(inputs.importance) / 100) +
    (inputs.pinned ? RECALL_PINNED_BONUS : 0)
  )
}

export interface VisibilityCandidate {
  ownerUid?: string
  visibility?: string
  archived?: boolean
}

/**
 * Recall-side visibility gate — STRICTER than the Firestore rules on purpose
 * (spec §5, gotcha #6): rules let a team admin read any memory for the
 * management UI, but recall must NEVER inject another member's `private` memory
 * into a prompt. So: drop archived, keep iff the acting human owns it OR it is
 * `"shared"`. A missing `visibility` is treated as private (no match).
 */
export function isRecallable(
  candidate: VisibilityCandidate,
  actingUid: string
): boolean {
  if (candidate.archived === true) return false
  return candidate.ownerUid === actingUid || candidate.visibility === "shared"
}

/** True when a cosine distance is tight enough to count as a near-duplicate. */
export function isNearDuplicate(distance: number): boolean {
  return Number.isFinite(distance) && distance < NEAR_DUP_DISTANCE
}
