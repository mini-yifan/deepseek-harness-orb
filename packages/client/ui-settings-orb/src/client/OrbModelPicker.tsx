/** Compact model picker: a pill trigger and a portaled Menu with effort submenus. */

import { useEffect, useState, type ReactNode } from 'react'
import {
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrbAgentModelSelection } from './desktop-api.ts'
import type { OrbCatalogModel, OrbModelCatalog } from './section-store.ts'
import css from './OrbSettingsSection.module.css'

/** Props for one Floating-ball Agent or Background Agent picker. */
export interface OrbModelPickerProps {
  /** Accessible name so the two pickers do not share a control label. */
  label: string
  catalog: OrbModelCatalog | undefined
  current: OrbAgentModelSelection
  disabled: boolean
  emptyLabel: string
  defaultEffortLabel: string
  onSelect: (selection: OrbAgentModelSelection) => void
}

/**
 * Render a dropdown of catalog models; thinking models expose an effort submenu.
 * @param props - catalog, current selection, and the persist callback.
 * @returns the trigger, or the empty-catalog line.
 */
export function OrbModelPicker(props: OrbModelPickerProps): ReactNode {
  const groups = props.catalog?.groups ?? []
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (props.disabled) setOpen(false)
  }, [props.disabled])

  if (groups.length === 0) {
    return <p className={css.empty}>{props.emptyLabel}</p>
  }

  const currentModel = findCatalogModel(groups, props.current)
  const modelLabel = currentModel?.name ?? props.current.model
  const effortLabel = currentEffortLabel(currentModel, props.current, props.defaultEffortLabel)
  const items = catalogMenuItems(groups, props.current, props.defaultEffortLabel)
  const selectedId = modelRowId(props.current.provider, props.current.model)

  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={items}
      selectedId={selectedId}
      onSelect={(id) => {
        setOpen(false)
        props.onSelect(parseMenuPick(id))
      }}
      align="end"
      portal
      anchor={(
        <button
          type="button"
          className={css.trigger}
          aria-label={props.label}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={props.disabled}
          onClick={() => { setOpen(value => !value) }}
        >
          <span className={css.triggerLabel}>{modelLabel}</span>
          {effortLabel === undefined ? null : <span className={css.triggerEffort}>{effortLabel}</span>}
          <IconChevronDownOutlineRegular className={css.chevron} />
        </button>
      )}
    />
  )
}

function findCatalogModel(
  groups: OrbModelCatalog['groups'],
  current: OrbAgentModelSelection,
): OrbCatalogModel | undefined {
  for (const group of groups) {
    if (group.id !== current.provider) continue
    const model = group.models.find(entry => entry.id === current.model)
    if (model !== undefined) return model
  }
  return undefined
}

function currentEffortLabel(
  model: OrbCatalogModel | undefined,
  current: OrbAgentModelSelection,
  defaultEffortLabel: string,
): string | undefined {
  const reasoning = model?.reasoning
  if (reasoning === undefined) return undefined
  const effective = current.reasoningEffort ?? reasoning.defaultEffort
  if (effective === undefined) return defaultEffortLabel
  return reasoning.efforts.find(effort => effort.id === effective)?.name ?? effective
}

function catalogMenuItems(
  groups: OrbModelCatalog['groups'],
  current: OrbAgentModelSelection,
  defaultEffortLabel: string,
): MenuEntry[] {
  const items: MenuEntry[] = []
  for (const group of groups) {
    items.push({ type: 'label', id: `group:${group.id}`, text: group.name })
    for (const model of group.models) {
      items.push(modelMenuItem(group.id, model, current, defaultEffortLabel))
    }
  }
  return items
}

function modelMenuItem(
  provider: string,
  model: OrbCatalogModel,
  current: OrbAgentModelSelection,
  defaultEffortLabel: string,
): MenuEntry {
  const selected = current.provider === provider && current.model === model.id
  const efforts = model.reasoning?.efforts ?? []
  if (efforts.length === 0) {
    return { id: modelRowId(provider, model.id), label: model.name }
  }
  const submenu = [
    ...model.reasoning?.defaultEffort === undefined
      ? [{
        id: effortRowId(provider, model.id, undefined),
        label: defaultEffortLabel,
        ...selected && current.reasoningEffort === undefined
          ? { icon: <IconCheckOutlineRegular /> }
          : {},
      }]
      : [],
    ...efforts.map((effort) => {
      const effective = current.reasoningEffort ?? model.reasoning?.defaultEffort
      return {
        id: effortRowId(provider, model.id, effort.id),
        label: effort.name,
        ...selected && effective === effort.id ? { icon: <IconCheckOutlineRegular /> } : {},
      }
    }),
  ]
  return { id: modelRowId(provider, model.id), label: model.name, submenu }
}

function modelRowId(provider: string, model: string): string {
  return `model\t${provider}\t${model}`
}

function effortRowId(provider: string, model: string, effort: string | undefined): string {
  return `effort\t${provider}\t${model}\t${effort ?? ''}`
}

function parseMenuPick(id: string): OrbAgentModelSelection {
  const [, provider = '', model = '', effort] = id.split('\t')
  return effort === undefined || effort === ''
    ? { provider, model }
    : { provider, model, reasoningEffort: effort }
}
