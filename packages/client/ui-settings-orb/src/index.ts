/**
 * Floating-ball Settings plugin, node half. The empty apply exists so the
 * plugin appears in the Desktop Host Loader; the browser half ships via
 * exports["./client"]. Overlay preferences stay in the Desktop profile, not
 * Host settings.yaml.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
