import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCurrentUser } from "@/services/mockApi/auth";
import { userDatabase } from "@/services/database/userDatabase";
import { toast } from "@/hooks/use-toast";

const ComingSoon = () => {
  const navigate = useNavigate();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!phoneNumber.trim()) {
      toast({
        title: "Error",
        description: "Please enter a phone number",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const user = await getCurrentUser();
      if (!user) {
        toast({
          title: "Error",
          description: "Please log in to continue",
          variant: "destructive",
        });
        navigate("/login");
        return;
      }

      // Update user with phone number
      // The userDatabase.updateUser will handle storing phone_number in both profileData and the phone_number column
      await userDatabase.updateUser({
        ...user,
        profileData: {
          ...user.profileData,
          phoneNumber: phoneNumber.trim(),
        },
      });

      toast({
        title: "Success",
        description: "Thanks for your interest! We'll be in touch soon.",
      });

      // Navigate back to assistant page
      navigate("/assistant");
    } catch (error) {
      console.error("Error submitting phone number:", error);
      toast({
        title: "Error",
        description: "Failed to submit phone number. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-8">
          <h1 className="text-3xl font-bold">Coming soon!</h1>
          <p className="text-lg text-muted-foreground">
            Thanks for the interest - you'll be the first to know
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="tel"
              placeholder="Phone number"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="text-center"
              disabled={isSubmitting}
            />
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? "Submitting..." : "Submit"}
            </Button>
          </form>
        </div>
      </div>
    </Layout>
  );
};

export default ComingSoon;

