/**
 * Learn API Service
 * Frontend API calls for AI-powered study platform features
 */

// Use relative URLs for production (empty API_BASE means same-origin requests)
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

export interface Visual {
  id: string;
  user_email: string;
  course_id?: string;
  title: string;
  topic: string;
  component_code: string;
  parameters: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TutorSession {
  id: string;
  user_email: string;
  course_id?: string;
  topic: string;
  messages: TutorMessage[];
  created_at: string;
  updated_at: string;
}

export interface TutorMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface PracticeProblem {
  question: string;
  hint: string;
  answer: string;
  explanation: string;
}

/**
 * Generate a visual using Claude
 */
export async function generateVisual(
  topic: string,
  userEmail: string,
  courseContext?: string,
): Promise<{
  success: boolean;
  componentCode: string;
  visualId?: string;
  topic: string;
  error?: string;
}> {
  const response = await fetch(`${API_BASE}/api/learn/visuals/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, userEmail, courseContext }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to generate visual");
  }

  return response.json();
}

/**
 * Get saved visuals for a user
 */
export async function getVisuals(
  userEmail: string,
  courseId?: string,
): Promise<Visual[]> {
  const params = new URLSearchParams({ userEmail });
  if (courseId) params.append("courseId", courseId);

  const response = await fetch(`${API_BASE}/api/learn/visuals?${params}`);

  if (!response.ok) {
    throw new Error("Failed to fetch visuals");
  }

  const data = await response.json();
  return data.visuals || [];
}

/**
 * Get a specific visual by ID
 */
export async function getVisual(id: string): Promise<Visual> {
  const response = await fetch(`${API_BASE}/api/learn/visuals/${id}`);

  if (!response.ok) {
    throw new Error("Visual not found");
  }

  const data = await response.json();
  return data.visual;
}

/**
 * Delete a visual
 */
export async function deleteVisual(
  id: string,
  userEmail: string,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/learn/visuals/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userEmail }),
  });

  if (!response.ok) {
    throw new Error("Failed to delete visual");
  }
}

/**
 * Send a message to the AI tutor
 */
export async function sendTutorMessage(
  message: string,
  userEmail: string,
  sessionId?: string,
  topic?: string,
  courseContext?: string,
): Promise<{
  success: boolean;
  response: string;
  sessionId: string;
  error?: string;
}> {
  const response = await fetch(`${API_BASE}/api/learn/tutor/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      userEmail,
      sessionId,
      topic,
      courseContext,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to send message");
  }

  return response.json();
}

/**
 * Get tutor sessions for a user
 */
export async function getTutorSessions(
  userEmail: string,
  courseId?: string,
): Promise<TutorSession[]> {
  const params = new URLSearchParams({ userEmail });
  if (courseId) params.append("courseId", courseId);

  const response = await fetch(
    `${API_BASE}/api/learn/tutor/sessions?${params}`,
  );

  if (!response.ok) {
    throw new Error("Failed to fetch tutor sessions");
  }

  const data = await response.json();
  return data.sessions || [];
}

/**
 * Get a specific tutor session
 */
export async function getTutorSession(id: string): Promise<TutorSession> {
  const response = await fetch(`${API_BASE}/api/learn/tutor/sessions/${id}`);

  if (!response.ok) {
    throw new Error("Session not found");
  }

  const data = await response.json();
  return data.session;
}

/**
 * Delete a tutor session
 */
export async function deleteTutorSession(
  id: string,
  userEmail: string,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/learn/tutor/sessions/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userEmail }),
  });

  if (!response.ok) {
    throw new Error("Failed to delete session");
  }
}

/**
 * Generate practice problems
 */
export async function generatePracticeProblems(
  topic: string,
  difficulty?: "easy" | "medium" | "hard",
  count?: number,
  courseContext?: string,
): Promise<{ success: boolean; problems: PracticeProblem[] }> {
  const response = await fetch(`${API_BASE}/api/learn/practice/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, difficulty, count, courseContext }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to generate practice problems");
  }

  return response.json();
}
