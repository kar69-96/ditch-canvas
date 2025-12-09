import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginWithEmail } from '@/services/mockApi/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import GlassCard from '@/components/GlassCard';
import { Loader2 } from 'lucide-react';

const Login = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateEduEmail = (email: string): boolean => {
    return email.endsWith('.edu');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !validateEduEmail(email.trim())) {
      setError('Please enter a valid .edu email address');
      return;
    }

    setIsLoading(true);
    setError(null);
    
    try {
      const result = await loginWithEmail(email.trim());
      
      if (!result) {
        setError('No account found for this email. Please contact support to set up your account.');
        setIsLoading(false);
        return;
      }

      // Login successful, navigate to dashboard
      navigate('/dashboard');
    } catch (err) {
      console.error('[Login] Login error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred during login. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="h-px bg-border absolute top-0 left-0 right-0" />
      <div className="w-full max-w-md ">
        <GlassCard className="text-center">
          <div className="mb-8">
            <h1 className="text-3xl font-medium mb-2 text-foreground">
              Welcome
            </h1>
            <p className="text-muted-foreground text-sm">
              Enter your .edu email to sign in
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <Input
              type="email"
              placeholder="your.email@university.edu"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              required
              className="w-full"
              disabled={isLoading}
            />
            
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full py-6 text-lg bg-background border-2 border-foreground/20 text-foreground hover:bg-background/80"
              size="lg"
              disabled={isLoading || !email.trim() || !validateEduEmail(email.trim())}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground mt-6">
            Don't have an account? Contact support to set up your dataset.
          </p>
        </GlassCard>
      </div>
    </div>
  );
};

export default Login;
