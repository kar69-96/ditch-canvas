import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  checkEmailExists,
  startStreamingAuth,
  getExtractionResult,
  verifyLogin,
  stopStreamingAuth,
  startBackgroundUpdate,
  saveCookiesToSupabase,
} from "@/services/api/auth";
import { checkDeviceTrust, trustDevice } from "@/services/api/deviceTrust";
import { getDeviceId, getBrowserHash } from "@/utils/deviceId";
import { sessionStorage } from "@/storage/session";
import { userDatabase } from "@/services/database/userDatabase";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useBackgroundUpdate } from "@/hooks/useBackgroundUpdate";

export default function Login() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [popupWindow, setPopupWindow] = useState<Window | null>(null);
  const checkedUserRef = useRef<any>(null); // Use ref to avoid stale closure in setInterval
  const navigate = useNavigate();

  // Hook for monitoring background updates and invalidating cache when complete
  const { startMonitoring } = useBackgroundUpdate({
    enabled: false, // Don't auto-start, we'll call startMonitoring manually
    showToast: true,
  });

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[a-zA-Z0-9._-]+@colorado\.edu$/i;
    return emailRegex.test(email);
  };

  const calculateSimilarity = (str1: string, str2: string): number => {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();

    // If one contains the other, it's a strong match
    if (s1.includes(s2) || s2.includes(s1)) {
      const shorter = s1.length < s2.length ? s1 : s2;
      const longer = s1.length >= s2.length ? s1 : s2;
      return (shorter.length / longer.length) * 100;
    }

    // Calculate character overlap
    const set1 = new Set(s1);
    const set2 = new Set(s2);
    let common = 0;
    for (const char of set1) {
      if (set2.has(char)) common++;
    }
    return (common / Math.max(set1.size, set2.size)) * 100;
  };

  const handleContinue = async (
    isReauth = false,
    preOpenedWindow?: Window | null,
  ) => {
    setError(null);
    setStatus(null);

    // Validate email format
    if (!email.trim()) {
      setError("Please enter your email");
      return;
    }

    if (!validateEmail(email)) {
      setError("Please enter a valid Colorado email (xxxx1234@colorado.edu)");
      return;
    }

    // Detect mobile devices
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    // On mobile, open window IMMEDIATELY to preserve user gesture
    // We'll navigate it to the auth URL after API calls complete
    let popup: Window | null = preOpenedWindow || null;
    if (isMobile && !preOpenedWindow) {
      popup = window.open("about:blank", "_blank");
      if (popup) {
        popup.document.write(
          "<html><body style='background:#1a1a2e;color:white;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><p>Loading Canvas login...</p></body></html>",
        );
      }
    }

    setLoading(true);

    if (isReauth) {
      setStatus("Cookies expired. Re-authenticating...");
    } else {
      setStatus("Checking email...");
    }

    try {
      // Check if email exists in Supabase (skip on re-auth)
      if (!isReauth) {
        console.log("[Login] Checking email:", email);
        const emailCheck = await checkEmailExists(email);
        console.log("[Login] Email check result:", emailCheck);

        if (!emailCheck.exists) {
          if (popup) popup?.close();
          setError("Email not found. Sign up flow coming soon.");
          setLoading(false);
          return;
        }

        // Store user data from email check (backend returns full user with service key)
        if (emailCheck.user) {
          checkedUserRef.current = emailCheck.user;

          // Check if forced re-auth is required (e.g., after logout)
          const forceReauth =
            localStorage.getItem("canvas_force_reauth") === "true";

          // Check if user has valid cookies (less than 24 hours old)
          const cookiesUpdatedAt = emailCheck.user.canvas_cookies_updated_at;
          const hasValidCookies =
            emailCheck.user.canvas_cookies?.length > 0 && cookiesUpdatedAt;

          if (hasValidCookies && !isReauth && !forceReauth) {
            const cookieAge = Date.now() - new Date(cookiesUpdatedAt).getTime();
            const hoursOld = cookieAge / (1000 * 60 * 60);

            if (hoursOld < 24) {
              // SECURITY: Check if this device is trusted before auto-login
              // A device is trusted if it successfully completed Canvas popup auth within 24 hours
              console.log(
                "[Login] User has valid cookies, checking device trust...",
              );

              const deviceId = getDeviceId();
              const deviceHash = await getBrowserHash();
              const trustCheck = await checkDeviceTrust(
                email,
                deviceId,
                deviceHash,
              );

              if (trustCheck.trusted) {
                // Device verified - safe to auto-login
                console.log(
                  "[Login] Device trusted, proceeding with auto-login",
                );
                if (popup) popup?.close();
                setStatus("Login successful! Redirecting...");

                // Create session directly (user data fetched from Supabase on demand)
                await sessionStorage.setSession(emailCheck.user.id, 7, email);

                // Start background update (non-blocking - user can interact with old data)
                console.log(
                  "[Login] Starting background Canvas data update...",
                );
                startBackgroundUpdate(email)
                  .then((result) => {
                    console.log("[Login] Background update started:", result);
                    if (result.success && !result.skipped) {
                      startMonitoring();
                    }
                  })
                  .catch((err) => {
                    console.warn(
                      "[Login] Background update failed to start:",
                      err,
                    );
                  });

                setTimeout(() => {
                  navigate("/dashboard");
                }, 1000);

                setLoading(false);
                return;
              } else {
                // Device not trusted - require Canvas popup authentication
                console.log(
                  `[Login] Device not trusted: ${trustCheck.reason || "unknown"}. Requiring Canvas popup.`,
                );
                // Fall through to Canvas popup authentication
              }
            }
          } else if (forceReauth) {
            console.log(
              "[Login] Force re-auth flag set, requiring new Canvas authentication",
            );
          }
        }
      }

      setStatus("Starting authentication...");
      console.log("[Login] Starting streaming auth for:", email);

      // Start streaming server
      const startResult = await startStreamingAuth(email);
      console.log("[Login] Streaming auth start result:", startResult);

      if (!startResult.success || !startResult.url) {
        if (popup) popup?.close();
        throw new Error("Failed to start authentication server");
      }

      setStatus("Opening authentication window...");

      // On mobile, navigate the pre-opened window to auth URL (with mobile flag)
      // On desktop, open as popup with specific dimensions
      if (isMobile && popup) {
        const mobileUrl =
          startResult.url +
          (startResult.url.includes("?") ? "&" : "?") +
          "mobile=1";
        popup.location.href = mobileUrl;
      } else if (!isMobile) {
        popup = window.open(
          startResult.url,
          "Canvas Authentication",
          "width=1200,height=800,scrollbars=yes,resizable=yes",
        );
      }

      // Check if popup was blocked - warn but don't fail (some browsers return null but still open)
      if (!popup || popup?.closed) {
        console.warn(
          "[Login] Popup reference is null/closed, but popup may have opened",
        );
        setStatus(
          "If you don't see a pop-up window, please allow pop-ups for this site and try again.",
        );
        // Continue anyway - the popup might have opened despite null reference
        // We'll still try to monitor for extraction results
      } else {
        setPopupWindow(popup);
        setStatus(
          isMobile
            ? "Complete Canvas login in the new tab, then return here..."
            : "Please complete Canvas login in the pop-up window...",
        );
      }

      // Monitor the popup and extraction
      let extractionCompleted = false;
      const checkInterval = setInterval(async () => {
        try {
          // Check for extraction results periodically (even if popup is still open)
          if (!extractionCompleted) {
            const extractionResult = await getExtractionResult(
              email,
              startResult.streamingServerUrl,
            );

            // Skip if still pending (extraction in progress)
            if (extractionResult.pending) {
              return; // Continue polling
            }

            if (extractionResult.success) {
              // Check if cookies are invalid (requires re-auth)
              if (extractionResult.requiresReauth) {
                clearInterval(checkInterval);
                if (!popup?.closed) {
                  popup?.close();
                }
                setPopupWindow(null);
                await stopStreamingAuth(email);

                // Show status message and automatically restart authentication
                setStatus(
                  `Cookies invalid: ${extractionResult.reason || "Authentication expired"}. Restarting authentication...`,
                );

                // Wait a moment to show the message, then restart
                setTimeout(() => {
                  handleContinue(true).catch((err: any) => {
                    console.error("Re-auth error:", err);
                    setError(err.message || "Failed to restart authentication");
                    setLoading(false);
                  });
                }, 2000);

                return;
              }

              extractionCompleted = true;

              // Close popup if still open
              if (!popup?.closed) {
                popup?.close();
              }

              // Save cookies to Supabase (EC2 server doesn't have Supabase credentials)
              if (
                extractionResult.cookies &&
                extractionResult.cookies.length > 0
              ) {
                console.log("[Login] Saving cookies to Supabase...");
                try {
                  const saveResult = await saveCookiesToSupabase(
                    email,
                    extractionResult.cookies,
                  );
                  if (saveResult.success) {
                    console.log(
                      "[Login] Cookies saved to Supabase successfully",
                    );
                  } else {
                    console.warn(
                      "[Login] Failed to save cookies to Supabase:",
                      saveResult.error,
                    );
                  }
                } catch (saveErr) {
                  console.warn(
                    "[Login] Error saving cookies to Supabase:",
                    saveErr,
                  );
                  // Continue anyway - cookies are available for this session
                }
              }

              // Wait a moment for any final processing
              await new Promise((resolve) => setTimeout(resolve, 500));

              // Verify username matches email (optional - only if username was extracted)
              if (extractionResult.username) {
                setStatus("Verifying authentication...");
                const verifyResult = await verifyLogin(
                  email,
                  extractionResult.username,
                );

                if (!verifyResult.success || !verifyResult.isValid) {
                  clearInterval(checkInterval);
                  setPopupWindow(null);
                  setError(
                    `Username verification failed. Match: ${verifyResult.matchPercentage?.toFixed(1)}% (required: 30%)`,
                  );
                  setLoading(false);
                  await stopStreamingAuth(email);
                  return;
                }
              } else {
                console.log(
                  "[Login] Username not extracted, skipping verification (cookies are valid)",
                );
              }

              // Use stored user from email check (avoids RLS issues with anon key)
              setStatus("Loading user data...");
              let user = checkedUserRef.current;

              // Fallback: If user ref is null, try fetching again
              if (!user) {
                console.log(
                  "[Login] User ref is null, fetching user data again...",
                );
                const emailCheck = await checkEmailExists(email);
                if (emailCheck.exists && emailCheck.user) {
                  user = emailCheck.user;
                  checkedUserRef.current = user;
                }
              }

              if (!user) {
                clearInterval(checkInterval);
                setPopupWindow(null);
                setError("User not found. Please sign up first.");
                setLoading(false);
                await stopStreamingAuth(email);
                return;
              }

              // Update last login timestamp (cookies saved to Supabase above)
              try {
                await userDatabase.updateLastLogin(user.id);
              } catch (updateErr) {
                console.log("[Login] Could not update last login:", updateErr);
              }

              // Create session (user data fetched from Supabase on demand)
              await sessionStorage.setSession(user.id, 7, email);

              // Register this device as trusted after successful Canvas popup login
              console.log("[Login] Registering device as trusted...");
              try {
                const deviceId = getDeviceId();
                const deviceHash = await getBrowserHash();
                await trustDevice(
                  email,
                  deviceId,
                  deviceHash,
                  navigator.userAgent,
                );
                console.log("[Login] Device registered as trusted");
              } catch (trustErr) {
                console.warn(
                  "[Login] Failed to register device trust:",
                  trustErr,
                );
                // Non-critical - continue with login
              }

              setStatus("Login successful! Redirecting...");

              // Stop streaming server
              await stopStreamingAuth(email);

              clearInterval(checkInterval);
              setPopupWindow(null);

              // Start background update (non-blocking - user can interact with old data)
              console.log("[Login] Starting background Canvas data update...");
              startBackgroundUpdate(email)
                .then((result) => {
                  console.log("[Login] Background update started:", result);
                  if (result.success && !result.skipped) {
                    startMonitoring();
                  }
                })
                .catch((err) => {
                  console.warn(
                    "[Login] Background update failed to start:",
                    err,
                  );
                });

              // Redirect to dashboard
              setTimeout(() => {
                navigate("/dashboard");
              }, 1000);

              return;
            }
          }

          // Check if popup is closed (user closed it manually)
          // Note: popup might be null if browser didn't return a reference
          if (popup?.closed && !extractionCompleted) {
            clearInterval(checkInterval);
            setPopupWindow(null);

            // Poll for extraction results with retries (extraction may still be in progress)
            let extractionResult = null;
            const maxRetries = 10;
            for (let i = 0; i < maxRetries; i++) {
              await new Promise((resolve) => setTimeout(resolve, 2000));

              extractionResult = await getExtractionResult(
                email,
                startResult.streamingServerUrl,
              );

              // If not pending, we have a result (success or error)
              if (!extractionResult.pending) {
                break;
              }

              console.log(
                `[Login] Extraction still pending, retry ${i + 1}/${maxRetries}...`,
              );
            }

            // If still pending after all retries, treat as incomplete
            if (extractionResult?.pending) {
              setError("Authentication timed out. Please try again.");
              setLoading(false);
              await stopStreamingAuth(email);
              return;
            }

            console.log(
              "[Login] Popup closed, extraction result:",
              extractionResult,
            );

            if (extractionResult.success) {
              // Check if cookies are invalid (requires re-auth)
              if (extractionResult.requiresReauth) {
                await stopStreamingAuth(email);

                // Show status message and automatically restart authentication
                setStatus(
                  `Cookies invalid: ${extractionResult.reason || "Authentication expired"}. Restarting authentication...`,
                );

                // Wait a moment to show the message, then restart
                setTimeout(() => {
                  handleContinue(true).catch((err: any) => {
                    console.error("Re-auth error:", err);
                    setError(err.message || "Failed to restart authentication");
                    setLoading(false);
                  });
                }, 2000);

                return;
              }

              // Extraction completed, verify username if available, then login
              if (extractionResult.username) {
                setStatus("Verifying authentication...");
                const verifyResult = await verifyLogin(
                  email,
                  extractionResult.username,
                );

                if (!verifyResult.success || !verifyResult.isValid) {
                  setError(
                    `Username verification failed. Match: ${verifyResult.matchPercentage?.toFixed(1)}% (required: 30%)`,
                  );
                  setLoading(false);
                  await stopStreamingAuth(email);
                  return;
                }
              } else {
                console.log(
                  "[Login] Username not extracted, skipping verification (cookies are valid)",
                );
              }

              // Use stored user from email check (avoids RLS issues with anon key)
              setStatus("Loading user data...");
              let user = checkedUserRef.current;

              // Fallback: If user ref is null, try fetching again
              if (!user) {
                console.log(
                  "[Login] User ref is null, fetching user data again...",
                );
                const emailCheck = await checkEmailExists(email);
                if (emailCheck.exists && emailCheck.user) {
                  user = emailCheck.user;
                  checkedUserRef.current = user;
                }
              }

              console.log(
                "[Login] User data for session:",
                user ? user.id : "null",
              );

              if (user) {
                // Create session (user data fetched from Supabase on demand)
                await sessionStorage.setSession(user.id, 7, email);

                // Register this device as trusted after successful Canvas popup login
                console.log("[Login] Registering device as trusted...");
                try {
                  const deviceId = getDeviceId();
                  const deviceHash = await getBrowserHash();
                  await trustDevice(
                    email,
                    deviceId,
                    deviceHash,
                    navigator.userAgent,
                  );
                  console.log("[Login] Device registered as trusted");
                } catch (trustErr) {
                  console.warn(
                    "[Login] Failed to register device trust:",
                    trustErr,
                  );
                  // Non-critical - continue with login
                }

                setStatus("Login successful! Redirecting...");
                await stopStreamingAuth(email);

                // Start background update (non-blocking - user can interact with old data)
                console.log(
                  "[Login] Starting background Canvas data update...",
                );
                startBackgroundUpdate(email)
                  .then((result) => {
                    console.log("[Login] Background update started:", result);
                    if (result.success && !result.skipped) {
                      startMonitoring();
                    }
                  })
                  .catch((err) => {
                    console.warn(
                      "[Login] Background update failed to start:",
                      err,
                    );
                  });

                setTimeout(() => {
                  navigate("/dashboard");
                }, 1000);
                return;
              }
            }

            // If we get here, extraction didn't complete
            setError(
              "Authentication was cancelled or incomplete. Please try again.",
            );
            setLoading(false);
            await stopStreamingAuth(email);
          }
        } catch (err: any) {
          console.error("Error monitoring extraction:", err);
          // Don't set error here immediately, let the user complete the flow
        }
      }, 2000); // Check every 2 seconds

      // Timeout after 5 minutes
      setTimeout(
        () => {
          if (!popup?.closed) {
            clearInterval(checkInterval);
            popup?.close();
            setPopupWindow(null);
            setError("Authentication timeout. Please try again.");
            setLoading(false);
            stopStreamingAuth(email);
          }
        },
        5 * 60 * 1000,
      );
    } catch (err: any) {
      console.error("[Login] Canvas login error:", err);
      console.error("[Login] Error details:", {
        message: err.message,
        stack: err.stack,
        name: err.name,
      });

      // Provide user-friendly error messages based on error type
      let userMessage = err.message || "An error occurred during login";

      if (
        err.message?.includes("503") ||
        err.message?.includes("unavailable")
      ) {
        userMessage =
          "Server at capacity. Please wait 30 seconds and try again.";
      } else if (err.message?.includes("403")) {
        userMessage =
          "Connection failed. The server may have restarted. Please try again.";
      } else if (
        err.message?.includes("timeout") ||
        err.message?.includes("Timeout")
      ) {
        userMessage =
          "Connection timed out. Check your internet and try again.";
      } else if (
        err.message?.includes("Failed to fetch") ||
        err.message?.includes("NetworkError")
      ) {
        userMessage =
          "Network error. Please check your connection and try again.";
      }

      setError(userMessage);
      setLoading(false);
      if (popupWindow && !popupWindow.closed) {
        popupWindow.close();
        setPopupWindow(null);
      }
      try {
        await stopStreamingAuth(email);
      } catch (stopErr) {
        console.error("[Login] Error stopping streaming auth:", stopErr);
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !loading) {
      handleContinue();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome</CardTitle>
          <CardDescription>Enter your .edu email to continue</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {status && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertDescription>{status}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="xxxx1234@university.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={loading}
              className="w-full"
            />
          </div>

          <Button
            onClick={() => handleContinue()}
            disabled={loading || !email.trim()}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              "Continue"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
