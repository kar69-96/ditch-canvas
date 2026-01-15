import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitPersonalInfo, joinWaitlist } from "@/services/api/onboarding";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function OnboardingInfo() {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [school, setSchool] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!firstName.trim() || !school || !email.trim()) {
      setError("Please fill in all fields");
      return;
    }

    // Validate email format
    const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      setError("Please enter a valid email address");
      return;
    }

    setLoading(true);

    try {
      const result = await submitPersonalInfo({
        firstName: firstName.trim(),
        school,
        email: email.trim(),
      });

      if (!result.success) {
        if (result.validSchool === false) {
          // School is invalid - add to waitlist
          try {
            const waitlistResult = await joinWaitlist({
              firstName: firstName.trim(),
              school,
              email: email.trim(),
            });

            if (waitlistResult.success) {
              // Store data in sessionStorage for potential future use
              sessionStorage.setItem(
                "onboarding_data",
                JSON.stringify({
                  firstName: firstName.trim(),
                  school,
                  email: email.trim(),
                }),
              );
              navigate("/onboarding/waitlist-confirmation");
            } else {
              setError(waitlistResult.error || "Failed to join waitlist");
            }
          } catch (err: any) {
            setError(err.message || "Failed to join waitlist");
          }
        } else {
          setError(result.error || "Failed to submit information");
        }
        setLoading(false);
        return;
      }

      if (result.validSchool && result.data) {
        // Valid school - store data and proceed to theme selection
        sessionStorage.setItem("onboarding_data", JSON.stringify(result.data));
        navigate("/onboarding/theme");
      } else {
        setError("Invalid school selection");
      }
    } catch (err: any) {
      setError(err.message || "An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Get Started</CardTitle>
          <CardDescription>Enter your information to begin</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="school">School</Label>
              <Select
                value={school}
                onValueChange={setSchool}
                disabled={loading}
              >
                <SelectTrigger id="school">
                  <SelectValue placeholder="Select your school" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Brown University">
                    Brown University
                  </SelectItem>
                  <SelectItem value="California State University">
                    California State University
                  </SelectItem>
                  <SelectItem value="Columbia University">
                    Columbia University
                  </SelectItem>
                  <SelectItem value="Cornell University">
                    Cornell University
                  </SelectItem>
                  <SelectItem value="Dartmouth College">
                    Dartmouth College
                  </SelectItem>
                  <SelectItem value="Harvard University">
                    Harvard University
                  </SelectItem>
                  <SelectItem value="Pennsylvania State University">
                    Pennsylvania State University
                  </SelectItem>
                  <SelectItem value="Princeton University">
                    Princeton University
                  </SelectItem>
                  <SelectItem value="Stanford University">
                    Stanford University
                  </SelectItem>
                  <SelectItem value="University of California, Berkeley">
                    University of California, Berkeley
                  </SelectItem>
                  <SelectItem value="University of California, Los Angeles">
                    University of California, Los Angeles
                  </SelectItem>
                  <SelectItem value="University of Colorado - Boulder">
                    University of Colorado - Boulder
                  </SelectItem>
                  <SelectItem value="University of Colorado - Denver">
                    University of Colorado - Denver
                  </SelectItem>
                  <SelectItem value="University of Michigan">
                    University of Michigan
                  </SelectItem>
                  <SelectItem value="University of Texas at Austin">
                    University of Texas at Austin
                  </SelectItem>
                  <SelectItem value="Yale University">
                    Yale University
                  </SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">School Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="xxxx1234@university.edu"
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
                  Processing...
                </>
              ) : (
                "Continue"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
