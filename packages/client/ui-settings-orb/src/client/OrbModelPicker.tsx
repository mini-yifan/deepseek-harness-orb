/** Exclusive model+effort picker matching the floating-ball native menu. */

import type { ReactNode } from 'react'
import type { OrbAgentModelSelection } from './desktop-api.ts'
import type { OrbCatalogModel, OrbModelCatalog } from './section-store.ts'
import css from './OrbSettingsSection.module.css'

/** Props for one overlay or background Agent picker. */
export interface OrbModelPickerProps {
  /** Radio-group prefix so overlay and background do not share names. */
  prefix: string
  catalog: OrbModelCatalog | undefined
  current: OrbAgentModelSelection
  disabled: boolean
  emptyLabel: string
  defaultEffortLabel: string
  onSelect: (selection: OrbAgentModelSelection) => void
}

/**
 * Render provider-grouped model radios, with nested effort radios for thinking models.
 * @param props - catalog, current selection, and the persist callback.
 * @returns the picker, or the empty-catalog line.
 */
export function OrbModelPicker(props: OrbModelPickerProps): ReactNode {
  const groups = props.catalog?.groups ?? []
  if (groups.length === 0) {
    return <p className={css.empty}>{props.emptyLabel}</p>
  }
  return (
    <div className={css.catalog}>
      {groups.map(group => (
        <div key={group.id} className={css.group}>
          <h4 className={css.groupHead}>{group.name}</h4>
          <ul className={css.models}>
            {group.models.map(model => (
              <li key={model.id}>
                {model.reasoning === undefined
                  ? (
                    <label className={css.model}>
                      <input
                        type="radio"
                        name={`${props.prefix}-model`}
                        checked={props.current.provider === group.id && props.current.model === model.id}
                        disabled={props.disabled}
                        onChange={() => { props.onSelect({ provider: group.id, model: model.id }) }}
                      />
                      <span>{model.name}</span>
                    </label>
                  )
                  : (
                    <ThinkingModel
                      prefix={props.prefix}
                      provider={group.id}
                      model={model}
                      reasoning={model.reasoning}
                      current={props.current}
                      disabled={props.disabled}
                      defaultEffortLabel={props.defaultEffortLabel}
                      onSelect={props.onSelect}
                    />
                  )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function ThinkingModel(props: {
  prefix: string
  provider: string
  model: OrbCatalogModel
  reasoning: NonNullable<OrbCatalogModel['reasoning']>
  current: OrbAgentModelSelection
  disabled: boolean
  defaultEffortLabel: string
  onSelect: (selection: OrbAgentModelSelection) => void
}): ReactNode {
  const reasoning = props.reasoning
  const selected = props.current.provider === props.provider && props.current.model === props.model.id
  const effective = selected ? props.current.reasoningEffort ?? reasoning.defaultEffort : undefined
  const groupName = `${props.prefix}-effort-${props.provider}-${props.model.id}`
  return (
    <div className={css.thinking}>
      <div className={css.thinkingName}>{props.model.name}</div>
      <div className={css.efforts}>
        {reasoning.defaultEffort === undefined
          ? (
            <label className={css.effort}>
              <input
                type="radio"
                name={groupName}
                checked={selected && props.current.reasoningEffort === undefined}
                disabled={props.disabled}
                onChange={() => { props.onSelect({ provider: props.provider, model: props.model.id }) }}
              />
              <span>{props.defaultEffortLabel}</span>
            </label>
          )
          : null}
        {reasoning.efforts.map(effort => (
          <label key={effort.id} className={css.effort}>
            <input
              type="radio"
              name={groupName}
              checked={effective === effort.id}
              disabled={props.disabled}
              onChange={() => {
                props.onSelect({
                  provider: props.provider,
                  model: props.model.id,
                  reasoningEffort: effort.id,
                })
              }}
            />
            <span>{effort.name}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
