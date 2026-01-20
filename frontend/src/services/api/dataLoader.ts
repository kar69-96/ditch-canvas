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
    console.log(`[dataLoader] About to query Supabase users table...`);
    console.log(
      `[dataLoader] Supabase client:`,
      supabase ? "initialized" : "NOT initialized",
    );

    const query = supabase
      .from("users")
      .select("id, first_name, email")
      .eq("email", normalizedEmail)
      .single();

    console.log(`[dataLoader] Query built, awaiting response...`);

    // Add timeout to detect hanging requests
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Supabase query timeout after 10s")),
        10000,
      ),
    );

    let userData, userError;
    try {
      const result = (await Promise.race([query, timeoutPromise])) as any;
      userData = result.data;
      userError = result.error;
    } catch (timeoutErr) {
      console.error(`[dataLoader] Query timed out or failed:`, timeoutErr);
      throw timeoutErr;
    }

    console.log(
      `[dataLoader] Query complete. userData:`,
      userData,
      "error:",
      userError,
    );

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

/**
 * Load Canvas data for a specific user by their ID (skip redundant Supabase user lookup)
 * This is the preferred method when we already have the user ID from authentication
 */
export async function loadCanvasDataForUserId(
  userId: string,
  email: string,
  firstName?: string,
): Promise<CanvasData | null> {
  console.log(`[dataLoader] Loading data for user ID: ${userId} (${email})`);

  try {
    // Load data directly using the user ID
    const { loadCanvasDataFromSupabase } = await import("./supabaseDataLoader");
    console.log(
      `[dataLoader] Calling loadCanvasDataFromSupabase with userId: ${userId}`,
    );
    const supabaseData = await loadCanvasDataFromSupabase(userId);

    if (
      supabaseData &&
      supabaseData.courses &&
      supabaseData.courses.length > 0
    ) {
      // Populate user info
      supabaseData.user = {
        id: 1, // Legacy numeric ID for compatibility
        name: firstName || email.split("@")[0],
        email: email,
        avatar_url: undefined,
      };

      console.log(
        `[dataLoader] ✅ Successfully loaded ${supabaseData.courses.length} courses from Supabase for ${email}`,
      );
      return supabaseData;
    } else {
      console.warn(
        `[dataLoader] ⚠️  Supabase returned empty data for ${email}`,
      );
      return null;
    }
  } catch (error) {
    console.error(`[dataLoader] ❌ Failed to load from Supabase:`, error);
    return null;
  }
}
