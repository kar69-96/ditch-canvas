import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import GlassCard from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Bot, MessageCircle, Send, Loader2, Plus, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCanvasData } from "@/hooks/useCanvasData";
import { toast } from "@/hooks/use-toast";

const Learn = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: mockCanvasData, loading } = useCanvasData();
  const courseId = id ? parseInt(id) : null;
  
  // Chatbot state
  const [chatMessages, setChatMessages] = useState<Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [isLoadingResponse, setIsLoadingResponse] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // Chat configuration state
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set());
  const [selectedModel, setSelectedModel] = useState<'auto' | 'chatgpt' | 'gemini' | 'claude'>('auto');
  
  // Find course
  const course = mockCanvasData?.courses.find((c) => {
    const cId = typeof c.id === 'string' ? parseInt(c.id, 10) : c.id;
    const urlId = typeof courseId === 'string' ? parseInt(courseId, 10) : courseId;
    return cId === urlId;
  }) || null;

  // Load modules for this course
  const courseModules = useMemo(() => {
    if (!mockCanvasData?.modules || !course) return [];
    return mockCanvasData.modules
      .filter((m) => {
        const moduleCourseId = typeof m.courseId === 'string' ? parseInt(m.courseId, 10) : m.courseId;
        const currentCourseId = typeof course.id === 'string' ? parseInt(course.id, 10) : course.id;
        return moduleCourseId === currentCourseId;
      })
      .map((m) => {
        let items: Array<{
          id: number | string;
          title?: string;
          name?: string;
          type?: string;
        }> = [];
        
        if (m.items) {
          if (Array.isArray(m.items)) {
            items = m.items;
          } else if (typeof m.items === 'object' && (m.items as any).items) {
            items = Array.isArray((m.items as any).items) ? (m.items as any).items : [];
          }
        }
        
        items = items.map(item => ({
          ...item,
          id: item.id || 0,
          title: item.title || item.name || 'Untitled Item',
          name: item.title || item.name || 'Untitled Item',
          type: item.type || 'File',
        }));
        
        const seenItems = new Map<string, boolean>();
        items = items.filter(item => {
          const key = `${item.id}|${item.title}|${item.name || ''}`;
          if (seenItems.has(key)) {
            return false;
          }
          seenItems.set(key, true);
          return true;
        });
        
        return {
          id: m.id,
          name: m.name || 'Untitled Module',
          position: m.position || 0,
          items: items,
        };
      })
      .sort((a, b) => a.position - b.position);
  }, [mockCanvasData?.modules, course]);

  const allModules = courseModules.length > 0
    ? courseModules.map((module, index) => ({
        week: `Module ${module.position || index + 1}`,
        title: module.name,
        position: module.position || index + 1,
      }))
    : [];

  const modules = allModules;
  
  // Helper functions for module selection
  const toggleModule = (moduleId: string) => {
    setSelectedModules(prev => {
      const newSet = new Set(prev);
      if (newSet.has(moduleId)) {
        newSet.delete(moduleId);
      } else {
        newSet.add(moduleId);
      }
      return newSet;
    });
  };
  
  const selectAllModules = () => {
    const allModuleIds = modules.map(m => m.title);
    setSelectedModules(new Set(allModuleIds));
  };
  
  const deselectAllModules = () => {
    setSelectedModules(new Set());
  };
  
  const areAllModulesSelected = modules.length > 0 && selectedModules.size === modules.length;

  // Load chat messages from localStorage on mount
  useEffect(() => {
    if (!courseId) return;
    
    const storageKey = `chat_messages_${courseId}`;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setChatMessages(parsed.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp)
        })));
      } catch (e) {
        console.error('Error loading chat messages:', e);
      }
    }
  }, [courseId]);

  // Save chat messages to localStorage
  useEffect(() => {
    if (!courseId) return;
    const storageKey = `chat_messages_${courseId}`;
    localStorage.setItem(storageKey, JSON.stringify(chatMessages));
  }, [chatMessages, courseId]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && courseId) {
        const popoutKey = `chat_popout_active_${courseId}`;
        localStorage.setItem(popoutKey, 'false');
        navigate(`/courses/${courseId}`);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [courseId, navigate]);

  // Reset chat when course changes
  useEffect(() => {
    setChatMessages([]);
    setChatInput('');
    setIsLoadingResponse(false);
  }, [courseId]);

  // Early returns
  if (loading || !mockCanvasData) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <Bot className="w-8 h-8 animate-pulse mx-auto mb-4 text-foreground" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }
  
  if (!course) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-4">Course not found</h1>
          <Button onClick={() => navigate("/courses")} className="glass-button">
            Back to Classes
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{course.code}</h1>
          <p className="text-sm text-muted-foreground">{course.name}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs h-8 px-3 hover:opacity-70 transition-opacity"
          onClick={() => {
            if (courseId) {
              const popoutKey = `chat_popout_active_${courseId}`;
              localStorage.setItem(popoutKey, 'false');
              navigate(`/courses/${courseId}`);
            }
          }}
          title="Close"
        >
          <X className="w-4 h-4 mr-2" />
          Close
        </Button>
      </div>

      {/* Chat Container - Full Screen */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <GlassCard hover={false} className="flex-1 flex flex-col m-6 p-0 min-h-0">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-shrink-0">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Learn
            </h2>
          </div>
        
          <div className="flex-1 overflow-y-auto mb-4 space-y-4 px-5 pt-5 min-h-0" style={{
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.2) transparent'
          }}>
            {chatMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Bot className="w-12 h-12 text-primary/50 mb-4" />
                <p className="text-sm text-foreground/60 mb-2">Ask me anything about this course!</p>
                <p className="text-xs text-foreground/40">I can help explain concepts, answer questions, and provide study tips.</p>
              </div>
            ) : (
              chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-3 ${
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {message.role === 'assistant' && (
                    <div className="w-8 h-8 bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4 text-primary" />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] px-4 py-2 ${
                      message.role === 'user'
                        ? 'bg-primary/20 text-foreground/90'
                        : 'bg-white/5 text-foreground/80'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  </div>
                  {message.role === 'user' && (
                    <div className="w-8 h-8 bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <MessageCircle className="w-4 h-4 text-primary" />
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>
          
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!chatInput.trim() || isLoadingResponse) return;
              
              const userMessage = {
                id: Date.now().toString(),
                role: 'user' as const,
                content: chatInput.trim(),
                timestamp: new Date()
              };
              
              setChatMessages(prev => [...prev, userMessage]);
              setChatInput('');
              setIsLoadingResponse(true);
              
              const assistantMessageId = (Date.now() + 1).toString();
              const assistantMessage = {
                id: assistantMessageId,
                role: 'assistant' as const,
                content: 'I apologize, but the AI tutor feature is currently not available.',
                timestamp: new Date()
              };
              
              setTimeout(() => {
                setChatMessages(prev => [...prev, assistantMessage]);
                setIsLoadingResponse(false);
              }, 500);
            }}
            className="flex gap-2 px-5 pb-4 flex-shrink-0"
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-10 w-10 p-0 hover:opacity-70 transition-opacity border border-foreground/20"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 bg-popover border border-border">
                {/* Content Selector */}
                <DropdownMenuLabel className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">
                  Content Selector
                </DropdownMenuLabel>
                <DropdownMenuItem
                  className="px-3 py-2 cursor-pointer"
                  onSelect={(e) => {
                    e.preventDefault();
                    if (areAllModulesSelected) {
                      deselectAllModules();
                    } else {
                      selectAllModules();
                    }
                  }}
                >
                  <Checkbox
                    checked={areAllModulesSelected}
                    className="mr-2"
                    onCheckedChange={(checked) => {
                      if (checked) {
                        selectAllModules();
                      } else {
                        deselectAllModules();
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="text-sm">Select All</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <div className="max-h-[200px] overflow-y-auto">
                  {modules.map((module) => (
                    <DropdownMenuCheckboxItem
                      key={module.title}
                      checked={selectedModules.has(module.title)}
                      onCheckedChange={() => toggleModule(module.title)}
                      className="px-3 py-2"
                    >
                      {module.title}
                    </DropdownMenuCheckboxItem>
                  ))}
                </div>
                <DropdownMenuSeparator />
                
                {/* Model Selector */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="px-3 py-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase">
                      Model
                    </span>
                    <span className="ml-auto text-xs text-foreground/60 capitalize">
                      {selectedModel}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="bg-popover border border-border">
                    <DropdownMenuItem
                      className="px-3 py-2 cursor-pointer"
                      onSelect={() => setSelectedModel('auto')}
                    >
                      <span className={`text-sm ${selectedModel === 'auto' ? 'font-medium text-primary' : ''}`}>
                        Auto
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="px-3 py-2 cursor-pointer"
                      onSelect={() => setSelectedModel('chatgpt')}
                    >
                      <span className={`text-sm ${selectedModel === 'chatgpt' ? 'font-medium text-primary' : ''}`}>
                        ChatGPT
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="px-3 py-2 cursor-pointer"
                      onSelect={() => setSelectedModel('gemini')}
                    >
                      <span className={`text-sm ${selectedModel === 'gemini' ? 'font-medium text-primary' : ''}`}>
                        Gemini
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="px-3 py-2 cursor-pointer"
                      onSelect={() => setSelectedModel('claude')}
                    >
                      <span className={`text-sm ${selectedModel === 'claude' ? 'font-medium text-primary' : ''}`}>
                        Claude
                      </span>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
            <Input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask a question about this course..."
              className="flex-1 bg-white/5 border-white/10 focus-visible:ring-primary/50"
              disabled={isLoadingResponse}
            />
            <Button
              type="submit"
              disabled={isLoadingResponse || !chatInput.trim()}
              className="slide-in-button border border-foreground/20 text-foreground px-4"
            >
              {isLoadingResponse ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </form>
        </GlassCard>
      </div>
    </div>
  );
};

export default Learn;




