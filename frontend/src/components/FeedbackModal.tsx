import { useState, useRef } from "react";
import emailjs from "@emailjs/browser";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  MessageSquare,
  Loader2,
  ImagePlus,
  X,
  ChevronRight,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

// EmailJS: set VITE_EMAILJS_* in env (never commit real keys)
// Template variables: {{from_name}}, {{from_email}}, {{message}}, {{image_data}}, {{favorite_features}}

const FEATURES = [
  { id: "dashboard", label: "Dashboard Overview" },
  { id: "calendar", label: "Calendar View" },
  { id: "courses", label: "Course Pages" },
  { id: "assignments", label: "Assignment Tracking" },
  { id: "integrations", label: "Google Sheets / Notion Integrations" },
  { id: "tabus", label: "Tabus AI Assistant" },
  { id: "chat", label: "Class Chat Forums" },
  { id: "design", label: "Overall Design & UI" },
];

interface FeedbackModalProps {
  userName?: string;
  userEmail?: string;
  isHovered?: boolean;
  onHover?: (hovered: boolean) => void;
}

export default function FeedbackModal({
  userName,
  userEmail,
  isHovered,
  onHover,
}: FeedbackModalProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"feedback" | "features">("feedback");
  const [message, setMessage] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [feedbackData, setFeedbackData] = useState<Record<
    string,
    string
  > | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Compress image to fit EmailJS size limits
  const compressImage = (
    file: File,
    maxWidth: number = 800,
    quality: number = 0.6,
  ): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;

          // Scale down if too large
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Could not get canvas context"));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL("image/jpeg", quality);
          resolve(compressed);
        };
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Check file size (max 10MB before compression)
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please select an image under 10MB",
          variant: "destructive",
        });
        return;
      }

      setImageFile(file);

      try {
        // Compress image for EmailJS (they have strict size limits)
        const compressed = await compressImage(file, 600, 0.5);
        setImagePreview(compressed);
      } catch (err) {
        console.error("[FeedbackModal] Error compressing image:", err);
        toast({
          title: "Image error",
          description: "Could not process image. Please try another.",
          variant: "destructive",
        });
        setImageFile(null);
      }
    }
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmitFeedback = async () => {
    if (!message.trim()) {
      toast({
        title: "Message required",
        description: "Please enter your feedback",
        variant: "destructive",
      });
      return;
    }

    // Store feedback data and move to features step
    // Note: to_email is configured in EmailJS template, not sent from client
    const templateParams: Record<string, string> = {
      from_name: userName || "User",
      from_email: userEmail || "not-provided@unknown.com",
      message: message.trim(),
    };

    if (imagePreview) {
      templateParams.image_data = imagePreview;
    }

    setFeedbackData(templateParams);
    setStep("features");
  };

  const handleFeatureToggle = (featureId: string) => {
    setSelectedFeatures((prev) =>
      prev.includes(featureId)
        ? prev.filter((id) => id !== featureId)
        : [...prev, featureId],
    );
  };

  const handleSubmitAll = async () => {
    if (!feedbackData) return;

    const emailjsServiceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
    const emailjsTemplateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
    const emailjsPublicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

    if (!emailjsServiceId || !emailjsTemplateId || !emailjsPublicKey) {
      toast({
        title: "Feedback unavailable",
        description:
          "Email feedback is not configured for this deployment (missing VITE_EMAILJS_* env).",
        variant: "destructive",
      });
      return;
    }

    setSending(true);

    try {
      // Add selected features to the feedback
      const selectedLabels = selectedFeatures
        .map((id) => FEATURES.find((f) => f.id === id)?.label)
        .filter(Boolean)
        .join(", ");

      const finalParams = {
        ...feedbackData,
        favorite_features: selectedLabels || "None selected",
      };

      await emailjs.send(
        emailjsServiceId,
        emailjsTemplateId,
        finalParams,
        emailjsPublicKey,
      );

      toast({
        title: "Feedback sent",
        description: "Thank you for your feedback!",
      });

      // Reset form
      resetForm();
    } catch (error: any) {
      console.error("[FeedbackModal] Error sending feedback:", error);
      console.error("[FeedbackModal] Error details:", {
        text: error?.text,
        status: error?.status,
        message: error?.message,
      });
      toast({
        title: "Failed to send",
        description: error?.text || error?.message || "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const handleSkipFeatures = async () => {
    if (!feedbackData) return;

    const emailjsServiceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
    const emailjsTemplateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
    const emailjsPublicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

    if (!emailjsServiceId || !emailjsTemplateId || !emailjsPublicKey) {
      toast({
        title: "Feedback unavailable",
        description:
          "Email feedback is not configured for this deployment (missing VITE_EMAILJS_* env).",
        variant: "destructive",
      });
      return;
    }

    setSending(true);

    try {
      const finalParams = {
        ...feedbackData,
        favorite_features: "Skipped",
      };

      await emailjs.send(
        emailjsServiceId,
        emailjsTemplateId,
        finalParams,
        emailjsPublicKey,
      );

      toast({
        title: "Feedback sent",
        description: "Thank you for your feedback!",
      });

      resetForm();
    } catch (error: any) {
      console.error("[FeedbackModal] Error sending feedback:", error);
      toast({
        title: "Failed to send",
        description: "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const resetForm = () => {
    setMessage("");
    setImageFile(null);
    setImagePreview(null);
    setSelectedFeatures([]);
    setFeedbackData(null);
    setStep("feedback");
    setOpen(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset to first step when closing
      setStep("feedback");
      setSelectedFeatures([]);
      setFeedbackData(null);
    }
    setOpen(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          className="relative p-2 border border-border bg-background overflow-hidden"
          title="Send Feedback"
          onMouseEnter={() => onHover?.(true)}
          onMouseLeave={() => onHover?.(false)}
        >
          {isHovered && (
            <motion.div
              layoutId="actionButtonFill"
              className="absolute inset-0 bg-foreground"
              initial={false}
              transition={{
                type: "tween",
                duration: 0.15,
                ease: "easeOut",
              }}
            />
          )}
          <MessageSquare
            className={cn(
              "w-4 h-4 relative z-10",
              isHovered && "text-background",
            )}
          />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        {step === "feedback" ? (
          <>
            <DialogHeader>
              <DialogTitle>Send Feedback</DialogTitle>
              <DialogDescription>
                Help improve DitchCanvas for other students.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="feedback-message">Your Feedback</Label>
                <Textarea
                  id="feedback-message"
                  placeholder="Share what you think, report a bug, or suggest a feature..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  disabled={sending}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="feedback-image">
                  Attach Screenshot (optional)
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    ref={fileInputRef}
                    id="feedback-image"
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    disabled={sending}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sending}
                  >
                    <ImagePlus className="w-4 h-4 mr-2" />
                    {imageFile ? "Change Image" : "Add Image"}
                  </Button>
                  {imageFile && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={removeImage}
                      disabled={sending}
                    >
                      <X className="w-4 h-4 mr-1" />
                      Remove
                    </Button>
                  )}
                </div>
                {imagePreview && (
                  <div className="mt-2 relative">
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="max-h-32 rounded border border-border"
                    />
                  </div>
                )}
              </div>

              <Button
                onClick={handleSubmitFeedback}
                className="w-full"
                disabled={sending}
              >
                Continue
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>One more thing!</DialogTitle>
              <DialogDescription>
                Which features do you like the most?
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-3">
                {FEATURES.map((feature) => (
                  <div key={feature.id} className="flex items-center space-x-3">
                    <Checkbox
                      id={feature.id}
                      checked={selectedFeatures.includes(feature.id)}
                      onCheckedChange={() => handleFeatureToggle(feature.id)}
                      disabled={sending}
                    />
                    <Label
                      htmlFor={feature.id}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {feature.label}
                    </Label>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={handleSkipFeatures}
                  disabled={sending}
                  className="flex-1"
                >
                  Skip
                </Button>
                <Button
                  onClick={handleSubmitAll}
                  disabled={sending}
                  className="flex-1"
                >
                  {sending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Submit"
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
