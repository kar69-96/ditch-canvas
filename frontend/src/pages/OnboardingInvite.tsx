import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { validateInviteCode } from '@/services/api/onboarding';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function OnboardingInvite() {
  const navigate = useNavigate();
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!inviteCode.trim()) {
      setError('Please enter an invite code');
      return;
    }

    setLoading(true);

    try {
      const result = await validateInviteCode(inviteCode.trim().toUpperCase());

      if (!result.success || !result.valid) {
        setError(result.error || 'Invalid invite code');
        setLoading(false);
        return;
      }

      // Valid invite code - store it and proceed to sync step
      if (onboardingData) {
        sessionStorage.setItem('onboarding_data', JSON.stringify({
          ...onboardingData,
          inviteCode: inviteCode.trim().toUpperCase(),
        }));
        navigate('/onboarding/sync');
      } else {
        setError('Missing onboarding data. Please start over.');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred. Please try again.');
    } finally {
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
          <CardTitle>Enter Invite Code</CardTitle>
          <CardDescription>Enter your invite code to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="inviteCode">Invite Code</Label>
              <Input
                id="inviteCode"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                className="uppercase"
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

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Validating...
                </>
              ) : (
                'Continue'
              )}
            </Button>

            <div className="text-center mt-2">
              <h2 className="text-sm text-muted-foreground">
                No invite code?{' '}
                <Link
                  to="/onboarding/waitlist-confirmation"
                  className="text-muted-foreground underline hover:text-foreground"
                  onClick={async (e) => {
                    e.preventDefault();
                    // Add to waitlist before navigating
                    try {
                      const { joinWaitlist } = await import('@/services/api/onboarding');
                      await joinWaitlist(onboardingData);
                      navigate('/onboarding/waitlist-confirmation');
                    } catch (err) {
                      console.error('Failed to join waitlist:', err);
                      navigate('/onboarding/waitlist-confirmation');
                    }
                  }}
                >
                  Join the waitlist here
                </Link>
              </h2>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

