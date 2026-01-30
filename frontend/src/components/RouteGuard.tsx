import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { sessionStorage } from "@/storage/session";
import { getCurrentUser } from "@/services/mockApi/auth";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface RouteGuardProps {
  children: React.ReactNode;
  requireAuth?: boolean;
}

/**
 * RouteGuard component to protect routes that require authentication
 * Verifies both localStorage session AND user exists in Supabase
 * This ensures multi-user security - stale sessions won't grant access
 */
export const RouteGuard = ({
  children,
  requireAuth = true,
}: RouteGuardProps) => {
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function checkAuth() {
      if (requireAuth) {
        try {
          // LOCALHOST BYPASS - Only for development testing
          // This ONLY works on localhost/127.0.0.1, NEVER on production
          const isLocalhost =
            window.location.hostname === "localhost" ||
            window.location.hostname === "127.0.0.1";

          // Check for test user from environment variables (set via npm run dev:as)
          const testUserId = import.meta.env.VITE_TEST_USER_ID;
          const testEmail = import.meta.env.VITE_TEST_USER_EMAIL;

          if (isLocalhost && testUserId && testEmail) {
            console.log(
              "[RouteGuard] LOCALHOST BYPASS - Setting up test user session",
            );
            await sessionStorage.setSession(testUserId, 7, testEmail);
            console.log(
              "[RouteGuard] LOCALHOST BYPASS - Test session set for:",
              testEmail,
            );
            setIsAuthenticated(true);
            setIsChecking(false);
            return;
          }

          // Step 1: Check localStorage session exists and is not expired
          const session = await sessionStorage.getSession();
          console.log("[RouteGuard] Session check:", {
            hasSession: !!session,
            userId: session?.userId,
          });

          if (!session) {
            console.warn("[RouteGuard] No session found in localStorage");
            setIsAuthenticated(false);
            setIsChecking(false);
            navigate("/login");
            return;
          }

          const isValid = await sessionStorage.hasValidSession();
          console.log("[RouteGuard] Session validity (localStorage):", isValid);

          if (!isValid) {
            console.warn("[RouteGuard] Session expired");
            await sessionStorage.clearSession();
            setIsAuthenticated(false);
            setIsChecking(false);
            navigate("/login");
            return;
          }

          // Step 2: CRITICAL - Verify user actually exists in Supabase
          // This prevents stale localStorage sessions from granting access
          const user = await getCurrentUser();
          console.log("[RouteGuard] User verification:", {
            hasUser: !!user,
            email: user?.email,
          });

          if (!user) {
            console.warn(
              "[RouteGuard] User not found in Supabase - clearing stale session",
            );
            await sessionStorage.clearSession();
            setIsAuthenticated(false);
            setIsChecking(false);
            navigate("/login");
            return;
          }

          console.log(
            "[RouteGuard] Authentication successful for:",
            user.email,
          );
          setIsAuthenticated(true);
        } catch (error) {
          console.error("[RouteGuard] Error checking auth:", error);
          // On any error, clear session and redirect to login for security
          await sessionStorage.clearSession();
          setIsAuthenticated(false);
          setIsChecking(false);
          navigate("/login");
          return;
        }
      } else {
        setIsAuthenticated(true);
      }
      setIsChecking(false);
    }

    checkAuth();
  }, [requireAuth, navigate]);

  // Show loading state while checking session
  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <Card className="text-center">
          <CardContent className="pt-6">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-foreground" />
            <p className="text-sm text-muted-foreground">
              Checking authentication...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Redirect handled in useEffect, but show loading while redirecting
  if (requireAuth && !isAuthenticated && !isChecking) {
    return null; // Will redirect in useEffect
  }

  return <>{children}</>;
};
