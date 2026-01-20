import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadCanvasDataFromSupabase,
  getFileSignedUrl,
} from "../supabaseDataLoader";

/**
 * Integration tests for supabaseDataLoader
 * Tests the optimized RPC-based data loading (get_user_canvas_data)
 */

// Mock Supabase client
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    storage: {
      from: vi.fn(),
    },
  },
}));

import { supabase } from "@/lib/supabase";

// Test user ID (UUID format)
const TEST_USER_ID = "1e5b46b8-e891-45a3-a3c6-94fb34ba6e35";

describe("supabaseDataLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadCanvasDataFromSupabase - RPC get_user_canvas_data", () => {
    it("should call RPC with correct function name and user ID", async () => {
      const mockGroupedData = [
        {
          entity_type: "course",
          entities: [
            {
              id: 1,
              entity_id: "123",
              course_id: null,
              data: {
                id: 123,
                code: "CS101",
                name: "Intro to CS",
                instructor: "Prof. Smith",
              },
              metadata: {},
            },
          ],
        },
      ];

      (supabase.rpc as any).mockResolvedValue({
        data: mockGroupedData,
        error: null,
      });

      await loadCanvasDataFromSupabase(TEST_USER_ID);

      expect(supabase.rpc).toHaveBeenCalledWith("get_user_canvas_data", {
        p_user_id: TEST_USER_ID,
      });
    });

    it("should transform grouped RPC response into CanvasData format", async () => {
      const mockGroupedData = [
        {
          entity_type: "course",
          entities: [
            {
              id: 1,
              entity_id: "123",
              data: {
                code: "CS101",
                name: "Intro to CS",
                instructor: "Prof. Smith",
                color: "hsl(220, 45%, 48%)",
              },
            },
          ],
        },
        {
          entity_type: "assignment",
          entities: [
            {
              id: 2,
              entity_id: "456",
              course_id: "123",
              data: {
                title: "Assignment 1",
                dueDate: "2026-01-20T23:59:00Z",
                points: 100,
              },
            },
          ],
        },
      ];

      (supabase.rpc as any).mockResolvedValue({
        data: mockGroupedData,
        error: null,
      });

      const result = await loadCanvasDataFromSupabase(TEST_USER_ID);

      expect(result).not.toBeNull();
      expect(result?.courses).toHaveLength(1);
      expect(result?.courses[0].code).toBe("CS101");
      expect(result?.assignments).toHaveLength(1);
      expect(result?.assignments[0].title).toBe("Assignment 1");
    });

    it("should return null when no data exists for user", async () => {
      (supabase.rpc as any).mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await loadCanvasDataFromSupabase(TEST_USER_ID);

      expect(result).toBeNull();
    });

    it("should return null when no courses exist (even if other data exists)", async () => {
      const mockGroupedData = [
        {
          entity_type: "assignment",
          entities: [
            { id: 1, entity_id: "123", data: { title: "Orphan Assignment" } },
          ],
        },
      ];

      (supabase.rpc as any).mockResolvedValue({
        data: mockGroupedData,
        error: null,
      });

      const result = await loadCanvasDataFromSupabase(TEST_USER_ID);

      expect(result).toBeNull();
    });

    it("should handle RPC errors gracefully", async () => {
      (supabase.rpc as any).mockResolvedValue({
        data: null,
        error: { message: "Database error", code: "PGRST301" },
      });

      const result = await loadCanvasDataFromSupabase(TEST_USER_ID);

      expect(result).toBeNull();
    });

    it("should merge quizzes into assignments array with isQuiz flag", async () => {
      const mockGroupedData = [
        {
          entity_type: "course",
          entities: [
            {
              id: 1,
              entity_id: "100",
              data: { code: "CS101", name: "Intro to CS" },
            },
          ],
        },
        {
          entity_type: "assignment",
          entities: [
            {
              id: 2,
              entity_id: "200",
              course_id: "100",
              data: { title: "Assignment 1", courseId: 100 },
            },
          ],
        },
        {
          entity_type: "quiz",
          entities: [
            {
              id: 3,
              entity_id: "300",
              course_id: "100",
              data: { title: "Quiz 1", quizId: 300, courseId: 100 },
            },
          ],
        },
      ];

      (supabase.rpc as any).mockResolvedValue({
        data: mockGroupedData,
        error: null,
      });

      const result = await loadCanvasDataFromSupabase(TEST_USER_ID);

      expect(result?.assignments).toHaveLength(2);

      const assignment = result?.assignments.find(
        (a) => a.title === "Assignment 1",
      );
      const quiz = result?.assignments.find((a) => a.title === "Quiz 1");

      expect(assignment?.isQuiz).toBeFalsy();
      expect(quiz?.isQuiz).toBe(true);
    });

    it("should handle submission status from data and metadata", async () => {
      const mockGroupedData = [
        {
          entity_type: "course",
          entities: [{ id: 1, entity_id: "100", data: { code: "CS101" } }],
        },
        {
          entity_type: "assignment",
          entities: [
            {
              id: 2,
              entity_id: "200",
              course_id: "100",
              data: {
                title: "Submitted Assignment",
                submissionStatus: "yes",
                submissionStatusText: "Submitted",
              },
              metadata: {},
            },
            {
              id: 3,
              entity_id: "201",
              course_id: "100",
              data: { title: "Not Submitted Assignment" },
              metadata: { submissionStatus: "no" },
            },
          ],
        },
      ];

      (supabase.rpc as any).mockResolvedValue({
        data: mockGroupedData,
        error: null,
      });

      const result = await loadCanvasDataFromSupabase(TEST_USER_ID);

      expect(result?.assignments[0].submissionStatus).toBe("yes");
      expect(result?.assignments[0].submissionStatusText).toBe("Submitted");
      expect(result?.assignments[1].submissionStatus).toBe("no");
    });

    it("should handle all entity types correctly", async () => {
      const mockGroupedData = [
        {
          entity_type: "course",
          entities: [
            {
              id: 1,
              entity_id: "100",
              data: { code: "CS101", name: "Course" },
            },
          ],
        },
        {
          entity_type: "assignment",
          entities: [
            {
              id: 2,
              entity_id: "200",
              course_id: "100",
              data: { title: "Assignment" },
            },
          ],
        },
        {
          entity_type: "quiz",
          entities: [
            {
              id: 3,
              entity_id: "300",
              course_id: "100",
              data: { title: "Quiz" },
            },
          ],
        },
        {
          entity_type: "announcement",
          entities: [
            {
              id: 4,
              entity_id: "400",
              course_id: "100",
              data: { title: "Announcement", content: "Hello" },
            },
          ],
        },
        {
          entity_type: "module",
          entities: [
            {
              id: 5,
              entity_id: "500",
              course_id: "100",
              data: { name: "Module 1", items: [] },
            },
          ],
        },
        {
          entity_type: "page",
          entities: [
            {
              id: 6,
              entity_id: "600",
              course_id: "100",
              data: { title: "Page 1", url: "/page1" },
            },
          ],
        },
        {
          entity_type: "file",
          entities: [
            {
              id: 7,
              entity_id: "700",
              course_id: "100",
              data: { name: "file.pdf", url: "/file.pdf" },
            },
          ],
        },
      ];

      (supabase.rpc as any).mockResolvedValue({
        data: mockGroupedData,
        error: null,
      });

      const result = await loadCanvasDataFromSupabase(TEST_USER_ID);

      expect(result?.courses).toHaveLength(1);
      expect(result?.assignments).toHaveLength(2); // 1 assignment + 1 quiz
      expect(result?.announcements).toHaveLength(1);
      expect(result?.modules).toHaveLength(1);
      expect(result?.pages).toHaveLength(1);
      expect(result?.files).toHaveLength(1);
    });

    it("should handle field name variations (camelCase vs snake_case)", async () => {
      const mockGroupedData = [
        {
          entity_type: "course",
          entities: [
            {
              id: 1,
              entity_id: "100",
              data: {
                course_code: "CS101", // snake_case
                course_name: "Intro to CS", // snake_case
                workflow_state: "available",
                enrollment_term_id: 1,
              },
            },
          ],
        },
        {
          entity_type: "assignment",
          entities: [
            {
              id: 2,
              entity_id: "200",
              course_id: "100",
              data: {
                title: "Assignment",
                due_date: "2026-01-20T23:59:00Z", // snake_case for dueAt
                points_possible: 100, // snake_case
                submission_types: ["online_upload"],
              },
            },
          ],
        },
      ];

      (supabase.rpc as any).mockResolvedValue({
        data: mockGroupedData,
        error: null,
      });

      const result = await loadCanvasDataFromSupabase(TEST_USER_ID);

      expect(result?.courses[0].code).toBe("CS101");
      expect(result?.courses[0].name).toBe("Intro to CS");
      expect(result?.courses[0].workflowState).toBe("available");
      expect(result?.assignments[0].pointsPossible).toBe(100);
    });
  });

  describe("loadCanvasDataFromSupabase - Scalability", () => {
    it("should handle large datasets efficiently (1000+ entities)", async () => {
      // Generate mock data with 1000 assignments
      const assignments = Array.from({ length: 1000 }, (_, i) => ({
        id: i + 1,
        entity_id: String(1000 + i),
        course_id: "100",
        data: {
          title: `Assignment ${i + 1}`,
          dueDate: "2026-01-20T23:59:00Z",
          points: 100,
        },
      }));

      const mockGroupedData = [
        {
          entity_type: "course",
          entities: [
            {
              id: 1,
              entity_id: "100",
              data: { code: "CS101", name: "Large Course" },
            },
          ],
        },
        {
          entity_type: "assignment",
          entities: assignments,
        },
      ];

      (supabase.rpc as any).mockResolvedValue({
        data: mockGroupedData,
        error: null,
      });

      const startTime = Date.now();
      const result = await loadCanvasDataFromSupabase(TEST_USER_ID);
      const duration = Date.now() - startTime;

      expect(result?.assignments).toHaveLength(1000);
      // Data transformation should complete within 1 second even for large datasets
      expect(duration).toBeLessThan(1000);
    });

    it("should handle multiple courses with cross-referenced data", async () => {
      const mockGroupedData = [
        {
          entity_type: "course",
          entities: [
            {
              id: 1,
              entity_id: "100",
              data: { code: "CS101", name: "Course 1" },
            },
            {
              id: 2,
              entity_id: "101",
              data: { code: "CS102", name: "Course 2" },
            },
            {
              id: 3,
              entity_id: "102",
              data: { code: "CS103", name: "Course 3" },
            },
          ],
        },
        {
          entity_type: "assignment",
          entities: [
            {
              id: 4,
              entity_id: "200",
              course_id: "100",
              data: { title: "Assignment for Course 1" },
            },
            {
              id: 5,
              entity_id: "201",
              course_id: "101",
              data: { title: "Assignment for Course 2" },
            },
            {
              id: 6,
              entity_id: "202",
              course_id: "102",
              data: { title: "Assignment for Course 3" },
            },
          ],
        },
      ];

      (supabase.rpc as any).mockResolvedValue({
        data: mockGroupedData,
        error: null,
      });

      const result = await loadCanvasDataFromSupabase(TEST_USER_ID);

      expect(result?.courses).toHaveLength(3);
      expect(result?.assignments).toHaveLength(3);

      // Verify course IDs are correctly assigned
      expect(result?.assignments[0].courseId).toBe(100);
      expect(result?.assignments[1].courseId).toBe(101);
      expect(result?.assignments[2].courseId).toBe(102);
    });
  });

  describe("getFileSignedUrl", () => {
    it("should generate signed URL for file", async () => {
      const mockSignedUrl = "https://supabase.co/signed-url";

      (supabase.storage.from as any).mockReturnValue({
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: mockSignedUrl },
          error: null,
        }),
      });

      const url = await getFileSignedUrl("test-bucket", "path/to/file.pdf");

      expect(url).toBe(mockSignedUrl);
    });

    it("should return null on error", async () => {
      (supabase.storage.from as any).mockReturnValue({
        createSignedUrl: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "File not found" },
        }),
      });

      const url = await getFileSignedUrl("test-bucket", "nonexistent.pdf");

      expect(url).toBeNull();
    });

    it("should use custom expiry time", async () => {
      const mockCreateSignedUrl = vi.fn().mockResolvedValue({
        data: { signedUrl: "https://example.com/file" },
        error: null,
      });

      (supabase.storage.from as any).mockReturnValue({
        createSignedUrl: mockCreateSignedUrl,
      });

      await getFileSignedUrl("test-bucket", "file.pdf", 7200);

      expect(mockCreateSignedUrl).toHaveBeenCalledWith("file.pdf", 7200);
    });
  });
});
