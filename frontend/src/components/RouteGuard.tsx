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
 * If requireAuth is true, shows authentication message if no valid session
 */
export const RouteGuard = ({ children, requireAuth = true }: RouteGuardProps) => {
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function checkAuth() {
      if (requireAuth) {
        try {
          const session = await sessionStorage.getSession();
          console.log('[RouteGuard] Session check:', { hasSession: !!session, userId: session?.userId });
          
          if (!session) {
            console.warn('[RouteGuard] No session found');
            setIsAuthenticated(false);
            setIsChecking(false);
            navigate('/login');
            return;
          }
          
          const isValid = await sessionStorage.hasValidSession();
          console.log('[RouteGuard] Session validity:', isValid);
          
          if (!isValid) {
            console.warn('[RouteGuard] Session invalid');
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
            <p className="text-sm text-muted-foreground">Checking authentication...</p>
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

