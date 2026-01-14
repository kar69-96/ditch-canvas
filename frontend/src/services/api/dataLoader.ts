/**
 * Data loader service that loads Canvas data from dataset folders
 * Supports loading from extraction-data format (Crawlee dataset structure)
 */

import type { DatasetMapping } from "./datasetMapper";
import { supabase } from "@/lib/supabase";

export interface CanvasData {
  user: {
    id: number;
    name: string;
    email: string;
    avatar_url?: string;
  };
  courses: Array<{
    id: number;
    code: string;
    name: string;
    instructor: string;
    color: string;
    enrollmentTermId: number;
    workflowState: string;
  }>;
  assignments: Array<{
    id: number;
    title: string;
    courseId: number;
    courseName: string;
    courseCode: string;
    dueAt: string;
    assignedAt: string;
    pointsPossible?: number;
    submissionTypes: string[];
    workflowState: string;
    submittedAt?: string;
    url?: string;
    submissionStatus?: "yes" | "no" | null;
    submissionStatusText?: string | null;
    isQuiz?: boolean; // Flag to identify quizzes for UI styling
  }>;
  modules: Array<{
    id: number;
    courseId: number;
    name: string;
    position: number;
    unlockAt: string | null;
    items: Array<{
      id: number;
      title: string;
      type: string;
      name?: string;
      storagePath?: string | null;
      storageBucket?: string | null;
      originalUrl?: string | null;
      mimeType?: string | null;
      fileName?: string;
      fileId?: string | number | null;
    }>;
  }>;
  announcements: Array<{
    id: number;
    courseId: number;
    title: string;
    message: string;
    postedAt: string;
    attachments?: Array<{
      id?: string | number;
      filename?: string;
      url?: string;
      display_name?: string;
      content_type?: string;
      size?: number;
    }>;
  }>;
  pages?: Array<{
    id: number;
    courseId: number;
    title: string;
    url: string;
    htmlContent?: string;
    createdAt?: string;
    updatedAt?: string;
  }>;
  files?: Array<{
    id: number;
    courseId: number;
    fileName: string;
    url: string;
    size?: number;
    createdAt?: string;
    updatedAt?: string;
    folder?: string;
    storageBucket?: string | null;
    storagePath?: string | null;
    organizedPath?: string | null;
    mimeType?: string | null;
    originalUrl?: string | null;
    canvasFileId?: string | number | null;
    downloadUrl?: string | null;
  }>;
  grades: {
    currentGPA: number;
    semesterProgress: number;
    courseGrades: Array<{
      courseId: number;
      courseName: string;
      currentGrade: number;
      letterGrade: string;
    }>;
  };
}

/**
 * Load Canvas data for a specific user by their email
 * Looks up user ID from email, then loads data from Supabase
 */
export async function loadCanvasDataForUser(
  email: string,
): Promise<CanvasData | null> {
  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[dataLoader] Loading data for email: ${normalizedEmail}`);

  // First, look up the user ID from the email
  try {
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id, first_name, email")
      .eq("email", normalizedEmail)
      .single();

    if (userError || !userData) {
      console.error(
        `[dataLoader] User not found for email: ${normalizedEmail}`,
        userError,
      );
      return null;
    }

    const userId = userData.id;
    console.log(
      `[dataLoader] Found user ID: ${userId} for email: ${normalizedEmail}`,
    );

    // Load data using the user ID
    const { loadCanvasDataFromSupabase } = await import("./supabaseDataLoader");
    const supabaseData = await loadCanvasDataFromSupabase(userId);

    if (
      supabaseData &&
      supabaseData.courses &&
      supabaseData.courses.length > 0
    ) {
      // Populate user info from the users table
      supabaseData.user = {
        id: 1, // Legacy numeric ID for compatibility
        name: userData.first_name || normalizedEmail.split("@")[0],
        email: userData.email,
        avatar_url: undefined,
      };

      console.log(
        `[dataLoader] ✅ Successfully loaded ${supabaseData.courses.length} courses from Supabase for ${normalizedEmail}`,
      );
      return supabaseData;
    } else {
      console.warn(
        `[dataLoader] ⚠️  Supabase returned empty data for ${normalizedEmail}`,
      );
      return null;
    }
  } catch (error) {
    console.error(`[dataLoader] ❌ Failed to load from Supabase:`, error);
    return null;
  }
}
