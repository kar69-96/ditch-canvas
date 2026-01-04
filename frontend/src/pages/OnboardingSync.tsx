import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { startStreamingAuth, getExtractionResult, stopStreamingAuth } from '@/services/api/auth';
import { submitIdentikey, completeOnboarding } from '@/services/api/onboarding';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function OnboardingSync() {
  const navigate = useNavigate();
  const [identikey, setIdentikey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [popupWindow, setPopupWindow] = useState<Window | null>(null);
  const [onboardingData, setOnboardingData] = useState<any>(null);

  useEffect(() => {
    // Load onboarding data from sessionStorage
    const stored = sessionStorage.getItem('onboarding_data');
    if (!stored) {
      // No data found - redirect back to info step
      navigate('/onboarding/info');
      return;
    }
    setOnboardingData(JSON.parse(stored));
  }, [navigate]);

  const handleSync = async () => {
    setError(null);
    setStatus(null);

    if (!identikey.trim()) {
      setError('Please enter your identikey');
      return;
    }

    if (!onboardingData || !onboardingData.email || !onboardingData.firstName || !onboardingData.school || !onboardingData.inviteCode) {
      setError('Missing onboarding data. Please start over.');
      return;
    }

    setLoading(true);
    setStatus('Preparing authentication...');

    try {
      // Submit identikey first
      const syncResult = await submitIdentikey(
        identikey.trim(),
        onboardingData.email,
        onboardingData.firstName,
        onboardingData.school,
        onboardingData.inviteCode
      );

      if (!syncResult.success) {
        setError(syncResult.error || 'Failed to prepare sync');
        setLoading(false);
        return;
      }

      setStatus('Starting authentication...');

      // Start streaming auth for onboarding (no AWS update will run)
      const startResult = await startStreamingAuth(onboardingData.email, 'onboarding');

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
          // Check for extraction results periodically
          if (!extractionCompleted) {
            const extractionResult = await getExtractionResult(onboardingData.email);

            // Skip if still pending (extraction in progress)
            if (extractionResult.pending) {
              return; // Continue polling
            }

            if (extractionResult.success) {
              extractionCompleted = true;

              // Close popup if still open
              if (!popup.closed) {
                popup.close();
              }

              // Wait a moment for any final processing
              await new Promise(resolve => setTimeout(resolve, 1000));

              setStatus('Completing setup...');

              // Complete onboarding - create user account
              const completeResult = await completeOnboarding(
                onboardingData.email,
                onboardingData.firstName,
                onboardingData.school,
                onboardingData.inviteCode,
                identikey.trim()
              );

              if (!completeResult.success) {
                clearInterval(checkInterval);
                setPopupWindow(null);
                setError(completeResult.error || 'Failed to complete setup');
                setLoading(false);
                await stopStreamingAuth(onboardingData.email);
                return;
              }

              // Stop streaming server
              await stopStreamingAuth(onboardingData.email);

              clearInterval(checkInterval);
              setPopupWindow(null);

              // Clear onboarding data from sessionStorage
              sessionStorage.removeItem('onboarding_data');

              setStatus('Setup complete! Redirecting...');

              // Redirect to completion page
              setTimeout(() => {
                navigate('/onboarding/complete');
              }, 1000);

              return;
            }

            // Check for errors
            if (extractionResult.error) {
              clearInterval(checkInterval);
              setPopupWindow(null);
              setError(extractionResult.error || 'Cookie extraction failed');
              setLoading(false);
              await stopStreamingAuth(onboardingData.email);
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
            const extractionResult = await getExtractionResult(onboardingData.email);

            if (extractionResult.pending) {
              // Continue waiting
              return;
            }

            if (extractionResult.success) {
              // Same success handling as above
              extractionCompleted = true;
              setStatus('Completing setup...');

              const completeResult = await completeOnboarding(
                onboardingData.email,
                onboardingData.firstName,
                onboardingData.school,
                onboardingData.inviteCode,
                identikey.trim()
              );

              if (!completeResult.success) {
                setError(completeResult.error || 'Failed to complete setup');
                setLoading(false);
                await stopStreamingAuth(onboardingData.email);
                return;
              }

              await stopStreamingAuth(onboardingData.email);
              sessionStorage.removeItem('onboarding_data');
              setStatus('Setup complete! Redirecting...');

              setTimeout(() => {
                navigate('/onboarding/complete');
              }, 1000);
            } else {
              setError('Cookie extraction was cancelled or failed');
              setLoading(false);
              await stopStreamingAuth(onboardingData.email);
            }
          }
        } catch (err: any) {
          console.error('[OnboardingSync] Error in extraction check:', err);
          // Don't clear interval on error - let it retry
        }
      }, 2000); // Check every 2 seconds

      // Cleanup on unmount
      return () => {
        clearInterval(checkInterval);
        if (popup && !popup.closed) {
          popup.close();
        }
      };
    } catch (err: any) {
      console.error('[OnboardingSync] Error:', err);
      setError(err.message || 'An error occurred. Please try again.');
      setLoading(false);
    }
  };

  if (!onboardingData) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sync with Canvas</CardTitle>
          <CardDescription>Enter your identikey to sync with Canvas</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identikey">Identikey</Label>
              <Input
                id="identikey"
                type="text"
                value={identikey}
                onChange={(e) => setIdentikey(e.target.value)}
                placeholder="your-identikey"
                required
                disabled={loading}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {status && (
              <Alert>
                <AlertDescription>{status}</AlertDescription>
              </Alert>
            )}

            <Button
              onClick={handleSync}
              className="w-full"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {status || 'Processing...'}
                </>
              ) : (
                'Sync with Canvas'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

