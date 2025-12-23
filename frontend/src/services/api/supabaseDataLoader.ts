/**
 * Supabase data loader - loads Canvas data from flexible JSONB storage
 */

import { supabase } from '@/lib/supabase';
import type { CanvasData } from './dataLoader';

/**
 * Load Canvas data from Supabase for a specific user email
 * Uses the new flexible schema-less storage system
 */
export async function loadCanvasDataFromSupabase(userEmail: string): Promise<CanvasData | null> {
  const normalizedEmail = userEmail.toLowerCase().trim();
  
  console.log(`[supabaseDataLoader] Loading data for email: ${normalizedEmail} from flexible storage`);

  try {
    // Load all entities using the flexible storage function
    const { data: allEntities, error: entitiesError } = await supabase.rpc('get_user_entities', {
      user_email: normalizedEmail,
      entity_type_filter: null, // Get all types
      course_id_filter: null
    });

    if (entitiesError) {
      console.error('[supabaseDataLoader] Error loading entities:', entitiesError);
      throw entitiesError;
    }

    if (!allEntities || allEntities.length === 0) {
      console.warn(`[supabaseDataLoader] No entities found for email: ${normalizedEmail}`);
      return null;
    }
    
    // Separate entities by type
    const courses = allEntities.filter(e => e.entity_type === 'course');
    const assignments = allEntities.filter(e => e.entity_type === 'assignment');
    const quizzes = allEntities.filter(e => e.entity_type === 'quiz');
    const announcements = allEntities.filter(e => e.entity_type === 'announcement');
    const modules = allEntities.filter(e => e.entity_type === 'module');
    const pages = allEntities.filter(e => e.entity_type === 'page');
    const files = allEntities.filter(e => e.entity_type === 'file');
    const fileBinaries = allEntities.filter(e => e.entity_type === 'file_binary');
    const gradesEntities = allEntities.filter(e => e.entity_type === 'grades');

    console.log(`[supabaseDataLoader] Found ${courses.length} courses, ${assignments.length} assignments, ${quizzes.length} quizzes, ${announcements.length} announcements, ${modules.length} modules, ${pages.length} pages, ${files.length} file metadata, ${fileBinaries.length} uploaded files`);

    if (courses.length === 0) {
      console.warn(`[supabaseDataLoader] No courses found for email: ${normalizedEmail}`);
      return null;
    }

    // Get user info from first course or create default
    const firstCourse = courses[0];
    const user = {
      id: 1, // Will be replaced by actual user ID from users table
      name: normalizedEmail.split('@')[0],
      email: normalizedEmail,
      avatar_url: undefined,
    };

    // Convert courses
    const coursesData = courses.map(entity => {
      const course = entity.data as any;
      return {
        id: parseInt(entity.entity_id) || course.id || 0,
        code: course.code || '',
        name: course.name || '',
        instructor: course.instructor || '',
        color: course.color || 'hsl(220, 45%, 48%)',
        enrollmentTermId: course.enrollmentTermId || course.enrollment_term_id || 1,
        workflowState: course.workflowState || course.workflow_state || 'available',
      };
    });

    // Convert assignments
    const assignmentsData = assignments.map(entity => {
      const assignment = entity.data as any;
      const metadata = entity.metadata as any || {};
      
      // Extract submission status from multiple possible locations and field name variations
      // Check assignment.data first, then metadata, then check for alternative field names
      const submissionStatus = 
        assignment.submissionStatus || 
        assignment.submission_status || 
        metadata.submissionStatus ||
        metadata.submission_status ||
        (assignment.submitted === true ? 'yes' : (assignment.submitted === false ? 'no' : null)) ||
        (assignment.hasSubmission === true ? 'yes' : (assignment.hasSubmission === false ? 'no' : null)) ||
        null;
      
      const submissionStatusText = 
        assignment.submissionStatusText || 
        assignment.submission_status_text ||
        metadata.submissionStatusText ||
        metadata.submission_status_text ||
        null;
      
      // Debug logging: Log first few assignments to see the structure
      const assignmentId = assignment.id || assignment.assignmentId || entity.entity_id;
      if (assignments.indexOf(entity) < 3) {
        console.log(`[supabaseDataLoader] Sample assignment ${assignmentId}:`, {
          title: assignment.title?.substring(0, 30),
          hasSubmissionStatus: !!assignment.submissionStatus,
          hasSubmissionStatusText: !!assignment.submissionStatusText,
          submissionStatus: assignment.submissionStatus,
          submissionStatusText: assignment.submissionStatusText,
          allKeys: Object.keys(assignment).filter(k => k.toLowerCase().includes('submission') || k.toLowerCase().includes('submit'))
        });
      }
      
      // Check if this is a quiz based on submission types
      const isQuizFromTypes = (assignment.submissionTypes || assignment.submission_types || []).some((type: string) => 
        type.toLowerCase().includes("quiz")
      );
      
      return {
        id: parseInt(entity.entity_id) || assignment.assignmentId || assignment.id || 0,
        title: assignment.title || 'Untitled Assignment',
        courseId: entity.course_id ? parseInt(entity.course_id) : (assignment.courseId || 0),
        courseName: assignment.courseName || assignment.course_name || '',
        courseCode: assignment.courseCode || assignment.course_code || '',
        dueAt: assignment.dueDate || assignment.due_date || '',
        assignedAt: assignment.assignedAt || assignment.assigned_at || '',
        pointsPossible: assignment.points || assignment.pointsPossible || assignment.points_possible,
        submissionTypes: (assignment.submissionTypes || assignment.submission_types || []) as string[],
        workflowState: assignment.workflowState || assignment.workflow_state || 'pending',
        url: assignment.url || null,
        submissionStatus: submissionStatus as "yes" | "no" | null,
        submissionStatusText: submissionStatusText || null,
        isQuiz: isQuizFromTypes, // Flag for quizzes
      };
    });

    // Convert quizzes to assignment format (so they can be displayed together)
    const quizzesAsAssignments = quizzes.map(entity => {
      const quiz = entity.data as any;
      const metadata = entity.metadata as any || {};
      
      // Extract submission status for quizzes (similar to assignments)
      const submissionStatus = 
        quiz.submissionStatus || 
        quiz.submission_status || 
        metadata.submissionStatus ||
        metadata.submission_status ||
        null;
      
      const submissionStatusText = 
        quiz.submissionStatusText || 
        quiz.submission_status_text ||
        metadata.submissionStatusText ||
        metadata.submission_status_text ||
        null;
      
      // Get due date from metadata or quiz data
      const dueDate = metadata.dueDate || quiz.metadata?.dueDate || quiz.dueDate || '';
      
      return {
        id: parseInt(entity.entity_id) || parseInt(quiz.quizId) || 0,
        title: quiz.title || 'Untitled Quiz',
        courseId: entity.course_id ? parseInt(entity.course_id) : (parseInt(quiz.courseId) || 0),
        courseName: quiz.courseName || quiz.course_name || '',
        courseCode: quiz.courseCode || quiz.course_code || '',
        dueAt: dueDate,
        assignedAt: quiz.assignedAt || quiz.assigned_at || quiz.extractedAt || '',
        pointsPossible: metadata.points || quiz.metadata?.points || quiz.pointsPossible || null,
        submissionTypes: ['online_quiz'] as string[], // Mark as quiz type
        workflowState: quiz.workflowState || quiz.workflow_state || quiz.metadata?.isPublished ? 'published' : 'pending',
        url: quiz.url || null,
        submissionStatus: submissionStatus as "yes" | "no" | null,
        submissionStatusText: submissionStatusText || null,
        isQuiz: true, // Flag to identify quizzes
      };
    });

    // Merge quizzes with assignments (quizzes are treated as assignments in the UI)
    const allAssignmentsData = [...assignmentsData, ...quizzesAsAssignments];

    // Convert announcements
    const announcementsData = announcements.map(entity => {
      const announcement = entity.data as any;
      
      // Try to extract postedAt from various possible fields
      let postedAt = announcement.postedAt || announcement.posted_at || '';
      
      // If not found, try to parse from postDate (formatted string like "Posted Aug 20 12:58pm")
      if (!postedAt && announcement.postDate) {
        try {
          // Try to extract date from formatted string like "Posted Aug 20 12:58pm"
          const dateMatch = announcement.postDate.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{1,2}):(\d{2})(am|pm)/i);
          if (dateMatch) {
            const [, month, day, hour, minute, ampm] = dateMatch;
            const monthMap: Record<string, number> = {
              jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
              jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
            };
            const monthIndex = monthMap[month.toLowerCase()];
            let hour24 = parseInt(hour);
            if (ampm.toLowerCase() === 'pm' && hour24 !== 12) hour24 += 12;
            if (ampm.toLowerCase() === 'am' && hour24 === 12) hour24 = 0;
            // Use current year as fallback
            const year = new Date().getFullYear();
            const date = new Date(year, monthIndex, parseInt(day), hour24, parseInt(minute));
            if (!isNaN(date.getTime())) {
              postedAt = date.toISOString();
            }
          }
        } catch (e) {
          // If parsing fails, leave postedAt empty
        }
      }
      
      return {
        id: parseInt(entity.entity_id) || announcement.announcementId || announcement.id || 0,
        courseId: entity.course_id ? parseInt(entity.course_id) : (announcement.courseId || 0),
        title: announcement.title || 'Untitled Announcement',
        message: announcement.content || announcement.contentText || announcement.message || '',
        postedAt: postedAt,
        attachments: announcement.attachments || [],
      };
    });

    const deriveBucketName = (email: string) => {
      return 'user-' + email.toLowerCase().trim()
        .replace('@', '-at-')
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/^-+/, '')
        .slice(0, 60);
    };
    const defaultBucketName = deriveBucketName(normalizedEmail);
    const createFileKey = (courseId: number, fileName: string) =>
      `${courseId}|${fileName.toLowerCase().trim()}`;

    type FileRecord = {
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
      mimeType?: string | null;
      originalUrl?: string | null;
      canvasFileId?: string | number | null;
      downloadUrl?: string | null;
    };

    const fileMap = new Map<string, FileRecord>();
    let fallbackFileId = 1000000;

    // First, process file_binary entities (actual uploaded files) - these have the storage paths
    fileBinaries.forEach(entity => {
      const file = entity.data as any;
      const courseId = entity.course_id ? parseInt(entity.course_id) : 0;
      const originalPath = entity.metadata?.originalPath || file.originalPath || '';
      const fileName = file.filename || file.fileName || file.name || originalPath.split('/').pop() || '';
      
      if (!fileName) return; // Skip if no filename
      
      const storagePath = entity.file_storage_path || file.storagePath || file.storage_path || '';
      const storageBucket = entity.metadata?.storageBucket || defaultBucketName;
      const folder = entity.metadata?.context || originalPath.split('/').slice(0, -1).join('/') || '';
      const size = Number(entity.file_size) || file.size || file.fileSize || 0;
      const mimeType = file.mimeType || file.contentType || file.content_type || entity.file_mime_type || null;
      const downloadUrl = file.url || '';
      
      const key = createFileKey(courseId, fileName);
      
      // Only add if we have a storage path (actual file uploaded)
      if (storagePath) {
        fileMap.set(key, {
          id: fallbackFileId++,
          courseId,
          fileName,
          url: storagePath,
          size,
          createdAt: file.createdAt || file.created_at || '',
          updatedAt: file.updatedAt || file.updated_at || '',
          folder,
          storageBucket,
          storagePath,
          mimeType,
          originalUrl: downloadUrl || '',
          canvasFileId: file.fileId || file.id || null,
          downloadUrl: downloadUrl || null,
        });
      }
    });

    // Then, add file metadata entries. If the file already exists, enrich it with missing details.
    files.forEach(entity => {
      const file = entity.data as any;
      const courseId = entity.course_id ? parseInt(entity.course_id) : (file.courseId || 0);
      const fileName = file.name || file.fileName || file.filename || '';
      
      if (!fileName) return; // Skip if no filename
      
      const key = createFileKey(courseId, fileName);
      const folder = entity.metadata?.folderPathString || file.folderPathString || file.folder || '';
      const fileUrl = file.url || file.downloadUrl || file.moduleItemUrl || file.sourcePageUrl || '';
      const canvasFileId = file.fileId || file.id || null;
      const mimeType = file.mimeType || file.contentType || file.content_type || entity.file_mime_type || null;
      const size = Number(entity.file_size) || file.size || file.fileSize || 0;

      if (!fileMap.has(key)) {
        fileMap.set(key, {
          id: parseInt(entity.entity_id) || Number(canvasFileId) || fallbackFileId++,
          courseId,
          fileName,
          url: fileUrl,
          originalUrl: fileUrl,
          size,
          createdAt: file.createdAt || file.created_at || '',
          updatedAt: file.updatedAt || file.updated_at || '',
          folder,
          storageBucket: null,
          storagePath: null,
          mimeType,
          canvasFileId,
          downloadUrl: file.downloadUrl || null,
        });
      } else {
        const existing = fileMap.get(key)!;
        if (!existing.originalUrl && fileUrl) existing.originalUrl = fileUrl;
        if (!existing.downloadUrl && file.downloadUrl) existing.downloadUrl = file.downloadUrl;
        if (!existing.folder && folder) existing.folder = folder;
        if (!existing.mimeType && mimeType) existing.mimeType = mimeType;
        if (!existing.size && size) existing.size = size;
        if (!existing.canvasFileId && canvasFileId) existing.canvasFileId = canvasFileId;
        if ((!existing.storageBucket || !existing.storagePath) && file.storagePath) {
          existing.storageBucket = file.storageBucket || existing.storageBucket;
          existing.storagePath = file.storagePath;
          existing.url = file.storagePath;
        }
      }
    });

    const filesData = Array.from(fileMap.values());

    const fileLookupByCanvasId = new Map<string, FileRecord>();
    const fileLookupByName = new Map<string, FileRecord>();
    const fileLookupByOriginalUrl = new Map<string, FileRecord>();

    filesData.forEach(file => {
      if (file.canvasFileId !== undefined && file.canvasFileId !== null) {
        fileLookupByCanvasId.set(String(file.canvasFileId), file);
      }
      if (file.fileName) {
        fileLookupByName.set(createFileKey(file.courseId, file.fileName), file);
      }
      if (file.originalUrl) {
        fileLookupByOriginalUrl.set(file.originalUrl.trim(), file);
      }
      if (file.url && file.url !== file.originalUrl) {
        fileLookupByOriginalUrl.set(file.url.trim(), file);
      }
    });

    const findFileForModuleItem = (courseId: number, item: any): FileRecord | null => {
      const idCandidates = [item.fileId, item.file_id];
      for (const candidate of idCandidates) {
        if (candidate !== undefined && candidate !== null) {
          const normalized = String(candidate);
          if (fileLookupByCanvasId.has(normalized)) {
            return fileLookupByCanvasId.get(normalized)!;
          }
        }
      }

      const nameCandidates = [item.fileName, item.filename, item.title, item.name];
      for (const nameCandidate of nameCandidates) {
        if (!nameCandidate) continue;
        const key = createFileKey(courseId, nameCandidate);
        if (fileLookupByName.has(key)) {
          return fileLookupByName.get(key)!;
        }
        // Try case-insensitive exact match
        const candidateLower = nameCandidate.toLowerCase().trim();
        for (const [fileKey, file] of fileLookupByName.entries()) {
          if (file.courseId !== courseId) continue;
          const fileKeyParts = fileKey.split('|');
          if (fileKeyParts.length === 2 && fileKeyParts[1].toLowerCase() === candidateLower) {
            return file;
          }
          const fileNameLower = file.fileName?.toLowerCase().trim() || '';
          if (fileNameLower === candidateLower) {
            return file;
          }
        }
      }

      const urlCandidates = [item.downloadUrl, item.download_url, item.url];
      for (const urlCandidate of urlCandidates) {
        if (!urlCandidate || typeof urlCandidate !== 'string') continue;
        const normalized = urlCandidate.trim();
        if (fileLookupByOriginalUrl.has(normalized)) {
          return fileLookupByOriginalUrl.get(normalized)!;
        }
      }

      return null;
    };

    // Convert modules
    const modulesData = modules.map(entity => {
      const module = entity.data as any;
      const courseId = entity.course_id ? parseInt(entity.course_id) : (module.courseId || 0);
      
      // Handle items - could be array or in moduleFiles format
      let items: Array<{
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
      }> = [];
      
      if (module.items && Array.isArray(module.items)) {
        items = module.items.map((item: any) => {
          // Handle different item formats
          const itemId = item.id || item.moduleItemId || item.pageId || 0;
          const itemTitle = item.title || item.moduleItemTitle || item.name || item.fileName || 'Untitled Item';
          const itemType = item.type || item.moduleItemType || 'File';
          
          // Convert string IDs to numbers where possible
          let numericId = 0;
          if (typeof itemId === 'string') {
            // Handle "page-123" format
            const match = itemId.match(/(\d+)$/);
            numericId = match ? parseInt(match[1], 10) : 0;
          } else {
            numericId = itemId || 0;
          }
          const downloadUrl = item.downloadUrl || item.download_url || item.url || '';
          const matchedFile = findFileForModuleItem(courseId, item);
          // Use matched file's storage path if available, otherwise fall back to item's own storage path
          const storagePath = matchedFile?.storagePath || item.storagePath || item.storage_path || '';
          // Use matched file's bucket, or item's bucket, or default bucket if we have a storage path
          const storageBucket = matchedFile?.storageBucket || item.storageBucket || item.storage_bucket || 
            (storagePath ? defaultBucketName : null);
          const originalUrl = matchedFile?.originalUrl || downloadUrl || item.originalUrl || item.original_url || '';
          const mimeType = matchedFile?.mimeType || item.mimeType || item.mime_type || '';
          const fileName = matchedFile?.fileName || item.fileName || item.filename || itemTitle;
          const fileId = matchedFile?.canvasFileId || item.fileId || item.file_id || null;
          return {
            id: numericId,
            title: String(itemTitle),
            type: String(itemType),
            name: String(itemTitle), // Also include as 'name' for compatibility
            storagePath: storagePath || null,
            storageBucket: storageBucket || null,
            originalUrl: originalUrl || '',
            mimeType: mimeType || '',
            fileName,
            fileId,
          };
        });
        
        // Deduplicate items based on id + title + fileName combination
        const seenItems = new Map<string, boolean>();
        items = items.filter(item => {
          // Create a unique key from id, title, and fileName
          const key = `${item.id}|${item.title}|${item.fileName || ''}`;
          if (seenItems.has(key)) {
            return false; // Duplicate, filter it out
          }
          seenItems.set(key, true);
          return true;
        });
        }
        
        return {
        id: parseInt(entity.entity_id) || module.moduleId || module.id || 0,
        courseId,
          name: module.name || 'Untitled Module',
          position: module.position || 0,
        unlockAt: module.unlockAt || module.unlock_at || null,
          items: items,
        };
    });

    // Convert pages
    const pagesData = pages.map(entity => {
      const page = entity.data as any;
      return {
        id: parseInt(entity.entity_id) || page.pageId || page.id || 0,
        courseId: entity.course_id ? parseInt(entity.course_id) : (page.courseId || 0),
        title: page.title || 'Untitled Page',
        url: page.url || '',
        htmlContent: page.content || page.body || page.htmlContent || '',
        createdAt: page.createdAt || page.created_at || '',
        updatedAt: page.updatedAt || page.updated_at || '',
      };
    });

    // Convert grades
    let gradesData = {
      currentGPA: 0,
      semesterProgress: 0,
      courseGrades: [] as Array<{
        courseId: number;
        courseName: string;
        currentGrade: number;
        letterGrade: string;
      }>,
    };

    if (gradesEntities.length > 0) {
      const grades = gradesEntities[0].data as any;
      gradesData = {
        currentGPA: grades.currentGPA || grades.current_gpa || 0,
        semesterProgress: grades.semesterProgress || grades.semester_progress || 0,
        courseGrades: (grades.courseGrades || grades.course_grades || []) as Array<{
          courseId: number;
          courseName: string;
          currentGrade: number;
          letterGrade: string;
        }>,
      };
    }

    const canvasData: CanvasData = {
      user,
      courses: coursesData,
      assignments: allAssignmentsData, // Includes both assignments and quizzes
      announcements: announcementsData,
      modules: modulesData,
      pages: pagesData,
      files: filesData,
      grades: gradesData,
    };

    // Log summary of submission status
    const assignmentsWithSubmissionStatus = allAssignmentsData.filter(a => a.submissionStatus !== null && a.submissionStatus !== undefined);
    const submittedAssignments = allAssignmentsData.filter(a => a.submissionStatus === 'yes');
    const quizCount = allAssignmentsData.filter(a => a.isQuiz).length;
    console.log(`[supabaseDataLoader] Successfully loaded Canvas data for ${normalizedEmail}`);
    console.log(`[supabaseDataLoader] Summary: ${allAssignmentsData.length} total items (${assignmentsData.length} assignments + ${quizCount} quizzes), ${assignmentsWithSubmissionStatus.length} with submission status, ${submittedAssignments.length} marked as submitted`);
    
    return canvasData;
  } catch (error) {
    console.error(`[supabaseDataLoader] Error loading data for ${normalizedEmail}:`, error);
    return null;
  }
}

/**
 * Get signed URL for a file stored in Supabase Storage
 */
export async function getFileSignedUrl(bucketName: string, storagePath: string, expiresIn: number = 3600): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(storagePath, expiresIn);
    
    if (error) {
      console.error('[supabaseDataLoader] Error creating signed URL:', error);
      return null;
    }
    
    return data?.signedUrl || null;
  } catch (error) {
    console.error('[supabaseDataLoader] Error getting file signed URL:', error);
    return null;
  }
}
