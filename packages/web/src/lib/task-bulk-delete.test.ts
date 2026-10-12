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
  it('takes every status — the server stops an active run before deleting it', () => {
    expect(isDeletableRun(run('done', 'd'))).toBe(true)
    expect(isDeletableRun(run('failed', 'f'))).toBe(true)
    expect(isDeletableRun(run('cancelled', 'c'))).toBe(true)
    // A parked review is finished work — the same call `runActionFlags` makes.
    expect(isDeletableRun(run('review', 'r'))).toBe(true)
    // What the engine still owns is deletable too: the route cancels it and waits for its
    // release before removing the record, so the menu may offer what used to 409.
    expect(isDeletableRun(run('running', 'r'))).toBe(true)
    expect(isDeletableRun(run('queued', 'q'))).toBe(true)
    expect(isDeletableRun(run('waiting', 'w'))).toBe(true)
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
      run('running', 'r1'),
      run('queued', 'q1'),
      run('waiting', 'w1'),
    ])

    expect(statuses(options)).toEqual(['queued', 'running', 'waiting', 'done', 'failed', 'cancelled', 'review'])
    expect(options.map((option) => option.count)).toEqual([1, 1, 1, 2, 1, 3, 1])
  })

  it('omits a status with no row rather than offering a zero', () => {
    const options = statusClearOptions([run('done', 'd')])
    expect(statuses(options)).toEqual(['done'])
    expect(statusClearOptions([])).toEqual([])
  })

  it('sweeps the active rows too — the delete stops them first', () => {
    expect(deletableRuns([run('running', 'r'), run('queued', 'q'), run('waiting', 'w')])).toEqual([
      run('running', 'r'),
      run('queued', 'q'),
      run('waiting', 'w'),
    ])
  })
})
