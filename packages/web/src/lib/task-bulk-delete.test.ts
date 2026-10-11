import type { RunRecord } from '@open-mercato/cezar-api-client'
import { describe, expect, it } from 'vitest'

import {
  deletableRuns,
  isDeletableRun,
  statusClearOptions,
  type StatusClearOption,
} from './task-bulk-delete'

function run(status: RunRecord['status'], id: string): RunRecord {
  return { id, status } as RunRecord
}

const statuses = (options: readonly StatusClearOption[]) => options.map((option) => option.status)

describe('isDeletableRun', () => {
  it('takes the four statuses the engine no longer owns', () => {
    expect(isDeletableRun(run('done', 'd'))).toBe(true)
    expect(isDeletableRun(run('failed', 'f'))).toBe(true)
    expect(isDeletableRun(run('cancelled', 'c'))).toBe(true)
    // A parked review is finished work — the same call `runActionFlags` makes.
    expect(isDeletableRun(run('review', 'r'))).toBe(true)
  })

  it('refuses everything the engine still owns — the server would answer 409', () => {
    expect(isDeletableRun(run('running', 'r'))).toBe(false)
    expect(isDeletableRun(run('queued', 'q'))).toBe(false)
    expect(isDeletableRun(run('waiting', 'w'))).toBe(false)
  })
})

describe('statusClearOptions', () => {
  it('counts one entry per deletable status present, in the menu order', () => {
    const options = statusClearOptions([
      run('failed', 'f1'),
      run('done', 'd1'),
      run('done', 'd2'),
      run('review', 'r1'),
      run('cancelled', 'c1'),
      run('cancelled', 'c2'),
      run('cancelled', 'c3'),
    ])

    expect(statuses(options)).toEqual(['done', 'failed', 'cancelled', 'review'])
    expect(options.map((option) => option.count)).toEqual([2, 1, 3, 1])
  })

  it('omits a status with no row rather than offering a zero', () => {
    const options = statusClearOptions([run('done', 'd')])
    expect(statuses(options)).toEqual(['done'])
    expect(statusClearOptions([])).toEqual([])
  })

  it('never offers a status the delete would be refused for', () => {
    expect(statusClearOptions([run('running', 'r'), run('queued', 'q'), run('waiting', 'w')])).toEqual([])
    // …and the rows behind them are not swept by the "everything" count either.
    expect(deletableRuns([run('running', 'r'), run('queued', 'q'), run('waiting', 'w')])).toEqual([])
  })
})
