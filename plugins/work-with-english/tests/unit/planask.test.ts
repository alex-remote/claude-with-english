import { describe, expect, test } from 'claude-code/testing'

import { askLines, planOf } from '../../hooks/features/reply/planAsk'

describe('plan and question lines (F6 › 计划和提问)', () => {
  test('a question, then each option and its description, numbered as the dialog numbers them', () => {
    const lines = askLines([
      {
        question: 'Which test framework do you prefer?',
        header: 'Test framework',
        options: [
          { label: 'Jest', description: 'Popular and batteries included' },
          { label: 'Vitest', description: 'Fast and Vite native' },
        ],
        multiSelect: false,
      },
    ])
    expect(lines).toEqual([
      { text: 'Which test framework do you prefer?', isOption: false, number: 0 },
      { text: 'Jest', isOption: true, number: 1 },
      { text: 'Popular and batteries included', isOption: true, number: 0 },
      { text: 'Vitest', isOption: true, number: 2 },
      { text: 'Fast and Vite native', isOption: true, number: 0 },
    ])
  })

  test('anything that is not a question is left out', () => {
    expect(askLines([null, 'text', { options: 'none' }])).toEqual([])
  })

  test('the plan comes with the result of the call that leaves plan mode', () => {
    expect(planOf({ plan: '## Plan\n\nAdd a README.', isAgent: false })).toBe('## Plan\n\nAdd a README.')
    expect(planOf({ plan: null, isAgent: false })).toBeNull()
    expect(planOf('denied')).toBeNull()
  })
})
