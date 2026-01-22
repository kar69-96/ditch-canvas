/**
 * Visuals Page
 * Generate and explore interactive visualizations
 */

import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CourseFilter } from "@/components/learn/CourseFilter";
import { VisualRenderer } from "@/components/learn/VisualRenderer";
import {
  generateVisual,
  getVisuals,
  deleteVisual,
  type Visual,
} from "@/services/api/learnApi";
import { useToast } from "@/hooks/use-toast";
import { getCurrentUser } from "@/services/mockApi/auth";
import {
  ArrowLeft,
  Sparkles,
  Search,
  History,
  Trash2,
  Loader2,
  Lightbulb,
  Wand2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Example topics for quick generation
const exampleTopics = [
  {
    label: "Sine Wave",
    topic: "sine wave with adjustable frequency and amplitude",
  },
  {
    label: "Binary Search",
    topic: "binary search algorithm step by step visualization",
  },
  { label: "Projectile Motion", topic: "projectile motion physics simulation" },
  { label: "Sorting", topic: "bubble sort algorithm animation" },
  { label: "Pendulum", topic: "simple pendulum physics simulation" },
  { label: "Derivatives", topic: "derivative of a function with tangent line" },
];

const Visuals = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const [topic, setTopic] = useState(searchParams.get("topic") || "");
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentVisual, setCurrentVisual] = useState<{
    code: string;
    topic: string;
    id?: string;
  } | null>(null);
  const [savedVisuals, setSavedVisuals] = useState<Visual[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("generate");

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

  // Load saved visuals when switching to history tab
  useEffect(() => {
    if (activeTab === "history" && userEmail) {
      loadSavedVisuals();
    }
  }, [activeTab, userEmail, selectedCourse]);

  const loadSavedVisuals = async () => {
    if (!userEmail) return;
    setIsLoadingHistory(true);
    try {
      const visuals = await getVisuals(userEmail, selectedCourse || undefined);
      setSavedVisuals(visuals);
    } catch (error) {
      console.error("Failed to load visuals:", error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleGenerate = async () => {
    if (!topic.trim()) {
      toast({
        title: "Topic required",
        description: "Please enter a topic to visualize",
        variant: "destructive",
      });
      return;
    }

    if (!userEmail) {
      toast({
        title: "Not logged in",
        description: "Please log in to generate visualizations",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    setCurrentVisual(null);

    try {
      const result = await generateVisual(topic.trim(), userEmail);
      if (result.success && result.componentCode) {
        setCurrentVisual({
          code: result.componentCode,
          topic: result.topic,
          id: result.visualId,
        });
        toast({
          title: "Visualization generated!",
          description: "Your interactive visual is ready",
        });
      } else {
        throw new Error("Failed to generate visualization");
      }
    } catch (error) {
      console.error("Generation error:", error);
      toast({
        title: "Generation failed",
        description:
          error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = () => {
    if (currentVisual?.topic) {
      setTopic(currentVisual.topic);
      handleGenerate();
    }
  };

  const handleLoadVisual = (visual: Visual) => {
    setCurrentVisual({
      code: visual.component_code,
      topic: visual.topic,
      id: visual.id,
    });
    setActiveTab("generate");
  };

  const handleDeleteVisual = async (id: string) => {
    if (!userEmail) return;
    try {
      await deleteVisual(id, userEmail);
      setSavedVisuals((prev) => prev.filter((v) => v.id !== id));
      if (currentVisual?.id === id) {
        setCurrentVisual(null);
      }
      toast({
        title: "Visual deleted",
        description: "The visualization has been removed",
      });
    } catch (error) {
      toast({
        title: "Delete failed",
        description: "Failed to delete the visualization",
        variant: "destructive",
      });
    }
  };

  const handleQuickTopic = (quickTopic: string) => {
    setTopic(quickTopic);
  };

  return (
    <Layout>
      <div className="min-h-screen p-6 md:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/assistant")}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Interactive Visuals</h1>
                <p className="text-sm text-muted-foreground">
                  Generate AI-powered visualizations for any topic
                </p>
              </div>
            </div>
          </div>
          <CourseFilter
            selectedCourse={selectedCourse}
            onCourseChange={setSelectedCourse}
          />
        </div>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-6"
        >
          <TabsList>
            <TabsTrigger value="generate" className="gap-2">
              <Wand2 className="h-4 w-4" />
              Generate
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="h-4 w-4" />
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-6">
            {/* Input Section */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  What would you like to visualize?
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="Enter a topic (e.g., 'sine wave', 'binary search tree')"
                      className="pl-10"
                      onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                    />
                  </div>
                  <Button
                    onClick={handleGenerate}
                    disabled={isGenerating || !topic.trim()}
                    className="gap-2"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Generate
                      </>
                    )}
                  </Button>
                </div>

                {/* Quick Topics */}
                <div className="flex flex-wrap gap-2">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Lightbulb className="h-4 w-4" />
                    Try:
                  </span>
                  {exampleTopics.map((example) => (
                    <Button
                      key={example.label}
                      variant="outline"
                      size="sm"
                      onClick={() => handleQuickTopic(example.topic)}
                      className="text-xs"
                    >
                      {example.label}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Visual Output */}
            <AnimatePresence mode="wait">
              {(currentVisual || isGenerating) && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <VisualRenderer
                    code={currentVisual?.code || ""}
                    title={currentVisual?.topic || "Generating..."}
                    topic={currentVisual?.topic}
                    onRegenerate={handleRegenerate}
                    isLoading={isGenerating}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Empty State */}
            {!currentVisual && !isGenerating && (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    <Sparkles className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-medium mb-2">
                    No visualization yet
                  </h3>
                  <p className="text-sm text-muted-foreground text-center max-w-sm">
                    Enter a topic above to generate an interactive
                    visualization. Try topics from math, physics, computer
                    science, or any concept you want to explore!
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="history">
            {isLoadingHistory ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : savedVisuals.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    <History className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-medium mb-2">No saved visuals</h3>
                  <p className="text-sm text-muted-foreground text-center max-w-sm">
                    Visualizations you generate will appear here for quick
                    access later.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <ScrollArea className="h-[600px]">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {savedVisuals.map((visual) => (
                    <Card
                      key={visual.id}
                      className="group cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => handleLoadVisual(visual)}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <CardTitle className="text-base line-clamp-2">
                            {visual.title}
                          </CardTitle>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="opacity-0 group-hover:opacity-100 transition-opacity -mt-1 -mr-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteVisual(visual.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {visual.topic}
                        </p>
                        <p className="text-xs text-muted-foreground mt-2">
                          {new Date(visual.created_at).toLocaleDateString()}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
};

export default Visuals;
