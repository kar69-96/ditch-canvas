import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { X, FileText, Bell, Clock, ChevronRight, ExternalLink, Paperclip, GripVertical, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

// Types for sidebar items
export type SidebarItemType = "assignment" | "announcement" | "file";

export interface LinkedFile {
  id: string;
  name: string;
  type: string; // legacy label (pdf, doc, etc.)
  url?: string;
  mimeType?: string;
  size?: number;
}

export interface SidebarItem {
  id: string;
  type: SidebarItemType;
  title: string;
  subtitle?: string;
  content?: string;
  date?: string;
  dueDate?: string;
  points?: number;
  isCompleted?: boolean;
  courseCode?: string;
  canvasUrl?: string; // URL to open in Canvas
  linkedFiles?: LinkedFile[]; // Files attached to this item
  fileUrl?: string; // For file type items - the actual file URL
  fileName?: string;
  fileMimeType?: string;
  fileSize?: number;
  fileExtension?: string;
  metadata?: Record<string, any>;
}

interface SidebarTab {
  id: string;
  item: SidebarItem;
}

interface SidebarContextType {
  isOpen: boolean;
  tabs: SidebarTab[];
  activeTabId: string | null;
  sidebarWidth: number;
  isFullscreen: boolean;
  openItem: (item: SidebarItem) => void;
  closeItem: (tabId: string) => void;
  closeSidebar: () => void;
  setActiveTab: (tabId: string) => void;
  toggleItemComplete: (itemId: string) => void;
  setSidebarWidth: (width: number) => void;
  toggleFullscreen: () => void;
}

const SidebarContext = createContext<SidebarContextType | null>(null);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}

interface SidebarProviderProps {
  children: React.ReactNode;
}

const DEFAULT_WIDTH = 560;
const MIN_WIDTH = 400;
const MAX_WIDTH = 900;

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "ogg"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "aac", "flac"]);
const OFFICE_EXTENSIONS = new Set([
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
const TEXT_EXTENSIONS = new Set(["txt", "md", "csv", "json", "tsv", "log"]);

type FilePreviewType = "pdf" | "image" | "video" | "audio" | "office" | "text" | "fallback";

interface FilePreviewConfig {
  type: FilePreviewType;
  url?: string;
  originalUrl?: string;
}

const getFileExtension = (item: SidebarItem): string => {
  if (item.fileExtension) return item.fileExtension.toLowerCase();
  const sourceName = item.fileName || item.title || "";
  const match = sourceName.split(".").pop();
  return match ? match.toLowerCase() : "";
};

const encodeForOfficeViewer = (url: string) =>
  encodeURIComponent(url).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const buildOfficeViewerUrl = (url: string) =>
  `https://view.officeapps.live.com/op/embed.aspx?src=${encodeForOfficeViewer(url)}`;

const getFilePreviewConfig = (item: SidebarItem): FilePreviewConfig => {
  if (!item.fileUrl) {
    return { type: "fallback" };
  }

  const fileUrl = item.fileUrl;
  const extension = getFileExtension(item);
  const mime = (item.fileMimeType || "").toLowerCase();

  // Canvas URLs cannot be embedded due to CORS/authentication - show download button instead
  const isCanvasUrl = fileUrl.includes('canvas.colorado.edu');
  if (isCanvasUrl) {
    return { type: "fallback", url: fileUrl };
  }

  const isPdf =
    mime.includes("pdf") ||
    extension === "pdf" ||
    fileUrl.startsWith("data:application/pdf");
  if (isPdf) {
    return { type: "pdf", url: fileUrl };
  }

  const isImage =
    mime.startsWith("image/") ||
    IMAGE_EXTENSIONS.has(extension) ||
    fileUrl.startsWith("data:image/");
  if (isImage) {
    return { type: "image", url: fileUrl };
  }

  const isVideo =
    mime.startsWith("video/") ||
    VIDEO_EXTENSIONS.has(extension) ||
    fileUrl.startsWith("data:video/");
  if (isVideo) {
    return { type: "video", url: fileUrl };
  }

  const isAudio =
    mime.startsWith("audio/") ||
    AUDIO_EXTENSIONS.has(extension) ||
    fileUrl.startsWith("data:audio/");
  if (isAudio) {
    return { type: "audio", url: fileUrl };
  }

  if (OFFICE_EXTENSIONS.has(extension)) {
    return { type: "office", url: buildOfficeViewerUrl(fileUrl), originalUrl: fileUrl };
  }

  const isText = mime.startsWith("text/") || TEXT_EXTENSIONS.has(extension);
  if (isText) {
    return { type: "text", url: fileUrl };
  }

  return { type: "fallback", url: fileUrl };
};

const formatFileSize = (size?: number) => {
  if (!size || size <= 0) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
};

export function SidebarProvider({ children }: SidebarProviderProps) {
  const [tabs, setTabs] = useState<SidebarTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = localStorage.getItem("sidebarWidth");
    return stored ? parseInt(stored) : DEFAULT_WIDTH;
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [completedItems, setCompletedItems] = useState<Set<string>>(() => {
    const stored = localStorage.getItem("sidebarCompletedItems");
    return stored ? new Set(JSON.parse(stored)) : new Set();
  });

  // Sync completed items to localStorage
  useEffect(() => {
    localStorage.setItem("sidebarCompletedItems", JSON.stringify(Array.from(completedItems)));
  }, [completedItems]);

  // Sync sidebar width to localStorage
  useEffect(() => {
    localStorage.setItem("sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  const isOpen = tabs.length > 0;

  const openItem = useCallback((item: SidebarItem) => {
    const tabId = `tab-${item.type}-${item.id}`;
    
    setTabs((prev) => {
      // Check if item already exists
      const existingTab = prev.find((t) => t.id === tabId);
      if (existingTab) {
        setActiveTabId(tabId);
        return prev;
      }
      
      // Add new tab
      const newTab: SidebarTab = { id: tabId, item };
      setActiveTabId(tabId);
      return [...prev, newTab];
    });
  }, []);

  const closeItem = useCallback((tabId: string) => {
    setTabs((prev) => {
      const newTabs = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null);
      }
      return newTabs;
    });
  }, [activeTabId]);

  const closeSidebar = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
    setIsFullscreen(false);
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  const setActiveTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const toggleItemComplete = useCallback((itemId: string) => {
    setCompletedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
    
    // Also sync with completedAssignments in localStorage for numeric IDs
    // This ensures the main page updates when assignments are marked complete
    const numericId = parseInt(itemId);
    if (!isNaN(numericId)) {
      const stored = localStorage.getItem('completedAssignments');
      const completedAssignments = stored ? new Set<number>(JSON.parse(stored)) : new Set<number>();
      
      if (completedAssignments.has(numericId)) {
        completedAssignments.delete(numericId);
      } else {
        completedAssignments.add(numericId);
      }
      
      localStorage.setItem('completedAssignments', JSON.stringify(Array.from(completedAssignments)));
      
      // Trigger a custom event for same-window updates (storage events only work cross-window)
      window.dispatchEvent(new CustomEvent('completedAssignmentsUpdated'));
    }
    
    // Update the tab's item completion status
    setTabs((prev) =>
      prev.map((tab) =>
        tab.item.id === itemId
          ? { ...tab, item: { ...tab.item, isCompleted: !tab.item.isCompleted } }
          : tab
      )
    );
  }, []);

  return (
    <SidebarContext.Provider
      value={{
        isOpen,
        tabs,
        activeTabId,
        sidebarWidth,
        isFullscreen,
        openItem,
        closeItem,
        closeSidebar,
        setActiveTab,
        toggleItemComplete,
        setSidebarWidth,
        toggleFullscreen,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

// Sidebar Viewer Component
interface SidebarViewerProps {
  className?: string;
}

export function SidebarViewer({ className }: SidebarViewerProps) {
  const { isOpen, tabs, activeTabId, sidebarWidth, isFullscreen, closeItem, closeSidebar, setActiveTab, toggleItemComplete, setSidebarWidth, toggleFullscreen, openItem } = useSidebar();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(true);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // Handle ESC key to exit fullscreen
  useEffect(() => {
    if (!isFullscreen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        toggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, toggleFullscreen]);

  // Check for mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // When sidebar opens on mobile, show sidebar by default
  useEffect(() => {
    if (isOpen && isMobile) {
      setShowMobileSidebar(true);
    }
  }, [isOpen, isMobile]);

  // Handle resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = resizeStartX.current - e.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeStartWidth.current + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, setSidebarWidth]);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeItem = activeTab?.item;

  const getItemIcon = (type: SidebarItemType) => {
    switch (type) {
      case "assignment":
        return FileText;
      case "announcement":
        return Bell;
      case "file":
        return FileText;
      default:
        return FileText;
    }
  };

  if (!isOpen) return null;

  // Mobile view - full screen toggle
  if (isMobile) {
    return (
      <AnimatePresence>
        {showMobileSidebar && (
          <motion.div
            ref={sidebarRef}
            initial={{ opacity: 0, x: "100%" }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: "100%" }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={cn(
              "fixed inset-0 z-50 bg-background flex flex-col",
              className
            )}
          >
            {/* Mobile Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <button
                onClick={closeSidebar}
                className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors"
              >
                <X className="w-4 h-4" />
                Close all
              </button>
              <span className="text-sm text-muted-foreground">
                {tabs.length} {tabs.length === 1 ? "item" : "items"}
              </span>
            </div>

            {/* Tabs */}
            {tabs.length > 1 && (
              <div className="flex items-center gap-1 px-4 py-2 border-b border-border overflow-x-auto">
                {tabs.map((tab) => {
                  const Icon = getItemIcon(tab.item.type);
                  const isActive = tab.id === activeTabId;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap transition-colors border",
                        isActive
                          ? "bg-foreground text-background border-foreground"
                          : "bg-transparent text-muted-foreground border-border hover:text-foreground"
                      )}
                    >
                      <Icon className="w-3 h-3" />
                      <span className="truncate max-w-[100px]">{tab.item.title}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          closeItem(tab.id);
                        }}
                        className="ml-1 hover:opacity-70"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {activeItem && <SidebarContent item={activeItem} toggleComplete={toggleItemComplete} openItem={openItem} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  // Desktop view - sidebar on right with resize handle
  return (
    <AnimatePresence>
      <motion.div
        ref={sidebarRef}
        initial={{ width: 0, opacity: 0 }}
        animate={{ width: isFullscreen ? '100vw' : sidebarWidth, opacity: 1 }}
        exit={{ width: 0, opacity: 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className={cn(
          "fixed top-0 right-0 h-screen bg-background border-l border-border z-50 flex flex-col overflow-hidden",
          isResizing && "select-none",
          isFullscreen && "z-[100] border-l-0",
          className
        )}
        style={{ width: isFullscreen ? '100vw' : sidebarWidth }}
      >
        {/* Resize Handle - only show when not fullscreen */}
        {!isFullscreen && (
          <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-foreground/20 transition-colors z-50 group"
            onMouseDown={handleResizeStart}
          >
            <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-12 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <GripVertical className="w-3 h-3 text-muted-foreground" />
            </div>
          </div>
        )}

        {/* Header with Close All button */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <button
            onClick={closeSidebar}
            className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors"
          >
            <X className="w-4 h-4" />
            Close all
          </button>
          {!isFullscreen && (
            <span className="text-xs text-muted-foreground">
              Drag edge to resize
            </span>
          )}
          {isFullscreen && (
            <span className="text-xs text-muted-foreground">
              Press ESC to exit fullscreen
            </span>
          )}
        </div>

        {/* Tabs Bar - hide in fullscreen if only one tab */}
        {(!isFullscreen || tabs.length > 1) && (
          <div className="flex items-center gap-1 px-3 py-2 border-b border-border overflow-x-auto flex-shrink-0">
            {tabs.map((tab) => {
              const Icon = getItemIcon(tab.item.type);
              const isActive = tab.id === activeTabId;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap transition-all border",
                    isActive
                      ? "bg-foreground text-background border-foreground"
                      : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:border-muted-foreground"
                  )}
                >
                  <Icon className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate max-w-[140px]">{tab.item.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeItem(tab.id);
                    }}
                    className="ml-1 hover:opacity-70 flex-shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </button>
              );
            })}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            {activeItem && (
              <motion.div
                key={activeTabId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.1 }}
              >
                <SidebarContent item={activeItem} toggleComplete={toggleItemComplete} openItem={openItem} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// Sidebar Content Component
interface SidebarContentProps {
  item: SidebarItem;
  toggleComplete: (itemId: string) => void;
  openItem: (item: SidebarItem) => void;
}

function SidebarContent({ item, toggleComplete, openItem }: SidebarContentProps) {
  const { toggleFullscreen, isFullscreen } = useSidebar();
  const Icon = item.type === "assignment" ? FileText : item.type === "announcement" ? Bell : FileText;

  // For file type, show rich previews
  if (item.type === "file") {
    const previewConfig = getFilePreviewConfig(item);
    const formattedSize = formatFileSize(item.fileSize);
    const extension = getFileExtension(item);
    const downloadTarget = previewConfig.originalUrl || item.fileUrl;
    const hasInlinePreview = previewConfig.type !== "fallback" && !!previewConfig.url;
    const downloadLabel = previewConfig.type === "office" ? "Open Original" : "Open File";

    return (
      <div className="flex flex-col h-full">
        {/* File Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                File preview
              </span>
              {item.courseCode && (
                <>
                  <span className="text-muted-foreground">•</span>
                  <span className="text-xs text-muted-foreground">{item.courseCode}</span>
                </>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleFullscreen}
              className="h-8 w-8 p-0 hover:bg-secondary/50"
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              <Maximize2 className="w-4 h-4" />
            </Button>
          </div>
          <h2 className="text-lg font-semibold text-foreground">{item.title}</h2>
        </div>

        {/* File Preview */}
        <div className="flex-1 bg-secondary/20 flex items-center justify-center overflow-hidden">
          {previewConfig.type === "pdf" && previewConfig.url && (
            <iframe
              src={previewConfig.url}
              className="w-full h-full min-h-[500px]"
              title={item.title}
              loading="lazy"
            />
          )}

          {previewConfig.type === "image" && previewConfig.url && (
            <div className="w-full h-full flex items-center justify-center bg-background">
              <img
                src={previewConfig.url}
                alt={item.title}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          )}

          {previewConfig.type === "video" && previewConfig.url && (
            <video
              controls
              className="w-full h-full bg-black"
              src={previewConfig.url}
            >
              Your browser does not support embedded video.
            </video>
          )}

          {previewConfig.type === "audio" && previewConfig.url && (
            <div className="p-6 w-full flex flex-col items-center gap-4">
              <audio controls className="w-full" src={previewConfig.url}>
                Your browser does not support embedded audio.
              </audio>
              <p className="text-xs text-muted-foreground text-center">
                If playback fails, use the open button below.
              </p>
            </div>
          )}

          {previewConfig.type === "office" && previewConfig.url && (
            <iframe
              src={previewConfig.url}
              className="w-full h-full min-h-[500px]"
              title={`${item.title} preview`}
              loading="lazy"
            />
          )}

          {previewConfig.type === "text" && previewConfig.url && (
            <iframe
              src={previewConfig.url}
              className="w-full h-full min-h-[500px]"
              title={`${item.title} preview`}
              loading="lazy"
            />
          )}

          {!hasInlinePreview && (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <FileText className="w-16 h-16 text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground mb-4">
                {downloadTarget && downloadTarget.includes('canvas.colorado.edu')
                  ? "This file is hosted on Canvas and cannot be previewed directly. Click below to open it in a new tab."
                  : "Preview not available for this file type"}
              </p>
              {downloadTarget && (
                <Button
                  variant="outline"
                  onClick={() => window.open(downloadTarget, "_blank", "noopener noreferrer")}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  {downloadTarget.includes('canvas.colorado.edu') ? "Open on Canvas" : downloadLabel}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Meta + Actions */}
        <div className="p-4 border-t border-border flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {item.fileName && <span className="font-medium text-foreground">{item.fileName}</span>}
            {extension && (
              <span className="uppercase bg-secondary/50 px-2 py-0.5 rounded">
                {extension}
              </span>
            )}
            {formattedSize && <span>{formattedSize}</span>}
            {item.fileMimeType && <span>{item.fileMimeType}</span>}
          </div>
          {downloadTarget && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(downloadTarget, "_blank", "noopener noreferrer")}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              {downloadLabel}
            </Button>
          )}
        </div>
      </div>
    );
  }
  
  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        {/* Type badge and Fullscreen button */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {item.type}
            </span>
            {item.courseCode && (
              <>
                <span className="text-muted-foreground">•</span>
                <span className="text-xs text-muted-foreground">{item.courseCode}</span>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            className="h-8 w-8 p-0 hover:bg-secondary/50"
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
        </div>
        
        {/* Title with Mark as Complete inline */}
        <div className="flex items-center justify-between gap-4 mb-2">
          <h2 className={cn(
            "text-xl font-semibold text-foreground flex-1",
            item.isCompleted && "line-through opacity-60"
          )}>
            {item.title}
          </h2>
          {item.type === "assignment" && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <Checkbox
                checked={item.isCompleted || false}
                onCheckedChange={() => toggleComplete(item.id)}
                id={`complete-${item.id}`}
              />
              <label 
                htmlFor={`complete-${item.id}`}
                className="text-sm text-muted-foreground cursor-pointer whitespace-nowrap"
              >
                {item.isCompleted ? "Complete" : "Mark complete"}
              </label>
            </div>
          )}
        </div>
        
        {/* Subtitle */}
        {item.subtitle && (
          <p className="text-sm text-muted-foreground">{item.subtitle}</p>
        )}
      </div>
      
      {/* Meta info */}
      <div className="flex flex-wrap items-center gap-4 mb-6 text-sm text-muted-foreground">
        {item.date && (
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4" />
            <span>Posted {item.date}</span>
          </div>
        )}
        {item.dueDate && (
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4" />
            <span>Due {item.dueDate}</span>
          </div>
        )}
        {item.points !== undefined && (
          <span className="px-2 py-1 bg-secondary/50 text-secondary-foreground text-xs">
            {item.points} {item.points === 1 ? "point" : "points"}
          </span>
        )}
      </div>

      {/* Open in Canvas Button for Assignments */}
      {item.type === "assignment" && item.canvasUrl && (
        <div className="mb-6">
          <Button
            onClick={() => window.open(item.canvasUrl, "_blank", "noopener noreferrer")}
            className="w-full bg-white/10 hover:bg-white/20 border border-foreground/20 text-foreground"
            variant="outline"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Open in Canvas
          </Button>
        </div>
      )}

      {/* Content */}
      {item.type === "announcement" && (
        <div className="mb-6 border-t border-border pt-6">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Content
          </h3>
          {item.content && item.content.trim() ? (
            <div className="text-sm text-foreground/90 leading-relaxed max-h-[60vh] overflow-y-auto pr-2">
              {item.content.includes('<') && item.content.includes('>') ? (
                // If content appears to be HTML, render it as HTML
                <div 
                  className="prose prose-sm max-w-none break-words prose-headings:text-foreground prose-p:text-foreground/90 prose-a:text-primary prose-strong:text-foreground"
                  dangerouslySetInnerHTML={{ __html: item.content }}
                />
              ) : (
                // Otherwise, render as plain text with line breaks preserved
                <div className="whitespace-pre-wrap break-words">
                  {item.content}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No content available for this announcement.</p>
          )}
        </div>
      )}

      {/* Linked Files */}
      {item.linkedFiles && item.linkedFiles.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Paperclip className="w-3 h-3" />
            Attached Files
          </h3>
          <div className="space-y-2">
            {item.linkedFiles.map((file) => (
              <button
                key={file.id}
                data-sidebar-trigger
                onClick={() => openItem({
                  id: file.id,
                  type: "file",
                  title: file.name,
                  courseCode: item.courseCode,
                  fileUrl: file.url,
                  fileName: file.name,
                  fileMimeType: file.mimeType,
                  fileSize: file.size,
                  fileExtension: file.name?.split(".").pop()?.toLowerCase(),
                })}
                className="w-full flex items-center gap-3 p-3 border border-border hover:bg-secondary/30 transition-colors text-left"
              >
                <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium truncate flex-1">{file.name}</span>
                <span className="text-xs text-muted-foreground uppercase">{file.type}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Wrapper component that provides click-outside handling
interface SidebarLayoutProps {
  children: React.ReactNode;
}

export function SidebarLayout({ children }: SidebarLayoutProps) {
  const { isOpen, closeSidebar, sidebarWidth } = useSidebar();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return (
    <div className="relative min-h-screen">
      {/* Main content area */}
      <div
        className={cn(
          "transition-all duration-150 ease-out",
          isOpen && !isMobile ? `pr-[${sidebarWidth}px]` : "pr-0"
        )}
        style={{
          paddingRight: isOpen && !isMobile ? sidebarWidth : 0
        }}
        onClick={(e) => {
          // Close sidebar if clicking on main content (not a sidebar item trigger)
          const target = e.target as HTMLElement;
          const isSidebarTrigger = target.closest("[data-sidebar-trigger]");
          if (!isSidebarTrigger && isOpen) {
            closeSidebar();
          }
        }}
      >
        {children}
      </div>
      
      {/* Sidebar */}
      <SidebarViewer />
    </div>
  );
}
