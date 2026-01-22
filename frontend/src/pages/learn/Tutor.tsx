/**
 * Tutor Page
 * AI tutoring chat interface using LearnLM
 */

import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CourseFilter } from "@/components/learn/CourseFilter";
import { TutorChat } from "@/components/learn/TutorChat";
import {
  sendTutorMessage,
  getTutorSessions,
  getTutorSession,
  deleteTutorSession,
  generatePracticeProblems,
  type TutorSession,
  type TutorMessage,
  type PracticeProblem,
} from "@/services/api/learnApi";
import { useToast } from "@/hooks/use-toast";
import { getCurrentUser } from "@/services/mockApi/auth";
import {
  ArrowLeft,
  MessageSquare,
  History,
  Plus,
  Trash2,
  Loader2,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const Tutor = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(
    searchParams.get("session"),
  );
  const [topic, setTopic] = useState<string | null>(searchParams.get("topic"));
  const [isLoading, setIsLoading] = useState(false);
  const [savedSessions, setSavedSessions] = useState<TutorSession[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Practice problems modal state
  const [practiceProblems, setPracticeProblems] = useState<PracticeProblem[]>(
    [],
  );
  const [showPractice, setShowPractice] = useState(false);
  const [isGeneratingPractice, setIsGeneratingPractice] = useState(false);
  const [revealedAnswers, setRevealedAnswers] = useState<Set<number>>(
    new Set(),
  );

  // Get user email on mount
  useEffect(() => {
    const fetchUser = async () => {
      const user = await getCurrentUser();
      if (user?.email) {
        setUserEmail(user.email);
      }
    };
    fetchUser();
  }, []);

  // Load session if ID provided
  useEffect(() => {
    if (sessionId && userEmail) {
      loadSession(sessionId);
    }
  }, [sessionId, userEmail]);

  // Load sessions when showing history
  useEffect(() => {
    if (showHistory && userEmail) {
      loadSessions();
    }
  }, [showHistory, userEmail, selectedCourse]);

  const loadSessions = async () => {
    if (!userEmail) return;
    setIsLoadingHistory(true);
    try {
      const sessions = await getTutorSessions(
        userEmail,
        selectedCourse || undefined,
      );
      setSavedSessions(sessions);
    } catch (error) {
      console.error("Failed to load sessions:", error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const loadSession = async (id: string) => {
    try {
      const session = await getTutorSession(id);
      setMessages(session.messages || []);
      setTopic(session.topic || null);
    } catch (error) {
      console.error("Failed to load session:", error);
      toast({
        title: "Session not found",
        description: "Starting a new conversation",
        variant: "destructive",
      });
      startNewSession();
    }
  };

  const startNewSession = () => {
    setSessionId(null);
    setMessages([]);
    setTopic(null);
    // Update URL
    navigate("/assistant/tutor", { replace: true });
  };

  const handleSendMessage = async (message: string) => {
    if (!userEmail) {
      toast({
        title: "Not logged in",
        description: "Please log in to use the tutor",
        variant: "destructive",
      });
      return;
    }

    // Optimistically add user message
    const userMessage: TutorMessage = {
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const result = await sendTutorMessage(
        message,
        userEmail,
        sessionId || undefined,
        topic || undefined,
      );

      if (result.success) {
        // Add assistant response
        const assistantMessage: TutorMessage = {
          role: "assistant",
          content: result.response,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMessage]);

        // Update session ID if new
        if (result.sessionId && result.sessionId !== sessionId) {
          setSessionId(result.sessionId);
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      // Remove optimistic message on error
      setMessages((prev) => prev.slice(0, -1));
      toast({
        title: "Message failed",
        description:
          error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSession = async (id: string) => {
    if (!userEmail) return;
    try {
      await deleteTutorSession(id, userEmail);
      setSavedSessions((prev) => prev.filter((s) => s.id !== id));
      if (sessionId === id) {
        startNewSession();
      }
      toast({
        title: "Session deleted",
        description: "The conversation has been removed",
      });
    } catch (error) {
      toast({
        title: "Delete failed",
        description: "Failed to delete the session",
        variant: "destructive",
      });
    }
  };

  const handleSelectSession = (session: TutorSession) => {
    setSessionId(session.id);
    setShowHistory(false);
    navigate(`/assistant/tutor?session=${session.id}`, { replace: true });
  };

  const handleGeneratePractice = async () => {
    if (!userEmail) return;

    setIsGeneratingPractice(true);
    setRevealedAnswers(new Set());

    try {
      // Extract topic from recent conversation
      const recentTopic =
        topic ||
        messages.filter((m) => m.role === "user").slice(-1)[0]?.content ||
        "general concepts";

      const result = await generatePracticeProblems(recentTopic, "medium", 3);

      if (result.success && result.problems.length > 0) {
        setPracticeProblems(result.problems);
        setShowPractice(true);
      } else {
        toast({
          title: "No problems generated",
          description: "Try asking about a specific topic first",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Practice generation error:", error);
      toast({
        title: "Generation failed",
        description: "Could not generate practice problems",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingPractice(false);
    }
  };

  const handleExplainWithVisual = (visualTopic: string) => {
    navigate(`/assistant/visuals?topic=${encodeURIComponent(visualTopic)}`);
  };

  const toggleAnswer = (index: number) => {
    setRevealedAnswers((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <Layout>
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/assistant")}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center">
                <MessageSquare className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold">AI Tutor</h1>
                <p className="text-sm text-muted-foreground">
                  {topic || "Ask me anything about your courses"}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CourseFilter
              selectedCourse={selectedCourse}
              onCourseChange={setSelectedCourse}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowHistory(!showHistory)}
              title="Chat history"
            >
              <History className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={startNewSession}
              title="New conversation"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* History Sidebar */}
          <AnimatePresence>
            {showHistory && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 300, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="border-r overflow-hidden"
              >
                <div className="p-4 border-b">
                  <h2 className="font-semibold">Chat History</h2>
                </div>
                {isLoadingHistory ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : savedSessions.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground text-center">
                    No previous conversations
                  </div>
                ) : (
                  <ScrollArea className="h-[calc(100vh-200px)]">
                    <div className="p-2 space-y-1">
                      {savedSessions.map((session) => (
                        <Card
                          key={session.id}
                          className={`cursor-pointer hover:bg-muted/50 transition-colors ${
                            sessionId === session.id ? "bg-muted" : ""
                          }`}
                          onClick={() => handleSelectSession(session)}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm truncate">
                                  {session.topic || "Untitled"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {new Date(
                                    session.updated_at,
                                  ).toLocaleDateString()}
                                </p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 flex-shrink-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteSession(session.id);
                                }}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Chat Area */}
          <div className="flex-1 flex flex-col">
            <TutorChat
              messages={messages}
              onSendMessage={handleSendMessage}
              onGeneratePractice={handleGeneratePractice}
              onExplainWithVisual={handleExplainWithVisual}
              isLoading={isLoading || isGeneratingPractice}
              topic={topic || undefined}
              className="flex-1"
            />
          </div>
        </div>

        {/* Practice Problems Modal */}
        <Dialog open={showPractice} onOpenChange={setShowPractice}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Practice Problems
              </DialogTitle>
              <DialogDescription>
                Test your understanding with these practice problems
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6 mt-4">
              {practiceProblems.map((problem, index) => (
                <Card key={index}>
                  <CardHeader>
                    <CardTitle className="text-base">
                      Problem {index + 1}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p>{problem.question}</p>

                    {problem.hint && (
                      <div className="p-3 bg-muted rounded-lg">
                        <p className="text-sm">
                          <span className="font-medium">Hint:</span>{" "}
                          {problem.hint}
                        </p>
                      </div>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleAnswer(index)}
                      className="gap-2"
                    >
                      <ChevronRight
                        className={`h-4 w-4 transition-transform ${
                          revealedAnswers.has(index) ? "rotate-90" : ""
                        }`}
                      />
                      {revealedAnswers.has(index)
                        ? "Hide Answer"
                        : "Show Answer"}
                    </Button>

                    <AnimatePresence>
                      {revealedAnswers.has(index) && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="p-4 bg-primary/5 rounded-lg space-y-2">
                            <p>
                              <span className="font-medium">Answer:</span>{" "}
                              {problem.answer}
                            </p>
                            {problem.explanation && (
                              <p className="text-sm text-muted-foreground">
                                <span className="font-medium">
                                  Explanation:
                                </span>{" "}
                                {problem.explanation}
                              </p>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </CardContent>
                </Card>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default Tutor;
