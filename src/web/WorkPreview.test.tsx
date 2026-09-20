import { expect, test } from 'bun:test'
import { confirmAnnotationReplacement, parseTaskPreviewHref, pinPreviewVersion, reportScrollKey, resolveReportVersion, type PreviewArtifact } from './WorkPreview'

const taskId = '11111111-1111-4111-8111-111111111111'
const oldVersion = '22222222-2222-4222-8222-222222222222'
const latestVersion = '33333333-3333-4333-8333-333333333333'
const reports: PreviewArtifact[] = [
  { kind: 'report', versionId: latestVersion, runId: 'run-new', runStatus: 'succeeded', createdAt: '2026-09-20T01:00:00Z', name: 'report.md' },
  { kind: 'report', versionId: oldVersion, runId: 'run-old', runStatus: 'succeeded', createdAt: '2026-09-19T01:00:00Z', name: 'report.md' },
]

test('task links become previews while external and non-task links retain normal navigation', () => {
  expect(parseTaskPreviewHref(`/tasks/${taskId}`, 'https://agent.example')).toEqual({ taskId })
  expect(parseTaskPreviewHref(`/tasks/${taskId}?version=${oldVersion}`, 'https://agent.example')).toEqual({ taskId, versionId: oldVersion })
  expect(parseTaskPreviewHref('https://other.example/tasks/' + taskId, 'https://agent.example')).toBeNull()
  expect(parseTaskPreviewHref('/tasks', 'https://agent.example')).toBeNull()
})

test('an explicit unknown report version never falls back to the latest report', () => {
  expect(resolveReportVersion(reports)).toEqual({ artifact: reports[0] })
  expect(resolveReportVersion(reports, oldVersion)).toEqual({ artifact: reports[1] })
  expect(resolveReportVersion(reports, '44444444-4444-4444-8444-444444444444')).toEqual({ error: '指定报告版本不存在或不属于当前工作。' })
})

test('the first resolved report is pinned before later refreshes can change the preview target', () => {
  expect(pinPreviewVersion({ taskId }, reports[0])).toEqual({ taskId, versionId: latestVersion })
  expect(pinPreviewVersion({ taskId, versionId: oldVersion }, reports[0])).toBeNull()
})

test('reading position is isolated by task and immutable report version', () => {
  expect(reportScrollKey(taskId, oldVersion)).not.toBe(reportScrollKey(taskId, latestVersion))
  expect(reportScrollKey(taskId, oldVersion)).not.toBe(reportScrollKey('55555555-5555-4555-8555-555555555555', oldVersion))
})

test('a new selection cannot replace an unfinished note without confirmation', () => {
  expect(confirmAnnotationReplacement('', () => false)).toBe(true)
  expect(confirmAnnotationReplacement('未保存意见', () => false)).toBe(false)
  expect(confirmAnnotationReplacement('未保存意见', () => true)).toBe(true)
})
