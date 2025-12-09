import { useEffect, useRef, useState } from "react";
import { authenticateWithCanvas, checkAuthStatus, loginWithCanvas, releaseAuthSession } from "@/services/api/auth";
import { Button } from "@/components/ui/button";

type Status =
  | "idle"
  | "starting"
  | "waiting"
  | "completed"
  | "error";

interface CanvasSyncProps {
  email?: string;
  mode?: "onboarding" | "login";
  onSuccess?: (sessionToken: string, userInfo?: any) => void;
  onError?: (message: string) => void;
}

export function CanvasSync({ email, mode = "onboarding", onSuccess, onError }: CanvasSyncProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string>("Connect your Canvas account to continue.");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
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
    setMessage("Starting Canvas authentication...");
    try {
      const response =
        mode === "login" && email
          ? await loginWithCanvas(email)
          : await authenticateWithCanvas(email || undefined);

      setSessionToken(response.sessionToken);
      setLiveViewUrl(response.liveViewUrl);
      setStatus("waiting");
      setMessage("Complete Canvas login in the popup window.");

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
      setMessage("Unable to start Canvas authentication.");
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
          setMessage("Canvas authentication complete.");
          if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
          // proactively release the session on success to ensure Browserbase stops
          try {
            await releaseAuthSession(token);
          } catch (_) {
            // ignore release errors, since backend also attempts release
          }
          onSuccess?.(token, statusResp.userInfo);
        } else if (statusResp.status === "failed") {
          throw new Error(statusResp.error || "Canvas authentication failed.");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to check status.";
        setStatus("error");
        setError(msg);
        setMessage("Canvas authentication failed.");
        if (pollRef.current) clearInterval(pollRef.current);
        if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
        onError?.(msg);
      }
    }, 2500);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-lg font-medium text-foreground">Sync with Canvas</h3>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>

      {liveViewUrl && (
        <div className="text-xs text-muted-foreground bg-muted rounded-md p-3 break-words">
          <div className="font-medium text-foreground">Live view URL</div>
          <div>{liveViewUrl}</div>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={beginAuth}
          disabled={status === "starting" || status === "waiting"}
          className="bg-background border-2 border-foreground/20 text-foreground hover:bg-background/80"
        >
          {status === "idle" && "Start Canvas Sync"}
          {status === "starting" && "Starting..."}
          {status === "waiting" && "Waiting for login..."}
          {status === "completed" && "Completed"}
          {status === "error" && "Retry Canvas Sync"}
        </Button>
        {status === "waiting" && (
          <span className="text-xs text-muted-foreground">
            Leave the popup open and finish Canvas SSO.
          </span>
        )}
      </div>
    </div>
  );
}
