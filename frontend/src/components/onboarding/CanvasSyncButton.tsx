import { useEffect, useRef, useState } from "react";
import { authenticateWithCanvas, checkAuthStatus, releaseAuthSession } from "@/services/api/auth";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type Status = "idle" | "starting" | "waiting" | "completed" | "error";

interface CanvasSyncButtonProps {
  email?: string;
  onSuccess?: (sessionToken: string, userInfo?: any) => void;
  onError?: (message: string) => void;
}

export function CanvasSyncButton({ email, onSuccess, onError }: CanvasSyncButtonProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const popupRef = useRef<Window | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
    };
  }, []);

  const beginAuth = async () => {
    setError(null);
    setStatus("starting");
    try {
      const response = await authenticateWithCanvas(email || undefined);

      setStatus("waiting");

      if (response.liveViewUrl) {
        popupRef.current = window.open(
          response.liveViewUrl,
          "canvas-auth",
          "width=900,height=700,scrollbars=yes,resizable=yes"
        );
      }

      startPolling(response.sessionToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start Canvas authentication.";
      setError(msg);
      setStatus("error");
      onError?.(msg);
    }
  };

  const startPolling = (token: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const statusResp = await checkAuthStatus(token);
        if (statusResp.status === "completed") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setStatus("completed");
          if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
          // ensure Browserbase session stops once cookies are captured
          try {
            await releaseAuthSession(token);
          } catch (_) {
            // ignore if release fails; backend also attempts release
          }
          onSuccess?.(token, statusResp.userInfo);
        } else if (statusResp.status === "failed") {
          throw new Error(statusResp.error || "Canvas authentication failed.");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to check status.";
        setStatus("error");
        setError(msg);
        if (pollRef.current) clearInterval(pollRef.current);
        if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
        onError?.(msg);
      }
    }, 2500);
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-4">
      {error && <p className="text-sm text-red-500">{error}</p>}
      
      <Button
        type="button"
        onClick={beginAuth}
        disabled={status === "starting" || status === "waiting" || status === "completed"}
        className="px-8 py-6 text-lg bg-background border-2 border-foreground/20 text-foreground hover:bg-background/80"
        size="lg"
      >
        {status === "idle" && "Sync with Canvas"}
        {status === "starting" && (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Starting...
          </>
        )}
        {status === "waiting" && (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Waiting for login...
          </>
        )}
        {status === "completed" && "✓ Synced"}
        {status === "error" && "Retry"}
      </Button>
      
      {status === "waiting" && (
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Complete Canvas SSO in the popup window. This window will close automatically when done.
        </p>
      )}
    </div>
  );
}
