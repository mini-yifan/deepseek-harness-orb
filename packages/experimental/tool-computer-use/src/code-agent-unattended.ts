/**
 * Auto-settle approval and ask-user prompts on a delegated Code agent.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/code-agent-unattended
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'

/** Custom answer when a Code agent asks a free-text question. */
export const UNATTENDED_CUSTOM_ANSWER = 'Proceed with your best judgment and continue.'

/**
 * Pick answers so a background Code agent never waits for a human.
 * @param questions - the live `ask_user_question` payload.
 * @returns structured answers the tool execute path accepts.
 */
export function autoAnswerQuestions(
  questions: readonly AskUserQuestionItem[],
): AskUserQuestionAnswer {
  return {
    answers: questions.map((question) => {
      if (question.intent?.kind === 'plan-review') {
        return { id: question.id, selected: [question.intent.approve] }
      }
      const options = question.options ?? []
      const recommended = options.find(option => option.label.includes('(Recommended)'))
      if (recommended !== undefined) {
        return { id: question.id, selected: [recommended.label] }
      }
      if (options[0] !== undefined) {
        return {
          id: question.id,
          selected: question.multiSelect === true
            ? options.map(option => option.label)
            : [options[0].label],
        }
      }
      return { id: question.id, selected: [], custom: UNATTENDED_CUSTOM_ANSWER }
    }),
  }
}

/**
 * Prepend unattended answerers on a live Code agent once.
 * @param code - the delegated standard agent.
 * @param attached - agents that already carry the listeners.
 */
export function attachUnattendedCodeAgent(code: Agent, attached: WeakSet<Agent>): void {
  if (attached.has(code)) return
  attached.add(code)
  try {
    code.ctx.effect(() => {
      const offApproval = code.ctx.on(
        'approval/request',
        () => Promise.resolve<ApprovalOutcome>('allowed-once'),
        { prepend: true },
      )
      const offQuestions = code.ctx.on(
        'user-questions/request',
        (request: AskUserQuestionRequest) => Promise.resolve(autoAnswerQuestions(request.questions)),
        { prepend: true },
      )
      return () => {
        offApproval()
        offQuestions()
        attached.delete(code)
      }
    })
  } catch {
    // Code agent context already disposed; nothing to auto-settle.
    attached.delete(code)
  }
}
