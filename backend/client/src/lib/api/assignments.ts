import { API_BASE, fetchJson } from '@/lib/http'
import type { ApiResponse, Assignment } from '@/types/api'

export async function getAssignments() {
  return fetchJson<ApiResponse<Assignment[]>>(`${API_BASE}/assignments`)
}
