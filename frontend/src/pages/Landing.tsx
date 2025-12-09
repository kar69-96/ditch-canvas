import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import GlassCard from "@/components/GlassCard";

const Landing = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="h-px bg-border absolute top-0 left-0 right-0" />
      <div className="w-full max-w-md">
        <GlassCard className="text-center">
          <div className="mb-8">
            <h1 className="text-3xl font-medium mb-2 text-foreground">
              Welcome
            </h1>
            <p className="text-muted-foreground text-sm">
              Get started with your Canvas account
            </p>
          </div>

          <div className="space-y-4">
            <Button
              onClick={() => navigate("/onboarding")}
              className="w-full py-6 text-lg bg-background border-2 border-foreground/20 text-foreground hover:bg-background/80"
              size="lg"
            >
              Sign Up
            </Button>

            <Button
              onClick={() => navigate("/login")}
              variant="outline"
              className="w-full py-6 text-lg"
              size="lg"
            >
              Sign In
            </Button>
          </div>
        </GlassCard>
      </div>
    </div>
  );
};

export default Landing;



