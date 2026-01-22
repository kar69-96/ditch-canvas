/**
 * Learn Hub Page
 * Main entry point for AI-powered study features
 */

import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  MessageSquare,
  Layers,
  Brain,
  ArrowRight,
  Lightbulb,
  BookOpen,
  GraduationCap,
} from "lucide-react";
import { motion } from "framer-motion";

const features = [
  {
    id: "visuals",
    title: "Interactive Visuals",
    description:
      "Generate interactive visualizations to understand complex concepts. Explore math, physics, algorithms, and more with hands-on demos.",
    icon: Sparkles,
    href: "/assistant/visuals",
    color: "from-violet-500 to-purple-600",
    available: true,
  },
  {
    id: "tutor",
    title: "AI Tutor",
    description:
      "Get personalized tutoring with an AI that guides you through questions and helps you discover answers yourself using the Socratic method.",
    icon: MessageSquare,
    href: "/assistant/tutor",
    color: "from-blue-500 to-cyan-600",
    available: true,
  },
  {
    id: "flashcards",
    title: "Smart Flashcards",
    description:
      "Create AI-generated flashcard decks from your course content. Study with spaced repetition for optimal retention.",
    icon: Layers,
    href: "/assistant/flashcards",
    color: "from-emerald-500 to-teal-600",
    available: false,
  },
  {
    id: "quiz",
    title: "Practice Quizzes",
    description:
      "Test your knowledge with AI-generated quizzes. Get instant feedback and explanations to reinforce learning.",
    icon: Brain,
    href: "/assistant/quiz",
    color: "from-orange-500 to-amber-600",
    available: false,
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
    },
  },
};

const Assistant = () => {
  const navigate = useNavigate();

  return (
    <Layout>
      <div className="min-h-screen p-6 md:p-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
              <GraduationCap className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Learn</h1>
              <p className="text-muted-foreground">
                AI-powered tools to help you study smarter
              </p>
            </div>
          </div>
        </motion.div>

        {/* Feature Cards */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid gap-6 md:grid-cols-2"
        >
          {features.map((feature) => (
            <motion.div key={feature.id} variants={itemVariants}>
              <Card
                className={`group relative overflow-hidden transition-all duration-300 hover:shadow-lg ${
                  feature.available
                    ? "cursor-pointer hover:scale-[1.02]"
                    : "opacity-60"
                }`}
                onClick={() => feature.available && navigate(feature.href)}
              >
                {/* Gradient background on hover */}
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${feature.color} opacity-0 group-hover:opacity-5 transition-opacity duration-300`}
                />

                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div
                      className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center`}
                    >
                      <feature.icon className="h-6 w-6 text-white" />
                    </div>
                    {!feature.available && (
                      <span className="text-xs font-medium px-2 py-1 rounded-full bg-muted text-muted-foreground">
                        Coming Soon
                      </span>
                    )}
                  </div>
                  <CardTitle className="text-xl mt-4">
                    {feature.title}
                  </CardTitle>
                  <CardDescription className="text-base">
                    {feature.description}
                  </CardDescription>
                </CardHeader>

                <CardContent className="pt-0">
                  {feature.available ? (
                    <Button
                      variant="ghost"
                      className="group/btn gap-2 px-0 hover:bg-transparent"
                    >
                      Get Started
                      <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Available in Phase 2
                    </p>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>

        {/* Quick Start Tips */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-12"
        >
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-yellow-500" />
            Quick Start Tips
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="bg-muted/30">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-primary">1</span>
                  </div>
                  <div>
                    <p className="font-medium">Explore Visuals</p>
                    <p className="text-sm text-muted-foreground">
                      Enter a topic like "sine wave" or "binary search tree" to
                      generate an interactive demo
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-muted/30">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-primary">2</span>
                  </div>
                  <div>
                    <p className="font-medium">Ask the Tutor</p>
                    <p className="text-sm text-muted-foreground">
                      Chat with the AI tutor to get guided explanations and
                      practice problems
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-muted/30">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-primary">3</span>
                  </div>
                  <div>
                    <p className="font-medium">Filter by Course</p>
                    <p className="text-sm text-muted-foreground">
                      Select a course to focus learning on specific topics from
                      your classes
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </motion.div>

        {/* Tabus Link */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="mt-8 flex justify-end"
        >
          <Button
            variant="outline"
            onClick={() => navigate("/assistant/tabus")}
            className="gap-2"
          >
            <BookOpen className="h-4 w-4" />
            Tabus
          </Button>
        </motion.div>
      </div>
    </Layout>
  );
};

export default Assistant;
