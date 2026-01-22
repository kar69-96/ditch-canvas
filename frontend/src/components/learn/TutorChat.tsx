/**
 * TutorChat Component
 * Chat interface for AI tutoring with LearnLM
 */

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Send,
  Loader2,
  Lightbulb,
  Sparkles,
  User,
  Bot,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TutorMessage } from "@/services/api/learnApi";

interface TutorChatProps {
  messages: TutorMessage[];
  onSendMessage: (message: string) => Promise<void>;
  onGeneratePractice?: () => void;
  onExplainWithVisual?: (topic: string) => void;
  isLoading?: boolean;
  topic?: string;
  className?: string;
}

export function TutorChat({
  messages,
  onSendMessage,
  onGeneratePractice,
  onExplainWithVisual,
  isLoading = false,
  topic,
  className = "",
}: TutorChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const message = input.trim();
    setInput("");
    await onSendMessage(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const getLastAssistantMessage = (): string | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        return messages[i].content;
      }
    }
    return null;
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Chat messages */}
      <ScrollArea ref={scrollRef} className="flex-1 p-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Bot className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-medium mb-2">Hi! I'm your AI Tutor</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">
              I'm here to help you learn through questions and guidance. Ask me
              anything about {topic || "your courses"}!
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInput("Explain the key concepts of ")}
              >
                <Lightbulb className="h-4 w-4 mr-2" />
                Explain a concept
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInput("Help me understand ")}
              >
                <BookOpen className="h-4 w-4 mr-2" />
                Help me understand
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInput("Quiz me on ")}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Quiz me
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={cn(
                  "flex gap-3",
                  message.role === "user" ? "flex-row-reverse" : "",
                )}
              >
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted",
                  )}
                >
                  {message.role === "user" ? (
                    <User className="h-4 w-4" />
                  ) : (
                    <Bot className="h-4 w-4" />
                  )}
                </div>
                <Card
                  className={cn(
                    "px-4 py-3 max-w-[80%]",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted",
                  )}
                >
                  <p className="text-sm whitespace-pre-wrap">
                    {message.content}
                  </p>
                </Card>
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <Bot className="h-4 w-4" />
                </div>
                <Card className="px-4 py-3 bg-muted">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Thinking...</span>
                  </div>
                </Card>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Action buttons */}
      {messages.length > 0 && (onGeneratePractice || onExplainWithVisual) && (
        <div className="flex gap-2 px-4 py-2 border-t">
          {onGeneratePractice && (
            <Button
              variant="outline"
              size="sm"
              onClick={onGeneratePractice}
              disabled={isLoading}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Practice Problem
            </Button>
          )}
          {onExplainWithVisual && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const lastMessage = getLastAssistantMessage();
                if (lastMessage) {
                  // Extract topic from conversation
                  const topicMatch = lastMessage.match(
                    /(?:about|understand|concept of)\s+(.+?)(?:\.|,|\?|$)/i,
                  );
                  onExplainWithVisual(
                    topicMatch?.[1] || topic || "the concept",
                  );
                }
              }}
              disabled={isLoading}
            >
              <Lightbulb className="h-4 w-4 mr-2" />
              Explain with Visual
            </Button>
          )}
        </div>
      )}

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 p-4 border-t bg-background"
      >
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask me anything..."
          className="min-h-[44px] max-h-32 resize-none"
          rows={1}
          disabled={isLoading}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!input.trim() || isLoading}
          className="flex-shrink-0"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>
    </div>
  );
}

export default TutorChat;
