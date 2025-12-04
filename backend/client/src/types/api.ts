export type SubmissionStatus = 'submitted' | 'unsubmitted' | 'graded' | 'missing'

export interface Assignment {
  id: string
  title: string
  courseName: string
  dueDate: string | null
  defaultStatus: SubmissionStatus
  submissionStatus: SubmissionStatus
  overrideReason: string | null
  overrideUpdatedAt: string | null
}

export interface ApiResponse<T> {
  success: boolean
  data: T
  error?: { message: string }
}
