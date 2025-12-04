import { useEffect, useState } from 'react'
import { getAssignments } from '@/lib/api/assignments'
import { removeAssignmentOverride, setAssignmentOverride } from '@/lib/api/overrides'
import type { Assignment, SubmissionStatus } from '@/types/api'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

type AsyncState<T> = {
  loading: boolean
  error: string | null
  data: T
}

const STATUS_OPTIONS: SubmissionStatus[] = ['submitted', 'unsubmitted', 'graded', 'missing']

function formatDate(date: string | null) {
  if (!date) return '—'
  const parsed = new Date(date)
  if (Number.isNaN(parsed.valueOf())) return '—'
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function App() {
  const [assignmentsState, setAssignmentsState] = useState<AsyncState<Assignment[]>>({
    loading: true,
    error: null,
    data: [],
  })
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [authState, setAuthState] = useState<{
    status: 'idle' | 'logging-in' | 'checking' | 'logged-in' | 'error'
    sessionToken?: string
    user?: any
    error?: string
  }>({ status: 'idle' })

  useEffect(() => {
    refreshAssignments()
  }, [])

  // Poll for login status when logging in
  useEffect(() => {
    if (authState.status !== 'logging-in' || !authState.sessionToken) return

    let intervalId: NodeJS.Timeout
    let attempts = 0
    const maxAttempts = 600 // 5 minutes @ 500ms

    const checkStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/canvas/status/${authState.sessionToken}`)
        if (!res.ok) throw new Error('Status check failed')
        const data = await res.json()
        if (data.completed) {
          setAuthState({
            status: 'logged-in',
            sessionToken: authState.sessionToken,
            user: data.userInfo,
          })
          clearInterval(intervalId)
        }
      } catch (e) {
        attempts++
        if (attempts >= maxAttempts) {
          setAuthState({ status: 'error', error: 'Login timeout' })
          clearInterval(intervalId)
        }
      }
    }

    intervalId = setInterval(checkStatus, 500)
    checkStatus() // Initial check

    return () => clearInterval(intervalId)
  }, [authState.status, authState.sessionToken])

  async function startLogin() {
    setAuthState({ status: 'logging-in' })
    try {
      const res = await fetch(`${API_BASE}/auth/canvas/login`)
      if (!res.ok) throw new Error('Failed to start login')
      const data = await res.json()
      setAuthState({
        status: 'logging-in',
        sessionToken: data.sessionToken,
      })
    } catch (error) {
      setAuthState({
        status: 'error',
        error: (error as Error).message,
      })
    }
  }

  async function refreshAssignments() {
    setAssignmentsState((prev) => ({ ...prev, loading: true, error: null }))
    setMessage(null)
    try {
      const res = await getAssignments()
      setAssignmentsState({ loading: false, error: null, data: res.data })
    } catch (error) {
      setAssignmentsState({ loading: false, error: (error as Error).message, data: [] })
    }
  }

  async function handleStatusChange(assignment: Assignment, nextStatus: SubmissionStatus) {
    if (assignment.submissionStatus === nextStatus) return
    setUpdatingId(assignment.id)
    setMessage(null)
    try {
      if (nextStatus === assignment.defaultStatus) {
        await removeAssignmentOverride(assignment.id)
        setMessage(`Override cleared for ${assignment.title}`)
      } else {
        await setAssignmentOverride(assignment.id, nextStatus)
        setMessage(`Override saved for ${assignment.title}`)
      }
      await refreshAssignments()
    } catch (error) {
      setMessage((error as Error).message)
      setAssignmentsState((prev) => ({ ...prev, loading: false }))
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Assignments</h1>
              <p className="text-sm text-slate-400">
                View Canvas assignments and set manual submission status overrides. Selecting the original status removes the override.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {authState.status === 'logged-in' && authState.user && (
                <div className="text-right text-sm">
                  <div className="text-slate-200">{authState.user.name || authState.user.email}</div>
                  <div className="text-xs text-slate-400">Logged in</div>
                </div>
              )}
              {authState.status === 'logging-in' && (
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"></div>
                  <span>Signing in...</span>
                </div>
              )}
              {authState.status !== 'logged-in' && authState.status !== 'logging-in' && (
                <button
                  onClick={startLogin}
                  className="rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700"
                >
                  Sign in with Canvas
                </button>
              )}
              {authState.status === 'error' && (
                <div className="text-xs text-rose-400">{authState.error}</div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        {authState.status === 'logging-in' && (
          <div className="mb-6 rounded-md border border-blue-700 bg-blue-900/20 px-4 py-3 text-sm text-blue-200">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"></div>
              <div>
                <div className="font-medium">Signing in to Canvas...</div>
                <div className="text-xs text-blue-300 mt-1">
                  Complete the login in the browser window that opened. This page will update automatically.
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-medium">Your assignments</h2>
          <button
            onClick={refreshAssignments}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800"
          >
            Refresh
          </button>
        </div>

        {message && (
          <div className="mb-6 rounded-md border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
            {message}
          </div>
        )}

        {assignmentsState.loading && assignmentsState.data.length === 0 ? (
          <p className="text-sm text-slate-400">Loading assignments…</p>
        ) : null}

        {assignmentsState.error && (
          <p className="text-sm text-rose-400">{assignmentsState.error}</p>
        )}

        <div className="space-y-4">
          {assignmentsState.data.map((assignment) => {
            const isUpdating = updatingId === assignment.id
            const hasOverride = assignment.submissionStatus !== assignment.defaultStatus
            return (
              <div
                key={assignment.id}
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-md"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-50">{assignment.title}</h3>
                    <p className="text-sm text-slate-400">{assignment.courseName}</p>
                  </div>
                  <div className="text-sm text-slate-300">Due {formatDate(assignment.dueDate)}</div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Submission status
                  </label>
                  <select
                    value={assignment.submissionStatus}
                    disabled={isUpdating}
                    onChange={(event) =>
                      handleStatusChange(assignment, event.target.value as SubmissionStatus)
                    }
                    className="rounded-md border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-200"
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      hasOverride ? 'bg-amber-600/20 text-amber-200' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {hasOverride ? 'Override active' : 'Default status'}
                  </span>
                </div>

                {assignment.overrideReason && (
                  <p className="mt-3 text-xs text-slate-400">Reason: {assignment.overrideReason}</p>
                )}
                {assignment.overrideUpdatedAt && (
                  <p className="text-xs text-slate-500">
                    Updated {formatDate(assignment.overrideUpdatedAt)}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
