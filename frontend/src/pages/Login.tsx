import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { checkEmailExists, startStreamingAuth, getExtractionResult, verifyLogin, stopStreamingAuth } from '@/services/api/auth';
import { sessionStorage } from '@/storage/session';
import { userDatabase } from '@/services/database/userDatabase';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function Login() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [popupWindow, setPopupWindow] = useState<Window | null>(null);
  const navigate = useNavigate();

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

  const handleContinue = async (isReauth = false) => {
    setError(null);
    setStatus(null);

    // Validate email format
    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }

    if (!validateEmail(email)) {
      setError('Please enter a valid Colorado email (xxxx1235@colorado.edu)');
      return;
    }

    setLoading(true);
    
    if (isReauth) {
      setStatus('Cookies expired. Re-authenticating...');
    } else {
    setStatus('Checking email...');
    }

    try {
      // Check if email exists in Supabase (skip on re-auth)
      if (!isReauth) {
        console.log('[Login] Checking email:', email);
      const emailCheck = await checkEmailExists(email);
        console.log('[Login] Email check result:', emailCheck);
      
      if (!emailCheck.exists) {
        setError('Email not found. Sign up flow coming soon.');
        setLoading(false);
        return;
        }
      }

      setStatus('Starting authentication...');
      console.log('[Login] Starting streaming auth for:', email);

      // Start streaming server
      const startResult = await startStreamingAuth(email);
      console.log('[Login] Streaming auth start result:', startResult);
      
      if (!startResult.success || !startResult.url) {
        throw new Error('Failed to start authentication server');
      }

      setStatus('Opening authentication window...');

      // Open pop-up window
      const popup = window.open(
        startResult.url,
        'Canvas Authentication',
        'width=1200,height=800,scrollbars=yes,resizable=yes'
      );

      if (!popup) {
        throw new Error('Please allow pop-ups for this site to continue');
      }

      setPopupWindow(popup);
      setStatus('Please complete Canvas login in the pop-up window...');

      // Monitor the popup and extraction
      let extractionCompleted = false;
      const checkInterval = setInterval(async () => {
        try {
          // Check for extraction results periodically (even if popup is still open)
          if (!extractionCompleted) {
            const extractionResult = await getExtractionResult(email);
            
            // Skip if still pending (extraction in progress)
            if (extractionResult.pending) {
              return; // Continue polling
            }
            
            if (extractionResult.success && extractionResult.username) {
              extractionCompleted = true;
              
              // Check if cookies are invalid (requires re-auth)
              if (extractionResult.requiresReauth) {
                clearInterval(checkInterval);
                if (!popup.closed) {
                  popup.close();
                }
                setPopupWindow(null);
                await stopStreamingAuth(email);
                
                // Show status message and automatically restart authentication
                setStatus(`Cookies invalid: ${extractionResult.reason || 'Authentication expired'}. Restarting authentication...`);
                
                // Wait a moment to show the message, then restart
                setTimeout(() => {
                  handleContinue(true).catch((err: any) => {
                    console.error('Re-auth error:', err);
                    setError(err.message || 'Failed to restart authentication');
                    setLoading(false);
                  });
                }, 2000);
                
                return;
              }
              
              // Close popup if still open
              if (!popup.closed) {
                popup.close();
              }
              
              // Wait a moment for any final processing
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Verify username matches email
              setStatus('Verifying authentication...');
              const verifyResult = await verifyLogin(email, extractionResult.username);
              
              if (!verifyResult.success || !verifyResult.isValid) {
                clearInterval(checkInterval);
                setPopupWindow(null);
                setError(`Username verification failed. Match: ${verifyResult.matchPercentage?.toFixed(1)}% (required: 30%)`);
                setLoading(false);
                await stopStreamingAuth(email);
                return;
              }

              // Only get user from database if cookies are valid AND username matches
              // (cookies were already validated in extraction result, username verified above)
              setStatus('Loading user data...');
              const user = await userDatabase.getUserByEmail(email);
              
              if (!user) {
                clearInterval(checkInterval);
                setPopupWindow(null);
                setError('User not found in database');
                setLoading(false);
                await stopStreamingAuth(email);
                return;
              }

              // Create session
              await sessionStorage.setSession(user.id, 7, email);
              
              setStatus('Login successful! Redirecting...');
              
              // Stop streaming server
              await stopStreamingAuth(email);
              
              clearInterval(checkInterval);
              setPopupWindow(null);
              
              // Redirect to dashboard
              setTimeout(() => {
                navigate('/');
              }, 1000);
              
              return;
            }
          }
          
          // Check if popup is closed (user closed it manually)
          if (popup.closed && !extractionCompleted) {
            clearInterval(checkInterval);
            setPopupWindow(null);
            
            // Wait a moment to see if extraction completed
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Final check for extraction results
            const extractionResult = await getExtractionResult(email);
            
            // Skip if still pending (extraction in progress)
            if (extractionResult.pending) {
              // Continue waiting - extraction might complete soon
              return;
            }
            
            if (extractionResult.success && extractionResult.username) {
              // Check if cookies are invalid (requires re-auth)
              if (extractionResult.requiresReauth) {
                await stopStreamingAuth(email);
                
                // Show status message and automatically restart authentication
                setStatus(`Cookies invalid: ${extractionResult.reason || 'Authentication expired'}. Restarting authentication...`);
                
                // Wait a moment to show the message, then restart
                setTimeout(() => {
                  handleContinue(true).catch((err: any) => {
                    console.error('Re-auth error:', err);
                    setError(err.message || 'Failed to restart authentication');
                    setLoading(false);
                  });
                }, 2000);
                
                return;
              }
              
              // Extraction completed, verify and login
              setStatus('Verifying authentication...');
              const verifyResult = await verifyLogin(email, extractionResult.username);
              
              if (verifyResult.success && verifyResult.isValid) {
                // Only get user from database if cookies are valid AND username matches
                setStatus('Loading user data...');
                const user = await userDatabase.getUserByEmail(email);
                
                if (user) {
                  await sessionStorage.setSession(user.id, 7, email);
                  setStatus('Login successful! Redirecting...');
                  await stopStreamingAuth(email);
                  
                  setTimeout(() => {
                    navigate('/');
                  }, 1000);
                  return;
                }
              }
            }
            
            // If we get here, extraction didn't complete
            setError('Authentication was cancelled or incomplete. Please try again.');
            setLoading(false);
            await stopStreamingAuth(email);
          }
        } catch (err: any) {
          console.error('Error monitoring extraction:', err);
          // Don't set error here immediately, let the user complete the flow
        }
      }, 2000); // Check every 2 seconds

      // Timeout after 10 minutes
      setTimeout(() => {
        if (!popup.closed) {
          clearInterval(checkInterval);
          popup.close();
          setPopupWindow(null);
          setError('Authentication timeout. Please try again.');
          setLoading(false);
          stopStreamingAuth(email);
        }
      }, 10 * 60 * 1000);

    } catch (err: any) {
      console.error('[Login] Canvas login error:', err);
      console.error('[Login] Error details:', {
        message: err.message,
        stack: err.stack,
        name: err.name
      });
      setError(err.message || 'An error occurred during login');
      setLoading(false);
      if (popupWindow && !popupWindow.closed) {
        popupWindow.close();
        setPopupWindow(null);
      }
      try {
        await stopStreamingAuth(email);
      } catch (stopErr) {
        console.error('[Login] Error stopping streaming auth:', stopErr);
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !loading) {
      handleContinue();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome</CardTitle>
          <CardDescription>
            Enter your Colorado email to continue
          </CardDescription>
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
              placeholder="xxxx1235@colorado.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={loading}
              className="w-full"
            />
          </div>

          <Button
            onClick={handleContinue}
            disabled={loading || !email.trim()}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              'Continue'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}


