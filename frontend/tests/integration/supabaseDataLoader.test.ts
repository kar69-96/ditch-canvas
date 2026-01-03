import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadCanvasDataFromSupabase, getFileSignedUrl } from '../../src/services/api/supabaseDataLoader';

/**
 * Integration tests for supabaseDataLoader
 * Tests data loading from flexible Supabase storage
 */

// Mock Supabase client
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    storage: {
      from: vi.fn(),
    },
  },
}));

import { supabase } from '../../src/lib/supabase';

describe('supabaseDataLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadCanvasDataFromSupabase', () => {
    it('should load and transform course data', async () => {
      const mockEntities = [
        {
          entity_type: 'course',
          entity_id: '123',
          data: {
            id: 123,
            code: 'CS101',
            name: 'Intro to CS',
            instructor: 'Prof. Smith',
            color: 'hsl(220, 45%, 48%)',
          },
        },
      ];

      (supabase.rpc as any).mockResolvedValue({
        data: mockEntities,
        error: null,
      });

      const result = await loadCanvasDataFromSupabase('test@example.com');

      expect(result).not.toBeNull();
      expect(result?.courses).toHaveLength(1);
      expect(result?.courses[0].code).toBe('CS101');
    });

    it('should return null for users with no data', async () => {
      (supabase.rpc as any).mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await loadCanvasDataFromSupabase('nonexistent@example.com');

      expect(result).toBeNull();
    });

    it('should handle Supabase errors', async () => {
      (supabase.rpc as any).mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const result = await loadCanvasDataFromSupabase('test@example.com');

      expect(result).toBeNull();
    });

    it('should normalize email to lowercase', async () => {
      (supabase.rpc as any).mockResolvedValue({
        data: [],
        error: null,
      });

      await loadCanvasDataFromSupabase('Test@Example.COM');

      expect(supabase.rpc).toHaveBeenCalledWith('get_user_entities', {
        user_email: 'test@example.com',
        entity_type_filter: null,
        course_id_filter: null,
      });
    });

    it('should merge assignments and quizzes', async () => {
      const mockEntities = [
        {
          entity_type: 'course',
          entity_id: '100',
          data: { id: 100, code: 'CS101', name: 'Intro to CS' },
        },
        {
          entity_type: 'assignment',
          entity_id: '200',
          course_id: '100',
          data: { id: 200, title: 'Assignment 1', courseId: 100 },
        },
        {
          entity_type: 'quiz',
          entity_id: '300',
          course_id: '100',
          data: { quizId: 300, title: 'Quiz 1', courseId: 100 },
        },
      ];

      (supabase.rpc as any).mockResolvedValue({
        data: mockEntities,
        error: null,
      });

      const result = await loadCanvasDataFromSupabase('test@example.com');

      expect(result?.assignments).toHaveLength(2); // 1 assignment + 1 quiz
      expect(result?.assignments[1].isQuiz).toBe(true);
    });

    it('should set isCompleted flag from submission status', async () => {
      const mockEntities = [
        {
          entity_type: 'course',
          entity_id: '100',
          data: { id: 100, code: 'CS101' },
        },
        {
          entity_type: 'assignment',
          entity_id: '200',
          course_id: '100',
          data: { 
            id: 200, 
            title: 'Assignment 1', 
            submissionStatus: 'yes',
            workflowState: 'submitted'
          },
        },
      ];

      (supabase.rpc as any).mockResolvedValue({
        data: mockEntities,
        error: null,
      });

      const result = await loadCanvasDataFromSupabase('test@example.com');

      // Should not automatically set isCompleted based on submissionStatus
      // (This is now handled in the sync orchestrator)
      expect(result?.assignments[0].submissionStatus).toBe('yes');
    });
  });

  describe('getFileSignedUrl', () => {
    it('should generate signed URL for file', async () => {
      const mockSignedUrl = 'https://supabase.co/signed-url';
      
      (supabase.storage.from as any).mockReturnValue({
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: mockSignedUrl },
          error: null,
        }),
      });

      const url = await getFileSignedUrl('test-bucket', 'path/to/file.pdf');

      expect(url).toBe(mockSignedUrl);
    });

    it('should return null on error', async () => {
      (supabase.storage.from as any).mockReturnValue({
        createSignedUrl: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'File not found' },
        }),
      });

      const url = await getFileSignedUrl('test-bucket', 'nonexistent.pdf');

      expect(url).toBeNull();
    });

    it('should use custom expiry time', async () => {
      const mockCreateSignedUrl = vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://example.com/file' },
        error: null,
      });

      (supabase.storage.from as any).mockReturnValue({
        createSignedUrl: mockCreateSignedUrl,
      });

      await getFileSignedUrl('test-bucket', 'file.pdf', 7200);

      expect(mockCreateSignedUrl).toHaveBeenCalledWith('file.pdf', 7200);
    });
  });
});

