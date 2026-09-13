/**
 * Model-facing Computer Use guidance registered as one system-prompt section.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/policy
 */

/**
 * Stable Computer Use policy text assembled into every request while this plugin is mounted.
 */
export const POLICY = `Computer Use lets you see the current desktop and operate the GUI.

See: trust only the attached desktop screenshots. Do not assume windows, buttons, or text that are not visible in the latest image.

Coordinates: each screen uses a 0–1000 space. Pass position as [x, y] in that space together with screen_index. When a result envelope names downscale multipliers, convert attached-image pixels with those multipliers before choosing coordinates. Do not send raw pixel coordinates.

Step: take exactly one GUI action per tool call. After the call, the new screenshot is in the tool result; use that image for the next action.

Do not click or type into a target you cannot see. Do not read file paths off the screen for bash or filesystem tools; use those tools with real paths.

Observation is not a tool. There is no screenshot or observe call. The first user turn already includes the current screens, and every GUI tool returns the post-action screens.

This session drives the real unsandboxed desktop. Prefer bash and filesystem tools for files and terminals.`
