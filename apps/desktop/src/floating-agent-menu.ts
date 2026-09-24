/** Catalog-driven nested native menus for overlay and background Agent models. */

import type { MenuItemConstructorOptions } from 'electron'
import type { OrbAgentModelSelection } from './orb-agent-models.ts'

/** Host-generation catalog fields the overlay model menu reads. */
export interface FloatingModelCatalog {
  readonly groups: readonly FloatingModelProviderGroup[]
}

interface FloatingModelProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly FloatingCatalogModel[]
}

interface FloatingCatalogModel {
  readonly id: string
  readonly name: string
  readonly reasoning?: {
    readonly efforts: readonly { readonly id: string; readonly name: string }[]
    readonly defaultEffort?: string
  }
}

/** Locale strings for empty catalogs and a provider-default effort row. */
export interface FloatingAgentModelMenuLabels {
  readonly empty: string
  readonly defaultEffort: string
}

/** Thinking-mode parents cannot use Electron `checked`; check items have no submenu. */
const CURRENT_MODEL_MARK = '✓ '

/**
 * Build nested model items for one Agent (provider headers, model rows, effort radios).
 * @param catalog - Host `session/modelCatalog` groups, or undefined when the load failed.
 * @param current - stored selection to check.
 * @param onSelect - persist and apply one chosen route.
 * @param labels - empty-catalog and Default-effort copy.
 * @returns submenu items; never includes an empty `submenu` array. The current
 *   thinking-mode model prefixes its label with ✓; leaf models use a checkbox.
 */
export function floatingAgentModelItems(
  catalog: FloatingModelCatalog | undefined,
  current: OrbAgentModelSelection,
  onSelect: (selection: OrbAgentModelSelection) => void,
  labels: FloatingAgentModelMenuLabels,
): MenuItemConstructorOptions[] {
  const groups = catalog?.groups ?? []
  if (groups.length === 0) return [{ label: labels.empty, enabled: false }]
  const items: MenuItemConstructorOptions[] = []
  for (const group of groups) {
    items.push({ label: group.name, enabled: false })
    for (const model of group.models) {
      items.push(modelItem(group.id, model, current, onSelect, labels.defaultEffort))
    }
  }
  return items
}

function modelItem(
  provider: string,
  model: FloatingCatalogModel,
  current: OrbAgentModelSelection,
  onSelect: (selection: OrbAgentModelSelection) => void,
  defaultEffortLabel: string,
): MenuItemConstructorOptions {
  const selected = current.provider === provider && current.model === model.id
  const efforts = effortItems(provider, model, current, onSelect, defaultEffortLabel)
  if (efforts === undefined) {
    return {
      label: model.name,
      type: 'checkbox',
      checked: selected,
      click: () => { onSelect({ provider, model: model.id }) },
    }
  }
  return {
    label: selected ? `${CURRENT_MODEL_MARK}${model.name}` : model.name,
    submenu: efforts,
  }
}

function effortItems(
  provider: string,
  model: FloatingCatalogModel,
  current: OrbAgentModelSelection,
  onSelect: (selection: OrbAgentModelSelection) => void,
  defaultEffortLabel: string,
): MenuItemConstructorOptions[] | undefined {
  const reasoning = model.reasoning
  if (reasoning === undefined) return undefined
  const selected = current.provider === provider && current.model === model.id
  const effective = selected ? current.reasoningEffort ?? reasoning.defaultEffort : undefined
  const items: MenuItemConstructorOptions[] = []
  if (reasoning.defaultEffort === undefined) {
    items.push({
      label: defaultEffortLabel,
      type: 'radio',
      checked: selected && current.reasoningEffort === undefined,
      click: () => { onSelect({ provider, model: model.id }) },
    })
  }
  for (const effort of reasoning.efforts) {
    items.push({
      label: effort.name,
      type: 'radio',
      checked: effective === effort.id,
      click: () => {
        onSelect({ provider, model: model.id, reasoningEffort: effort.id })
      },
    })
  }
  return items.length === 0 ? undefined : items
}
