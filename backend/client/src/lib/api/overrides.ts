import { API_BASE, fetchJson } from '@/lib/http'
import type { ApiResponse } from '@/types/api'

export interface AssignmentOverride {
  id: string
  canvas_id: string
  submission_status: string
  manual_status_override: string | null
  effective_status: string
  override_reason?: string | null
  override_updated_at: string | null
  override_updated_by: string | null
}

export async function getAssignmentOverride(assignmentId: string) {
  return fetchJson<ApiResponse<AssignmentOverride>>(`${API_BASE}/overrides/${assignmentId}`)
}

export async function setAssignmentOverride(assignmentId: string, status: string, reason?: string) {
  return fetchJson<ApiResponse<AssignmentOverride>>(`${API_BASE}/overrides/${assignmentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, reason })
  })
}

export async function removeAssignmentOverride(assignmentId: string) {
  return fetchJson<ApiResponse<AssignmentOverride>>(`${API_BASE}/overrides/${assignmentId}`, {
    method: 'DELETE'
  })
}
