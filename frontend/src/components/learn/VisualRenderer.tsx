/**
 * VisualRenderer Component
 * Renders AI-generated React components using react-live
 */

import { useState, useEffect } from "react";
import { LiveProvider, LivePreview, LiveError } from "react-live";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  RefreshCw,
  Maximize2,
  Minimize2,
  Code,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface VisualRendererProps {
  code: string;
  title?: string;
  topic?: string;
  onRegenerate?: () => void;
  isLoading?: boolean;
  className?: string;
}

// Scope available to the live component
const scope = {
  useState,
  useEffect,
  React: {
    useState,
    useEffect,
    useRef: (init: unknown) => ({ current: init }),
  },
};

export function VisualRenderer({
  code,
  title,
  topic,
  onRegenerate,
  isLoading = false,
  className = "",
}: VisualRendererProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Transform the code to be compatible with react-live
  const transformedCode = transformCodeForLive(code);

  return (
    <Card
      className={cn(
        "overflow-hidden transition-all duration-300",
        isExpanded ? "fixed inset-4 z-50" : "",
        className,
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex flex-col gap-1">
          {title && <CardTitle className="text-lg">{title}</CardTitle>}
          {topic && (
            <p className="text-sm text-muted-foreground">Topic: {topic}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowCode(!showCode)}
            title={showCode ? "Hide code" : "Show code"}
          >
            <Code className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Minimize" : "Maximize"}
          >
            {isExpanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
          {onRegenerate && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onRegenerate}
              disabled={isLoading}
              title="Regenerate"
            >
              <RefreshCw
                className={cn("h-4 w-4", isLoading && "animate-spin")}
              />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent
        className={cn("relative", isExpanded && "h-[calc(100%-4rem)]")}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-4">
              <RefreshCw className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Generating visualization...
              </p>
            </div>
          </div>
        ) : (
          <>
            {showCode && (
              <div className="mb-4 p-4 bg-muted rounded-lg overflow-auto max-h-64">
                <pre className="text-xs whitespace-pre-wrap break-words font-mono">
                  {code}
                </pre>
              </div>
            )}
            <LiveProvider code={transformedCode} scope={scope} noInline>
              <div
                className={cn(
                  "relative rounded-lg border bg-background p-4",
                  isExpanded ? "h-full" : "min-h-[300px]",
                )}
              >
                <LiveError className="absolute top-2 left-2 right-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                </LiveError>
                <LivePreview />
              </div>
            </LiveProvider>
          </>
        )}
      </CardContent>
      {isExpanded && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm -z-10"
          onClick={() => setIsExpanded(false)}
        />
      )}
    </Card>
  );
}

/**
 * Transform generated code to work with react-live
 */
function transformCodeForLive(code: string): string {
  // Remove import statements
  let transformed = code.replace(/^import\s+.*?;?\s*$/gm, "");

  // Remove export default
  transformed = transformed.replace(/export\s+default\s+/g, "");

  // If the code is a function component, wrap it to render
  if (transformed.includes("function Visualization")) {
    transformed = transformed + "\nrender(<Visualization />);";
  } else if (transformed.includes("const Visualization")) {
    transformed = transformed + "\nrender(<Visualization />);";
  } else {
    // Try to find any function component and render it
    const functionMatch = transformed.match(/function\s+(\w+)\s*\(/);
    if (functionMatch) {
      const componentName = functionMatch[1];
      transformed = transformed + `\nrender(<${componentName} />);`;
    }
  }

  return transformed;
}

export default VisualRenderer;
