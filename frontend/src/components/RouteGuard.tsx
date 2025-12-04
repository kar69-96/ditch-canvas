import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sessionStorage } from '@/storage/session';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface RouteGuardProps {
  children: React.ReactNode;
  requireAuth?: boolean;
}

/**
 * RouteGuard component to protect routes that require authentication
 * If requireAuth is true, redirects to /login if no valid session
 */
export const RouteGuard = ({ children, requireAuth = true }: RouteGuardProps) => {
  const navigate = useNavigate();
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      if (requireAuth) {
        try {
          const session = await sessionStorage.getSession();
          console.log('[RouteGuard] Session check:', { hasSession: !!session, userId: session?.userId });
          
          if (!session) {
            console.warn('[RouteGuard] No session found, redirecting to login');
            setIsAuthenticated(false);
            setIsChecking(false);
            navigate('/login');
            return;
          }
          
          const isValid = await sessionStorage.hasValidSession();
          console.log('[RouteGuard] Session validity:', isValid);
          
          if (!isValid) {
            console.warn('[RouteGuard] Session invalid, redirecting to login');
            setIsAuthenticated(false);
            setIsChecking(false);
            navigate('/login');
            return;
          }
          
          console.log('[RouteGuard] Authentication successful');
          setIsAuthenticated(true);
        } catch (error) {
          console.error('[RouteGuard] Error checking auth:', error);
          setIsAuthenticated(false);
          setIsChecking(false);
          navigate('/login');
          return;
        }
      }
      setIsChecking(false);
    }
    
    checkAuth();
  }, [navigate, requireAuth]);

  // Show loading state while checking session
  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <Card className="text-center">
          <CardContent className="pt-6">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-foreground" />
            <p className="text-sm text-muted-foreground">Checking authentication...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (requireAuth && !isAuthenticated) {
    return null; // Will redirect in useEffect
  }

  return <>{children}</>;
};

