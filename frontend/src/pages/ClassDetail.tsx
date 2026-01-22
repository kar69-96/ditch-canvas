import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import GlassCard from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  FileText,
  BookOpen,
  Clock,
  MessageCircle,
  Download,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useCanvasData } from "@/hooks/useCanvasData";
import { useSidebar, SidebarViewer } from "@/components/SidebarViewer";
import { toast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { getFileSignedUrl } from "@/services/api/supabaseDataLoader";
import JSZip from "jszip";

const getUserBucketName = (email: string) =>
  "user-" +
  email
    .toLowerCase()
    .trim()
    .replace("@", "-at-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+/, "")
    .slice(0, 60);

const isExternalUrl = (url: string) =>
  /^https?:\/\//i.test(url) || url.startsWith("data:");

const extensionMimeMap: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  json: "application/json",
};

const officeExtensions = new Set([
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "xlsm",
  "pps",
  "ppsx",
]);

const ClassDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    openItem: openSidebarItem,
    isOpen: isSidebarOpen,
    sidebarWidth,
    isFullscreen,
  } = useSidebar();
  const { data: mockCanvasData, loading } = useCanvasData();
  const courseId = id ? parseInt(id) : null;

  // Hover state for outline snapping animations
  const [hoveredAnnouncementIndex, setHoveredAnnouncementIndex] = useState<
    number | null
  >(null);
  const [hoveredUpcomingIndex, setHoveredUpcomingIndex] = useState<
    number | null
  >(null);
  const [hoveredTopicIndex, setHoveredTopicIndex] = useState<{
    moduleIndex: number;
    topicIndex: number;
  } | null>(null);

  // Sync completed assignments with localStorage
  const [completedAssignments, setCompletedAssignments] = useState<Set<number>>(
    () => {
      const stored = localStorage.getItem("completedAssignments");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    },
  );

  // Sync to localStorage whenever completedAssignments changes
  useEffect(() => {
    localStorage.setItem(
      "completedAssignments",
      JSON.stringify(Array.from(completedAssignments)),
    );
  }, [completedAssignments]);

  // Listen for completion changes from sidebar
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "completedAssignments" && e.newValue) {
        try {
          const newCompleted = new Set<number>(JSON.parse(e.newValue));
          setCompletedAssignments(newCompleted);
        } catch (error) {
          console.error("Error parsing completedAssignments:", error);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    // Also listen for custom events (for same-window updates)
    const handleCustomStorage = () => {
      const stored = localStorage.getItem("completedAssignments");
      if (stored) {
        setCompletedAssignments(new Set(JSON.parse(stored)));
      }
    };

    window.addEventListener("completedAssignmentsUpdated", handleCustomStorage);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(
        "completedAssignmentsUpdated",
        handleCustomStorage,
      );
    };
  }, []);

  const toggleAssignmentComplete = (
    assignmentId: number,
    e?: React.MouseEvent,
  ) => {
    if (e) {
      e.stopPropagation();
    }
    setCompletedAssignments((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(assignmentId)) {
        newSet.delete(assignmentId);
      } else {
        newSet.add(assignmentId);
      }
      return newSet;
    });
  };

  // Find course (will be null if not found, but we need to compute it before early returns)
  const course =
    mockCanvasData?.courses.find((c) => {
      const cId = typeof c.id === "string" ? parseInt(c.id, 10) : c.id;
      const urlId =
        typeof courseId === "string" ? parseInt(courseId, 10) : courseId;
      return cId === urlId;
    }) || null;

  // Sample PDF URL for files - defined before hooks that use it
  const samplePdfBase64 =
    "data:application/pdf;base64,JVBERi0xLjQKJdPr6eEKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKL01lZGlhQm94IFswIDAgNjEyIDc5Ml0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovUmVzb3VyY2VzIDw8Ci9Gb250IDw8Ci9GMSA0IDAgUgo+Pgo+PgovQ29udGVudHMgNSAwIFIKPj4KZW5kb2JqCjQgMCBvYmoKPDwKL1R5cGUgL0ZvbnQKL1N1YnR5cGUgL1R5cGUxCi9CYXNlRm9udCAvSGVsdmV0aWNhCj4+CmVuZG9qago1IDAgb2JqCjw8Ci9MZW5ndGggNDQKPj4Kc3RyZWFtCkJUCi9GMSAxMiBUZgo3MCA3NTAgVGQKKEhlbGxvIFdvcmxkKSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAwODQgMDAwMDAgbiAKMDAwMDAwMDE0MCAwMDAwMCBuIAowMDAwMDAwMjE2IDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgNgovUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKMjk3CiUlRU9G";

  // All hooks must be called before any early returns - React Rules of Hooks
  const userEmail = mockCanvasData?.user?.email || null;
  const fallbackBucketName = useMemo(
    () => (userEmail ? getUserBucketName(userEmail) : null),
    [userEmail],
  );
  const [filePreviewLoading, setFilePreviewLoading] = useState<string | null>(
    null,
  );

  const resolveFileUrl = useCallback(
    async (
      file: {
        url?: string | null;
        storageBucket?: string | null;
        storagePath?: string | null;
        originalUrl?: string | null;
      },
      expiresIn: number = 3600,
    ) => {
      console.log("[ClassDetail] resolveFileUrl called with:", {
        url: file?.url,
        storagePath: file?.storagePath,
        storageBucket: file?.storageBucket,
        originalUrl: file?.originalUrl,
        fallbackBucketName,
      });

      // Priority 1: Use storage path if available (best for previews)
      if (file?.storagePath) {
        const bucketName = file.storageBucket || fallbackBucketName;
        if (bucketName) {
          try {
            console.log("[ClassDetail] Getting signed URL for storage path:", {
              bucketName,
              path: file.storagePath,
            });
            const signedUrl = await getFileSignedUrl(
              bucketName,
              file.storagePath,
              expiresIn,
            );
            if (signedUrl) {
              console.log("[ClassDetail] Got signed URL from storage");
              return signedUrl;
            }
          } catch (error) {
            console.error(
              "[ClassDetail] Failed to get signed URL from storage:",
              error,
            );
          }
        }
      }

      // Priority 2: Use direct URL if it's a Supabase storage URL or data URL
      const rawUrl = file?.url || file?.originalUrl;
      if (rawUrl) {
        if (isExternalUrl(rawUrl)) {
          // For Canvas URLs, we can't embed them directly (CORS/auth issues)
          // Return null so the UI can show a download button instead
          if (rawUrl.includes("canvas.colorado.edu")) {
            console.log(
              "[ClassDetail] Canvas URL detected - cannot embed, will show download option",
            );
            return null;
          }
          // For other external URLs (like public CDNs), use them directly
          console.log("[ClassDetail] Using external URL:", rawUrl);
          return rawUrl;
        }

        // If it's not external but we have a bucket, try to use it as a storage path
        const bucketName = file.storageBucket || fallbackBucketName;
        if (bucketName && rawUrl) {
          try {
            console.log("[ClassDetail] Treating URL as storage path:", {
              bucketName,
              path: rawUrl,
            });
            const signedUrl = await getFileSignedUrl(
              bucketName,
              rawUrl,
              expiresIn,
            );
            if (signedUrl) {
              return signedUrl;
            }
          } catch (error) {
            console.error("[ClassDetail] Failed to get signed URL:", error);
          }
        }
      }

      console.log("[ClassDetail] No valid URL found for file");
      return null;
    },
    [fallbackBucketName],
  );

  const handleOpenFile = useCallback(
    async (
      file: {
        id?: number | string | null;
        fileName?: string | null;
        url?: string | null;
        storageBucket?: string | null;
        storagePath?: string | null;
        originalUrl?: string | null;
        mimeType?: string | null;
        size?: number | null;
        fileExtension?: string | null;
      },
      titleOverride?: string,
    ) => {
      if (!course) return;
      const fallbackId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const fileId = String(file?.id ?? file?.fileName ?? fallbackId);
      const displayTitle = titleOverride || file?.fileName || "Course File";
      const inferredExtension =
        file?.fileExtension ||
        (displayTitle.includes(".")
          ? displayTitle.split(".").pop()?.toLowerCase()
          : undefined) ||
        undefined;
      const inferredMime =
        file?.mimeType ||
        (inferredExtension ? extensionMimeMap[inferredExtension] : undefined);
      const isOfficeFile = inferredExtension
        ? officeExtensions.has(inferredExtension)
        : false;
      setFilePreviewLoading(fileId);
      try {
        const resolvedUrl = await resolveFileUrl(
          file,
          isOfficeFile ? 60 * 60 * 24 : 3600,
        );
        // If resolvedUrl is null, try to use the original URL (might be a Canvas URL)
        const fileUrlToUse =
          resolvedUrl || file?.originalUrl || file?.url || null;

        if (!fileUrlToUse) {
          toast({
            title: "Unable to open file",
            description:
              "This file doesn't have a downloadable URL yet. It may need to be uploaded to storage.",
            variant: "destructive",
          });
          return;
        }

        // Always open in sidebar, even if it's a Canvas URL (sidebar will handle it appropriately)
        openSidebarItem({
          id: `file-${course.id}-${fileId}`,
          type: "file",
          title: displayTitle,
          courseCode: course.code,
          fileUrl: fileUrlToUse,
          fileName: file?.fileName || displayTitle,
          fileMimeType: inferredMime,
          fileSize: file?.size ?? undefined,
          fileExtension: inferredExtension,
        });
      } catch (error) {
        console.error("[ClassDetail] Error opening file:", error);
        toast({
          title: "Unable to open file",
          description: "An unexpected error occurred while loading this file.",
          variant: "destructive",
        });
      } finally {
        setFilePreviewLoading(null);
      }
    },
    [course, openSidebarItem, resolveFileUrl],
  );

  // Open module topic in sidebar - must be defined before it's used
  const openTopic = useCallback(
    async (topic: {
      name: string;
      itemId?: number | string | null;
      url?: string | null;
      storageBucket?: string | null;
      storagePath?: string | null;
      originalUrl?: string | null;
      mimeType?: string | null;
      size?: number | null;
      fileExtension?: string | null;
    }) => {
      await handleOpenFile(
        {
          id: topic.itemId ?? topic.name,
          fileName: topic.name,
          url: topic.url,
          storageBucket: topic.storageBucket,
          storagePath: topic.storagePath,
          originalUrl: topic.originalUrl,
          mimeType: topic.mimeType,
          size: topic.size ?? null,
          fileExtension:
            topic.fileExtension ??
            (topic.name?.split(".").pop()?.toLowerCase() || null),
        },
        topic.name,
      );
    },
    [handleOpenFile],
  );

  // Download module as ZIP - must be defined before it's used
  const downloadModuleAsZip = useCallback(
    async (module: {
      week: string;
      title: string;
      position: number;
      topics: Array<{
        name: string;
        hasPdf: boolean;
        itemId?: number | string | null;
        itemType?: string | null;
        storagePath?: string | null;
        storageBucket?: string | null;
        url?: string | null;
        originalUrl?: string | null;
        mimeType?: string | null;
        fileName?: string | null;
        size?: number | null;
        fileExtension?: string | null;
      }>;
    }) => {
      if (!course) return;

      // Filter out items that don't have downloadable content
      const downloadableItems = module.topics.filter(
        (topic) =>
          topic.hasPdf && (topic.storagePath || topic.url || topic.originalUrl),
      );

      if (downloadableItems.length === 0) {
        toast({
          title: "No files to download",
          description: "This module doesn't contain any downloadable files.",
          variant: "destructive",
        });
        return;
      }

      try {
        const zip = new JSZip();
        let downloadedCount = 0;
        let failedCount = 0;

        // Show loading toast
        const loadingToast = toast({
          title: "Preparing download...",
          description: `Downloading ${downloadableItems.length} file(s) from ${module.title}`,
        });

        // Download each file and add to ZIP
        for (const item of downloadableItems) {
          try {
            // Resolve file URL
            const fileUrl = await resolveFileUrl(
              {
                url: item.url,
                storageBucket: item.storageBucket,
                storagePath: item.storagePath,
                originalUrl: item.originalUrl,
              },
              3600,
            );

            // If we couldn't resolve a URL, try using originalUrl directly
            const finalUrl = fileUrl || item.originalUrl || item.url;

            if (!finalUrl) {
              console.warn(
                `[ClassDetail] No URL available for item: ${item.name}`,
              );
              failedCount++;
              continue;
            }

            // Fetch the file
            const response = await fetch(finalUrl);
            if (!response.ok) {
              throw new Error(`Failed to fetch file: ${response.statusText}`);
            }

            const blob = await response.blob();
            const fileName =
              item.fileName ||
              item.name ||
              `file-${item.itemId || downloadedCount}`;

            // Add to ZIP
            zip.file(fileName, blob);
            downloadedCount++;
          } catch (error) {
            console.error(
              `[ClassDetail] Error downloading file ${item.name}:`,
              error,
            );
            failedCount++;
          }
        }

        if (downloadedCount === 0) {
          toast({
            title: "Download failed",
            description: "Unable to download any files from this module.",
            variant: "destructive",
          });
          return;
        }

        // Generate ZIP file
        const zipBlob = await zip.generateAsync({ type: "blob" });

        // Create download link
        const url = URL.createObjectURL(zipBlob);
        const link = document.createElement("a");
        link.href = url;

        // Sanitize filename: "{Course Name}: {Module Name}"
        const courseName = course.name || course.code || "Course";
        const moduleName = module.title || "Module";
        const zipFileName = `${courseName}: ${moduleName}.zip`;

        // Remove invalid characters for filenames
        const sanitizedFileName = zipFileName.replace(/[<>:"/\\|?*]/g, "_");

        link.download = sanitizedFileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        // Show success toast
        toast({
          title: "Download complete",
          description: `Downloaded ${downloadedCount} file(s)${failedCount > 0 ? ` (${failedCount} failed)` : ""}`,
        });
      } catch (error) {
        console.error("[ClassDetail] Error creating ZIP:", error);
        toast({
          title: "Download failed",
          description: "An error occurred while creating the ZIP file.",
          variant: "destructive",
        });
      }
    },
    [course, resolveFileUrl, toast],
  );

  // Memoized data computations - must be before early returns
  const courseFilesRaw = useMemo(() => {
    if (!course || !mockCanvasData?.files) return [];
    return mockCanvasData.files
      .filter((f) => {
        const fileCourseId =
          typeof f.courseId === "string"
            ? parseInt(f.courseId, 10)
            : f.courseId;
        const currentCourseId =
          typeof course.id === "string" ? parseInt(course.id, 10) : course.id;
        return fileCourseId === currentCourseId;
      })
      .sort((a, b) => (a.fileName || "").localeCompare(b.fileName || ""));
  }, [course, mockCanvasData?.files]);

  const courseFiles = useMemo(() => {
    const dedupMap = new Map<string, (typeof courseFilesRaw)[number]>();
    courseFilesRaw.forEach((file) => {
      const key = `${(file.fileName || "").toLowerCase()}|${file.folder || ""}`;
      if (!dedupMap.has(key)) {
        dedupMap.set(key, file);
      } else {
        const existing = dedupMap.get(key)!;
        if (
          (!existing.storagePath && file.storagePath) ||
          (!existing.url && file.url)
        ) {
          dedupMap.set(key, file);
        }
      }
    });
    return Array.from(dedupMap.values());
  }, [courseFilesRaw]);

  // Debug logging - must be before any early returns
  useEffect(() => {
    if (courseId && mockCanvasData && course) {
      console.log("[ClassDetail] Course ID from URL:", courseId);
      console.log(
        "[ClassDetail] Available course IDs:",
        mockCanvasData.courses.map((c) => c.id),
      );
      console.log("[ClassDetail] Found course:", course);
      const courseModulesCount =
        mockCanvasData.modules?.filter((m) => {
          const moduleCourseId =
            typeof m.courseId === "string"
              ? parseInt(m.courseId, 10)
              : m.courseId;
          const currentCourseId =
            typeof course.id === "string" ? parseInt(course.id, 10) : course.id;
          return moduleCourseId === currentCourseId;
        }).length || 0;
      console.log("[ClassDetail] Course modules:", courseModulesCount);
    }
  }, [courseId, mockCanvasData, course]);

  // Data derivations that depend on Canvas data and course being present
  const announcements = useMemo(() => {
    if (!mockCanvasData?.announcements || !course) return [];
    return (
      mockCanvasData.announcements
        .filter((a) => a.courseId === course.id)
        .map((a) => {
          // Handle null or invalid dates - check multiple possible date fields
          let dateStr = "No date";
          let dateValue: Date | null = null;

          // Try to parse postedAt (ISO date string or other formats)
          if (a.postedAt) {
            try {
              const date = new Date(a.postedAt);
              if (!isNaN(date.getTime())) {
                dateValue = date;
                // Check if the original string contains time information
                const hasTime =
                  String(a.postedAt).match(/\d{1,2}:\d{2}/) ||
                  String(a.postedAt)
                    .toLowerCase()
                    .match(/(am|pm)/);
                if (hasTime) {
                  dateStr = date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  });
                } else {
                  dateStr = date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  });
                }
              }
            } catch (e) {
              // Try parsing as a formatted string like "Posted Aug 20 12:58pm"
              try {
                const dateMatch = String(a.postedAt).match(
                  /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{1,2}):(\d{2})(am|pm)/i,
                );
                if (dateMatch) {
                  const [, month, day, hour, minute, ampm] = dateMatch;
                  const monthMap: Record<string, number> = {
                    jan: 0,
                    feb: 1,
                    mar: 2,
                    apr: 3,
                    may: 4,
                    jun: 5,
                    jul: 6,
                    aug: 7,
                    sep: 8,
                    oct: 9,
                    nov: 10,
                    dec: 11,
                  };
                  const monthIndex = monthMap[month.toLowerCase()];
                  let hour24 = parseInt(hour);
                  if (ampm.toLowerCase() === "pm" && hour24 !== 12)
                    hour24 += 12;
                  if (ampm.toLowerCase() === "am" && hour24 === 12) hour24 = 0;
                  const year = new Date().getFullYear();
                  const date = new Date(
                    year,
                    monthIndex,
                    parseInt(day),
                    hour24,
                    parseInt(minute),
                  );
                  if (!isNaN(date.getTime())) {
                    dateValue = date;
                    dateStr = date.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    });
                  }
                }
              } catch (e2) {
                console.warn(
                  "[ClassDetail] Invalid date for announcement:",
                  a.id,
                  a.postedAt,
                );
              }
            }
          }

          return {
            id: a.id,
            date: dateStr,
            dateValue: dateValue, // Store for sorting
            text: a.message,
            title: a.title,
            attachments: a.attachments || [],
          };
        })
        // Sort by date in reverse order (most recent first)
        .sort((a, b) => {
          // If both have dates, sort by date (newest first)
          if (a.dateValue && b.dateValue) {
            return b.dateValue.getTime() - a.dateValue.getTime();
          }
          // If only one has a date, prioritize it
          if (a.dateValue && !b.dateValue) return -1;
          if (!a.dateValue && b.dateValue) return 1;
          // If neither has a date, maintain original order
          return 0;
        })
    );
  }, [mockCanvasData?.announcements, course]);

  const allUpcoming = useMemo(() => {
    if (!mockCanvasData?.assignments || !course) return [];
    return mockCanvasData.assignments
      .filter((a) => a.courseId === course.id && a.workflowState === "pending")
      .map((a) => ({
        id: a.id,
        title: a.title,
        dueAt: a.dueAt, // Keep original for sorting
        due: new Date(a.dueAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
        type: a.submissionTypes[0]?.includes("quiz") ? "Quiz" : "Assignment",
        points: a.pointsPossible,
        isCompleted: completedAssignments.has(a.id),
        isMidterm: a.title.toLowerCase().includes("midterm"),
        canvasUrl: a.url,
      }))
      .sort((a, b) => {
        // Completed assignments always go to the bottom
        if (a.isCompleted && !b.isCompleted) return 1;
        if (!a.isCompleted && b.isCompleted) return -1;
        // Same completion status: sort by due date chronologically (soonest first)
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      });
  }, [mockCanvasData?.assignments, course, completedAssignments]);
  const upcoming = allUpcoming;

  // Load modules, pages, and files for this course
  const courseModules = useMemo(() => {
    if (!mockCanvasData?.modules || !course) return [];
    return mockCanvasData.modules
      .filter((m) => {
        const moduleCourseId =
          typeof m.courseId === "string"
            ? parseInt(m.courseId, 10)
            : m.courseId;
        const currentCourseId =
          typeof course.id === "string" ? parseInt(course.id, 10) : course.id;
        return moduleCourseId === currentCourseId;
      })
      .map((m) => {
        // Parse items with better error handling
        let items: Array<{
          id: number | string;
          title?: string;
          name?: string;
          type?: string;
          storagePath?: string | null;
          storageBucket?: string | null;
          originalUrl?: string | null;
          mimeType?: string | null;
          fileName?: string | null;
          size?: number | null;
        }> = [];

        if (m.items) {
          if (Array.isArray(m.items)) {
            items = m.items;
          } else if (typeof m.items === "object" && (m.items as any).items) {
            items = Array.isArray((m.items as any).items)
              ? (m.items as any).items
              : [];
          }
        }

        // Normalize items to ensure they have required properties
        items = items.map((item) => ({
          ...item,
          id: item.id || 0,
          title: item.title || item.name || "Untitled Item",
          name: item.title || item.name || "Untitled Item",
          type: item.type || "File",
          fileName: item.fileName || item.title || item.name || "Untitled Item",
          mimeType: item.mimeType || null,
          size: item.size || null,
        }));

        // Deduplicate items based on id + title + fileName combination
        const seenItems = new Map<string, boolean>();
        items = items.filter((item) => {
          const key = `${item.id}|${item.title}|${item.fileName || ""}`;
          if (seenItems.has(key)) {
            return false; // Duplicate, filter it out
          }
          seenItems.set(key, true);
          return true;
        });

        return {
          id: m.id,
          name: m.name || "Untitled Module",
          position: m.position || 0,
          items: items,
        };
      })
      .sort((a, b) => a.position - b.position);
  }, [mockCanvasData?.modules, course]);

  const allModules =
    courseModules.length > 0
      ? courseModules.map((module, index) => ({
          week: `Module ${module.position || index + 1}`,
          title: module.name,
          position: module.position || index + 1,
          topics:
            module.items.length > 0
              ? module.items.map((item) => ({
                  name: item.title || item.name || "Untitled Item",
                  hasPdf:
                    item.type === "File" ||
                    item.type === "Page" ||
                    item.type === "Assignment",
                  itemId: item.id ?? null,
                  itemType: item.type ?? "item",
                  storagePath: (item as any).storagePath || null,
                  storageBucket: (item as any).storageBucket || null,
                  url:
                    (item as any).storagePath ||
                    (item as any).originalUrl ||
                    null,
                  originalUrl: (item as any).originalUrl || null,
                  mimeType: (item as any).mimeType || null,
                  fileName:
                    (item as any).fileName ||
                    item.title ||
                    item.name ||
                    "Untitled Item",
                  size: (item as any).size || null,
                  fileExtension:
                    ((item as any).fileName || item.title || item.name)
                      ?.split(".")
                      ?.pop()
                      ?.toLowerCase() || null,
                }))
              : [
                  {
                    name: "No items in this module yet",
                    hasPdf: false,
                    itemId: null,
                    itemType: null,
                  },
                ],
        }))
      : [
          {
            week: "No modules available",
            title: "Course content will appear here",
            position: 0,
            topics: [
              {
                name: "Modules will be displayed here when available",
                hasPdf: false,
                itemId: null,
                itemType: null,
              },
            ],
          },
        ];

  // Show all modules sequentially (no pagination)
  const modules = allModules;

  const coursePages = useMemo(() => {
    if (!mockCanvasData?.pages || !course) return [];
    return mockCanvasData.pages
      .filter((p) => {
        const pageCourseId =
          typeof p.courseId === "string"
            ? parseInt(p.courseId, 10)
            : p.courseId;
        const currentCourseId =
          typeof course.id === "string" ? parseInt(course.id, 10) : course.id;
        return pageCourseId === currentCourseId;
      })
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  }, [mockCanvasData?.pages, course]);

  // Find syllabus document from files, pages, or module items (hook placed before early returns)
  const syllabusDocument = useMemo(() => {
    if (!course) return null;

    const syllabusKeywords = ["syllabus"];
    const isSyllabusMatch = (text: string): boolean => {
      if (!text) return false;
      const lowerText = text.toLowerCase();
      return syllabusKeywords.some((keyword) => lowerText.includes(keyword));
    };

    // Priority 1: Check course files (PDF, DOCX preferred)
    const syllabusFiles = courseFiles.filter((file) => {
      const fileName = file.fileName || "";
      return isSyllabusMatch(fileName);
    });

    // Sort by preference: PDF > DOCX > other
    syllabusFiles.sort((a, b) => {
      const aExt = (a.fileName || "").split(".").pop()?.toLowerCase() || "";
      const bExt = (b.fileName || "").split(".").pop()?.toLowerCase() || "";
      const priority = { pdf: 1, docx: 2, doc: 3 };
      const aPriority = priority[aExt as keyof typeof priority] || 99;
      const bPriority = priority[bExt as keyof typeof priority] || 99;
      return aPriority - bPriority;
    });

    if (syllabusFiles.length > 0) {
      const file = syllabusFiles[0];
      return {
        type: "file" as const,
        id: file.id,
        title: file.fileName || "Syllabus",
        fileName: file.fileName || "Syllabus",
        url: file.url,
        storagePath: file.storagePath,
        storageBucket: file.storageBucket,
        originalUrl: file.originalUrl,
        mimeType: file.mimeType,
        size: file.size,
        fileExtension:
          (file.fileName || "").split(".").pop()?.toLowerCase() || null,
      };
    }

    // Priority 2: Check course pages
    const syllabusPages = coursePages.filter((page) => {
      const pageTitle = page.title || "";
      return isSyllabusMatch(pageTitle);
    });

    if (syllabusPages.length > 0) {
      const page = syllabusPages[0];
      return {
        type: "page" as const,
        id: page.id,
        title: page.title || "Syllabus",
        url: page.url,
        htmlContent: page.htmlContent,
      };
    }

    // Priority 3: Check module items
    for (const module of courseModules) {
      for (const item of module.items) {
        const itemTitle = item.title || item.name || item.fileName || "";
        if (isSyllabusMatch(itemTitle)) {
          return {
            type: "module-item" as const,
            id: item.id,
            title: itemTitle,
            fileName: item.fileName || itemTitle,
            storagePath: item.storagePath,
            storageBucket: item.storageBucket,
            originalUrl: item.originalUrl,
            mimeType: item.mimeType,
            fileExtension:
              (item.fileName || itemTitle).split(".").pop()?.toLowerCase() ||
              null,
          };
        }
      }
    }

    return null;
  }, [course, courseFiles, coursePages, courseModules]);

  // Open syllabus in sidebar - must be before early returns to preserve hook order
  const openSyllabus = useCallback(async () => {
    if (!course) return;

    // If we found a syllabus document, open it
    if (syllabusDocument) {
      if (
        syllabusDocument.type === "file" ||
        syllabusDocument.type === "module-item"
      ) {
        // Handle as file
        await handleOpenFile(
          {
            id: syllabusDocument.id,
            fileName: syllabusDocument.fileName || syllabusDocument.title,
            url: syllabusDocument.url,
            storagePath: syllabusDocument.storagePath,
            storageBucket: syllabusDocument.storageBucket,
            originalUrl: syllabusDocument.originalUrl,
            mimeType: syllabusDocument.mimeType,
            size: syllabusDocument.size || null,
            fileExtension: syllabusDocument.fileExtension || null,
          },
          syllabusDocument.title,
        );
      } else if (syllabusDocument.type === "page") {
        // Handle as page - open in sidebar as announcement type (supports HTML content)
        openSidebarItem({
          id: `syllabus-page-${syllabusDocument.id}`,
          type: "announcement",
          title: syllabusDocument.title,
          courseCode: course.code,
          content: syllabusDocument.htmlContent || "",
          canvasUrl: syllabusDocument.url,
        });
      }
    } else {
      // Fallback: Open Canvas syllabus page
      const canvasSyllabusUrl = `https://canvas.colorado.edu/courses/${course.id}/syllabus`;
      window.open(canvasSyllabusUrl, "_blank", "noopener noreferrer");
    }
  }, [course, syllabusDocument, handleOpenFile, openSidebarItem]);

  // Early returns AFTER all hooks have been called
  if (loading || !mockCanvasData) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <BookOpen className="w-8 h-8 animate-pulse mx-auto mb-4 text-foreground" />
            <p className="text-muted-foreground">Loading class details...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!course) {
    return (
      <Layout>
        <div className="text-center py-20">
          <h1 className="text-2xl font-semibold mb-4">Class not found</h1>
          <p className="text-muted-foreground mb-4">
            Course ID: {courseId ? courseId : "undefined"}
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            Available course IDs:{" "}
            {mockCanvasData?.courses?.map?.((c) => c.id).join(", ") || "None"}
          </p>
          <Button onClick={() => navigate("/courses")} className="glass-button">
            Back to Classes
          </Button>
        </div>
      </Layout>
    );
  }

  // Get Canvas course URL
  const canvasCourseUrl = `https://canvas.colorado.edu/courses/${course.id}`;

  return (
    <div className="relative w-full">
      {/* Main Content Wrapper */}
      {!isFullscreen && (
        <div
          className="transition-all duration-150 ease-out max-lg:pr-0"
          style={{ paddingRight: isSidebarOpen ? sidebarWidth : 0 }}
        >
          <Layout>
            <div className="px-5 sm:px-8 pb-10">
              {/* Course Header */}
              <header className="pt-6 sm:pt-8 pb-3 sm:pb-4 border-b border-border mb-8">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h1 className="page-header">{course.code}</h1>
                    <p className="page-header-subtitle">{course.name}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {course.instructor}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button
                      data-sidebar-trigger
                      className="slide-in-button border border-foreground/20"
                      onClick={openSyllabus}
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      <span>Syllabus</span>
                    </Button>
                    <Button
                      asChild
                      className="slide-in-button border border-foreground/20"
                    >
                      <a
                        href={canvasCourseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <BookOpen className="w-4 h-4 mr-2" />
                        <span>Textbook</span>
                      </a>
                    </Button>
                  </div>
                </div>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Main Content */}
                <div className="space-y-4 lg:col-span-2">
                  {/* Modules */}
                  <GlassCard hover={false} className="p-0">
                    <div className="px-5 py-4 border-b border-border">
                      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                        Course Modules
                      </h2>
                    </div>
                    <div className="p-5">
                      <Accordion
                        type="single"
                        collapsible
                        className="space-y-3"
                      >
                        {modules.map((module, index) => (
                          <AccordionItem
                            key={index}
                            value={`item-${index}`}
                            className="border-none bg-white/5 overflow-hidden"
                          >
                            <AccordionTrigger className="px-4 py-3 slide-in-button border border-foreground/20 text-foreground hover:no-underline">
                              <div className="flex items-center gap-3 text-left flex-1">
                                <span className="text-xs text-muted-foreground w-6">
                                  {String(index + 1).padStart(2, "0")}
                                </span>
                                <div>
                                  <p className="text-xs text-foreground/60">
                                    {module.week}
                                  </p>
                                  <p className="text-sm font-medium text-foreground/90">
                                    {module.title}
                                  </p>
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="module-download-btn h-8 w-8 p-0 hover:opacity-70 transition-opacity flex-shrink-0 mr-2"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  downloadModuleAsZip(module);
                                }}
                                title={`Download ${module.title}`}
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                            </AccordionTrigger>
                            <AccordionContent className="px-4 pb-4">
                              <ul
                                className="space-y-2 ml-11"
                                onMouseLeave={() => setHoveredTopicIndex(null)}
                              >
                                {module.topics.map((topic, i) => {
                                  const isHovered =
                                    hoveredTopicIndex?.moduleIndex === index &&
                                    hoveredTopicIndex?.topicIndex === i;
                                  const canOpen =
                                    topic.hasPdf &&
                                    (topic.storagePath || topic.url);
                                  return (
                                    <li
                                      key={i}
                                      data-sidebar-trigger
                                      className={`text-sm flex items-center gap-2 relative ${
                                        canOpen
                                          ? "text-foreground/70 hover:text-foreground cursor-pointer px-2 py-1"
                                          : "text-foreground/70"
                                      }`}
                                      onMouseEnter={() => {
                                        if (canOpen) {
                                          setHoveredTopicIndex({
                                            moduleIndex: index,
                                            topicIndex: i,
                                          });
                                        }
                                      }}
                                      onClick={() => {
                                        if (canOpen) {
                                          openTopic(topic);
                                        }
                                      }}
                                    >
                                      {isHovered && (
                                        <motion.div
                                          layoutId="topicOutline"
                                          className="absolute inset-0 border-2 border-foreground"
                                          initial={false}
                                          transition={{
                                            type: "tween",
                                            duration: 0.1,
                                            ease: "easeOut",
                                          }}
                                        />
                                      )}
                                      <div className="relative z-10 flex items-center gap-2 w-full">
                                        <div className="w-1.5 h-1.5 bg-primary/50 flex-shrink-0" />
                                        <span className="flex-1">
                                          {topic.name}
                                        </span>
                                        {topic.hasPdf && (
                                          <FileText className="w-3 h-3 text-foreground/50 flex-shrink-0" />
                                        )}
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </div>
                  </GlassCard>
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                  {/* Chat */}
                  <GlassCard hover={false} className="p-0">
                    <div className="px-5 py-4 border-b border-border">
                      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                        Chat
                      </h2>
                    </div>
                    <div className="p-5">
                      <button
                        onClick={() => navigate(`/courses/${course.id}/chat`)}
                        className="slide-in-button border border-foreground/20 w-full px-4 py-2 text-sm font-medium text-foreground flex items-center justify-center gap-2"
                      >
                        <MessageCircle className="w-4 h-4" />
                        <span className="relative z-10">Chat with Class</span>
                      </button>
                    </div>
                  </GlassCard>

                  {/* Announcements */}
                  {announcements.length > 0 && (
                    <GlassCard hover={false} className="p-0">
                      <div className="px-5 py-4 border-b border-border">
                        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                          Announcements
                        </h2>
                      </div>
                      <div className="p-5">
                        <div
                          className={`space-y-2 ${
                            announcements.length > 3
                              ? "max-h-[280px] pr-2 overflow-y-auto"
                              : ""
                          }`}
                          onMouseLeave={() => setHoveredAnnouncementIndex(null)}
                          style={{
                            scrollbarWidth: "thin",
                            scrollbarColor: "rgba(255,255,255,0.2) transparent",
                            maskImage:
                              announcements.length > 3
                                ? "linear-gradient(to bottom, black 0%, black 75%, transparent 100%)"
                                : "none",
                            WebkitMaskImage:
                              announcements.length > 3
                                ? "linear-gradient(to bottom, black 0%, black 75%, transparent 100%)"
                                : "none",
                          }}
                        >
                          {announcements.map((announcement, index) => {
                            const isHovered =
                              hoveredAnnouncementIndex === index;
                            return (
                              <div
                                key={announcement.id}
                                data-sidebar-trigger
                                onClick={() => {
                                  // Map attachments to linkedFiles format
                                  const linkedFiles = (
                                    announcement.attachments || []
                                  ).map((att: any, idx: number) => {
                                    const fileName =
                                      att.filename ||
                                      att.display_name ||
                                      att.name ||
                                      `Attachment ${idx + 1}`;
                                    const fileUrl =
                                      att.url || att.download_url || "";
                                    // Extract file extension from URL if not in filename
                                    let fileExtension = fileName.includes(".")
                                      ? fileName.split(".").pop()?.toLowerCase()
                                      : "";
                                    if (!fileExtension && fileUrl) {
                                      // Try to extract from URL
                                      const urlMatch = fileUrl.match(
                                        /\.([a-z0-9]+)(?:\?|$)/i,
                                      );
                                      if (urlMatch)
                                        fileExtension =
                                          urlMatch[1].toLowerCase();
                                    }
                                    return {
                                      id: `file-${announcement.id}-${idx}`,
                                      name: fileName,
                                      type: fileExtension || "file",
                                      url: fileUrl,
                                      mimeType:
                                        att.content_type || att.mimeType || "",
                                      size: att.size,
                                    };
                                  });

                                  // Get content - try text first, then check if it's empty and log for debugging
                                  const announcementContent =
                                    announcement.text || "";
                                  if (!announcementContent) {
                                    console.warn(
                                      "[ClassDetail] Announcement has no content:",
                                      {
                                        id: announcement.id,
                                        title: announcement.title,
                                        text: announcement.text,
                                        hasAttachments:
                                          (announcement.attachments || [])
                                            .length > 0,
                                      },
                                    );
                                  }

                                  openSidebarItem({
                                    id: String(announcement.id),
                                    type: "announcement",
                                    title: announcement.title,
                                    content: announcementContent,
                                    date: announcement.date,
                                    courseCode: course?.code,
                                    linkedFiles:
                                      linkedFiles.length > 0
                                        ? linkedFiles
                                        : undefined,
                                  });
                                }}
                                onMouseEnter={() =>
                                  setHoveredAnnouncementIndex(index)
                                }
                                className="p-3 cursor-pointer relative"
                              >
                                {isHovered && (
                                  <motion.div
                                    layoutId="announcementSidebar"
                                    className="absolute left-0 top-0 bottom-0 w-[3px] bg-foreground z-0"
                                    initial={false}
                                    transition={{
                                      type: "tween",
                                      duration: 0.1,
                                      ease: "easeOut",
                                    }}
                                  />
                                )}
                                <div className="relative z-10">
                                  <p className="text-xs text-primary mb-1">
                                    {announcement.date}
                                  </p>
                                  <p className="text-sm font-medium text-foreground/90">
                                    {announcement.title}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </GlassCard>
                  )}

                  {/* Upcoming */}
                  {upcoming.length > 0 && (
                    <GlassCard hover={false} className="p-0">
                      <div className="px-5 py-4 border-b border-border">
                        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                          Upcoming
                        </h2>
                      </div>
                      <div className="p-5">
                        <div
                          className={`space-y-2 ${
                            upcoming.length > 5
                              ? "max-h-[400px] overflow-y-auto pr-2 fade-list"
                              : ""
                          }`}
                          onMouseLeave={() => setHoveredUpcomingIndex(null)}
                          style={{
                            scrollbarWidth: "thin",
                            scrollbarColor: "rgba(255,255,255,0.2) transparent",
                          }}
                        >
                          {upcoming.map((item, index) => {
                            const borderClass =
                              item.isMidterm || item.type === "Quiz"
                                ? "border-2 border-red-500/60"
                                : "";
                            const isHovered = hoveredUpcomingIndex === index;

                            return (
                              <div
                                key={item.id}
                                data-sidebar-trigger
                                onClick={() =>
                                  openSidebarItem({
                                    id: String(item.id),
                                    type: "assignment",
                                    title: item.title,
                                    subtitle: `${item.type} • ${course?.code}`,
                                    dueDate: item.due,
                                    points: item.points,
                                    isCompleted: item.isCompleted,
                                    courseCode: course?.code,
                                    canvasUrl: item.canvasUrl,
                                  })
                                }
                                onMouseEnter={() =>
                                  setHoveredUpcomingIndex(index)
                                }
                                className={`p-3 cursor-pointer relative ${borderClass} ${
                                  item.isCompleted ? "opacity-60" : ""
                                }`}
                              >
                                {isHovered && (
                                  <motion.div
                                    layoutId="upcomingSidebar"
                                    className="absolute left-0 top-0 bottom-0 w-[3px] bg-foreground z-0"
                                    initial={false}
                                    transition={{
                                      type: "tween",
                                      duration: 0.1,
                                      ease: "easeOut",
                                    }}
                                  />
                                )}
                                <div className="relative z-10">
                                  <div className="flex items-start gap-3">
                                    <Checkbox
                                      checked={item.isCompleted}
                                      onCheckedChange={() => {
                                        toggleAssignmentComplete(item.id);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="flex-shrink-0 mt-0.5"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-start justify-between mb-2">
                                        <p
                                          className={`text-sm font-medium ${
                                            item.isCompleted
                                              ? "line-through text-foreground/50"
                                              : "text-foreground/90"
                                          }`}
                                        >
                                          {item.title}
                                        </p>
                                        <span className="text-[10px] px-2 py-1 bg-accent/30 text-accent-foreground flex-shrink-0 ml-2">
                                          {item.type}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-3 text-xs text-foreground/60">
                                        <div className="flex items-center gap-1">
                                          <Clock className="w-3 h-3" />
                                          <span>{item.due}</span>
                                        </div>
                                        {item.points && (
                                          <span className="text-foreground/50">
                                            {item.points}{" "}
                                            {item.points === 1
                                              ? "point"
                                              : "points"}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </GlassCard>
                  )}

                  {/* Grades */}
                  <GlassCard hover={false} className="p-0">
                    <div className="px-5 py-4 border-b border-border">
                      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                        Grades
                      </h2>
                    </div>
                    <div className="p-5">
                      <button
                        onClick={() => {
                          const canvasGradesUrl = `https://canvas.colorado.edu/courses/${course.id}/grades`;
                          window.open(
                            canvasGradesUrl,
                            "_blank",
                            "noopener noreferrer",
                          );
                        }}
                        className="slide-in-button border border-foreground/20 w-full px-4 py-2 text-sm font-medium text-foreground"
                      >
                        <span className="relative z-10">View Grades</span>
                      </button>
                    </div>
                  </GlassCard>
                </div>
              </div>
            </div>
          </Layout>
        </div>
      )}

      {/* Sidebar Viewer */}
      <SidebarViewer />
    </div>
  );
};

export default ClassDetail;
