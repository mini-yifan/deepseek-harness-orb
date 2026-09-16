/** Host-backed completed-Turn transcript presentation policy. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_TRANSCRIPT_VIEW_MODE, TRANSCRIPT_VIEW_FIELD,
  type ChatSettings, type TranscriptViewMode,
} from '../chat-settings.ts'

/** Live transcript preference consumed by Chat and its Settings row. */
export class TranscriptViewPolicy {
  /** Reactive current mode; defaults to Compact before Host settings arrive. */
  readonly mode: SnapshotStore<TranscriptViewMode> = createSnapshotStore(DEFAULT_TRANSCRIPT_VIEW_MODE)

  /**
   * @param host - durable Chat settings scope.
   * @param forceCompact - overlay iframe: Compact regardless of Host Settings.
   */
  constructor(
    private readonly host: SettingsScope<ChatSettings>,
    private readonly forceCompact = false,
  ) {
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish and persist one explicit user choice.
   * @param mode - Normal or Compact transcript presentation.
   */
  setMode(mode: TranscriptViewMode): void {
    if (this.forceCompact) return
    if (this.mode.getSnapshot() === mode) return
    this.mode.set(mode)
    void this.host.set(TRANSCRIPT_VIEW_FIELD, mode)
  }

  /** Adopt the latest accepted Host section without writing it back. */
  private adopt(): void {
    if (this.forceCompact) return
    const section = this.host.getSnapshot().value
    if (section === undefined || this.mode.getSnapshot() === section.transcriptView) return
    this.mode.set(section.transcriptView)
  }
}
