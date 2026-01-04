import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top right Log In button */}
      <div className="flex justify-end p-6">
        <Button
          onClick={() => navigate('/login')}
          variant="outline"
        >
          Log In
        </Button>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          {/* Add your landing page content here */}
        </div>
      </div>

      {/* Join Now button at middle bottom 3/4 */}
      <div className="flex justify-center pb-16">
        <Button
          onClick={() => navigate('/onboarding/info')}
          size="lg"
          className="px-8 py-6 text-lg"
        >
          Join Now
        </Button>
      </div>
    </div>
  );
}

