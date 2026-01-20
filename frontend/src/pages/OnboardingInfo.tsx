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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { submitPersonalInfo, joinWaitlist } from "@/services/api/onboarding";
import { Loader2, AlertCircle, Check, ChevronsUpDown } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const SCHOOLS = [
  "Brown University",
  "California State University",
  "Columbia University",
  "Cornell University",
  "Dartmouth College",
  "Harvard University",
  "Pennsylvania State University",
  "Princeton University",
  "Stanford University",
  "University of California, Berkeley",
  "University of California, Los Angeles",
  "University of Colorado - Boulder",
  "University of Colorado - Denver",
  "University of Michigan",
  "University of Texas at Austin",
  "Yale University",
  "Other",
];

export default function OnboardingInfo() {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [school, setSchool] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schoolOpen, setSchoolOpen] = useState(false);

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
              <Popover open={schoolOpen} onOpenChange={setSchoolOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={schoolOpen}
                    className="w-full justify-between font-normal"
                    disabled={loading}
                  >
                    {school || "Select your school..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="Search schools..." />
                    <CommandList>
                      <CommandEmpty>No school found.</CommandEmpty>
                      <CommandGroup>
                        {SCHOOLS.map((s) => (
                          <CommandItem
                            key={s}
                            value={s}
                            onSelect={(currentValue) => {
                              // cmdk lowercases the value, so find the original
                              const selectedSchool = SCHOOLS.find(
                                (s) =>
                                  s.toLowerCase() ===
                                  currentValue.toLowerCase(),
                              );
                              setSchool(selectedSchool || "");
                              setSchoolOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                school === s ? "opacity-100" : "opacity-0",
                              )}
                            />
                            {s}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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
