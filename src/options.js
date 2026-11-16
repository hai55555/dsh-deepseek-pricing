/**
 * Pure helpers behind the settings switches.
 *
 * The browser half and the Host half both need to agree on what a switch may
 * write, but only the Host can persist it. Keeping the rule here (instead of
 * inline in index.js) gives it one testable definition.
 */

export const ROW_ID = 'deepseek-pricing'
export const PACKAGE_NAME = 'dsh-deepseek-pricing'
export const REFRESH_MINUTES_MAX = 1440

function clampMinutes(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.min(REFRESH_MINUTES_MAX, Math.max(0, Math.round(number)))
}

/**
 * The writable subset of the row config.
 *
 * `currency` is deliberately absent: the browser owns it as a display
 * preference (localStorage plus `?currency=`), so writing it into the profile
 * patch would let the price table and the model-facing tool disagree.
 */
export function sanitizeConfigPatch(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const patch = {}
  if (typeof source.tool === 'boolean') patch.tool = source.tool
  if (typeof source.holidayRefresh === 'boolean') patch.holidayRefresh = source.holidayRefresh
  if (source.refreshMinutes !== undefined && source.refreshMinutes !== null) {
    const minutes = clampMinutes(source.refreshMinutes)
    if (minutes !== null) patch.refreshMinutes = minutes
  }
  return patch
}

/**
 * Find our own Loader entry. A row declared by a bundle patch can surface as
 * `patchId`, `id`, or only `options.id`, depending on the Loader version, so
 * every address we know is accepted and the package name is the fallback.
 */
export function findOwnEntry(editor) {
  const entries = (editor && editor.entries && editor.entries()) || []
  for (const entry of entries) {
    if (!entry) continue
    const options = entry.options || {}
    const ids = [entry.patchId, entry.id, options.id]
    const names = [entry.name, options.name]
    if (ids.includes(ROW_ID) || names.includes(PACKAGE_NAME) || names.includes(ROW_ID)) {
      return entry
    }
  }
  return null
}