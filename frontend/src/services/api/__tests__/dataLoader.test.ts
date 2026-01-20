import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadCanvasDataForUser, loadCanvasDataForUserId } from "../dataLoader";

/**
 * Tests for dataLoader - orchestrates data loading from Supabase
 */

// Mock Supabase client
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    }),
  },
}));

// Mock supabaseDataLoader
vi.mock("../supabaseDataLoader", () => ({
  loadCanvasDataFromSupabase: vi.fn(),
}));

import { supabase } from "@/lib/supabase";
import { loadCanvasDataFromSupabase } from "../supabaseDataLoader";

const TEST_USER_ID = "1e5b46b8-e891-45a3-a3c6-94fb34ba6e35";
const TEST_EMAIL = "test@example.com";

describe("dataLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadCanvasDataForUser", () => {
    it("should lookup user by email and load data", async () => {
      // Mock user lookup
      const mockSingle = vi.fn().mockResolvedValue({
        data: { id: TEST_USER_ID, first_name: "Test", email: TEST_EMAIL },
        error: null,
      });

      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: mockSingle,
      });

      // Mock data loading
      const mockCanvasData = {
        user: { id: 1, name: "Test", email: TEST_EMAIL },
        courses: [{ id: 123, code: "CS101", name: "Intro to CS" }],
        assignments: [],
        announcements: [],
        modules: [],
        grades: { currentGPA: 0, semesterProgress: 0, courseGrades: [] },
      };

      (loadCanvasDataFromSupabase as any).mockResolvedValue(mockCanvasData);

      const result = await loadCanvasDataForUser(TEST_EMAIL);

      expect(result).not.toBeNull();
      expect(result?.courses).toHaveLength(1);
      expect(loadCanvasDataFromSupabase).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it("should normalize email to lowercase", async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: { id: TEST_USER_ID, first_name: "Test", email: TEST_EMAIL },
        error: null,
      });

      const mockEq = vi.fn().mockReturnThis();
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: mockEq,
        single: mockSingle,
      });

      (loadCanvasDataFromSupabase as any).mockResolvedValue({
        user: { id: 1, name: "Test", email: TEST_EMAIL },
        courses: [{ id: 123 }],
        assignments: [],
        announcements: [],
        modules: [],
        grades: { currentGPA: 0, semesterProgress: 0, courseGrades: [] },
      });

      await loadCanvasDataForUser("TEST@EXAMPLE.COM");

      // Check that email was normalized
      expect(mockEq).toHaveBeenCalledWith("email", "test@example.com");
    });

    it("should return null when user not found", async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "User not found" },
      });

      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: mockSingle,
      });

      const result = await loadCanvasDataForUser("nonexistent@example.com");

      expect(result).toBeNull();
      expect(loadCanvasDataFromSupabase).not.toHaveBeenCalled();
    });

    it("should return null when data loading returns empty", async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: { id: TEST_USER_ID, first_name: "Test", email: TEST_EMAIL },
        error: null,
      });

      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: mockSingle,
      });

      (loadCanvasDataFromSupabase as any).mockResolvedValue(null);

      const result = await loadCanvasDataForUser(TEST_EMAIL);

      expect(result).toBeNull();
    });

    it("should handle timeout gracefully", async () => {
      const mockSingle = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error("Supabase query timeout after 10s")),
              100,
            );
          }),
      );

      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: mockSingle,
      });

      const result = await loadCanvasDataForUser(TEST_EMAIL);

      expect(result).toBeNull();
    });
  });

  describe("loadCanvasDataForUserId", () => {
    it("should load data directly using user ID", async () => {
      const mockCanvasData = {
        user: { id: 1, name: "Test", email: TEST_EMAIL },
        courses: [{ id: 123, code: "CS101", name: "Intro to CS" }],
        assignments: [],
        announcements: [],
        modules: [],
        grades: { currentGPA: 0, semesterProgress: 0, courseGrades: [] },
      };

      (loadCanvasDataFromSupabase as any).mockResolvedValue(mockCanvasData);

      const result = await loadCanvasDataForUserId(
        TEST_USER_ID,
        TEST_EMAIL,
        "Test",
      );

      expect(result).not.toBeNull();
      expect(loadCanvasDataFromSupabase).toHaveBeenCalledWith(TEST_USER_ID);
      expect(result?.user.name).toBe("Test");
      expect(result?.user.email).toBe(TEST_EMAIL);
    });

    it("should use email prefix as name when firstName not provided", async () => {
      const mockCanvasData = {
        user: { id: 1, name: "", email: TEST_EMAIL },
        courses: [{ id: 123 }],
        assignments: [],
        announcements: [],
        modules: [],
        grades: { currentGPA: 0, semesterProgress: 0, courseGrades: [] },
      };

      (loadCanvasDataFromSupabase as any).mockResolvedValue(mockCanvasData);

      const result = await loadCanvasDataForUserId(TEST_USER_ID, TEST_EMAIL);

      expect(result?.user.name).toBe("test"); // email prefix
    });

    it("should return null when no courses exist", async () => {
      const mockCanvasData = {
        user: { id: 1, name: "Test", email: TEST_EMAIL },
        courses: [], // Empty courses
        assignments: [],
        announcements: [],
        modules: [],
        grades: { currentGPA: 0, semesterProgress: 0, courseGrades: [] },
      };

      (loadCanvasDataFromSupabase as any).mockResolvedValue(mockCanvasData);

      const result = await loadCanvasDataForUserId(
        TEST_USER_ID,
        TEST_EMAIL,
        "Test",
      );

      expect(result).toBeNull();
    });

    it("should handle errors from supabaseDataLoader", async () => {
      (loadCanvasDataFromSupabase as any).mockRejectedValue(
        new Error("Database error"),
      );

      const result = await loadCanvasDataForUserId(
        TEST_USER_ID,
        TEST_EMAIL,
        "Test",
      );

      expect(result).toBeNull();
    });
  });
});
