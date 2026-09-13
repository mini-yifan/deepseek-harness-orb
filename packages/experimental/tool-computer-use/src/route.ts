/**
 * Image-modality checks for Computer Use tools and first-frame attachment.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/route
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

import type {} from '@deepseek-ai/dsh-llm'

interface ResolvedRoute {
  readonly provider: string
  readonly model: string
}

/**
 * Resolve the calling agent's latest provider/model from the request header, then agent options.
 * @param agent - calling agent, when any.
 * @returns the route ids, or undefined when they cannot be resolved.
 */
export function resolveAgentRoute(agent: Agent | undefined): ResolvedRoute | undefined {
  const routed = agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? agent?.options.provider
  const model = routed?.model ?? agent?.options.model
  if (provider === undefined || model === undefined) return undefined
  return { provider, model }
}

/**
 * Whether the agent's exact route declares image input.
 * @param ctx - plugin context; `llm` is optional.
 * @param agent - calling agent, when any.
 * @param signal - cooperative cancellation.
 * @returns true only when the resolved model lists `image`.
 */
export async function routeAcceptsImages(
  ctx: Context,
  agent: Agent | undefined,
  signal: AbortSignal,
): Promise<boolean> {
  const route = resolveAgentRoute(agent)
  const llm = ctx.get('llm')
  if (route === undefined || llm === undefined) return false
  const active = await llm.resolveModelInfo(route.provider, route.model, signal)
  return active.inputModalities !== undefined && active.inputModalities.includes('image')
}

/**
 * Refuse a GUI tool unless the calling route declares image input.
 * @param ctx - plugin context used to resolve the optional `llm` service.
 * @param exec - tool-execution context supplying the calling agent.
 * @throws when the route cannot be resolved or does not declare image input.
 */
export async function assertImageCapableRoute(ctx: Context, exec: ToolExecution): Promise<void> {
  const route = resolveAgentRoute(exec.agent)
  const llm = ctx.get('llm')
  if (route === undefined || llm === undefined) {
    throw new Error('cannot use computer-use tools: the current model route could not be resolved')
  }
  const active = await llm.resolveModelInfo(route.provider, route.model, exec.signal)
  if (active.inputModalities === undefined || !active.inputModalities.includes('image')) {
    throw new Error(
      `cannot use computer-use tools: model "${route.model}" does not declare image input; switch to an image-capable model`,
    )
  }
}
