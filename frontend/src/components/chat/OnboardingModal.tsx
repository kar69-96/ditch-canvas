/**
 * OnboardingModal component for first-time users
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface OnboardingModalProps {
  open: boolean;
  onClose: () => void;
}

export function OnboardingModal({ open, onClose }: OnboardingModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Welcome to Class Discussion</DialogTitle>
          <DialogDescription>
            Here's how it works:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-sm font-semibold text-primary">1</span>
            </div>
            <div>
              <p className="font-medium mb-1">Fully Anonymous</p>
              <p className="text-sm text-muted-foreground">
                All entries are fully anonymous and not visible to your instructor
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-sm font-semibold text-primary">2</span>
            </div>
            <div>
              <p className="font-medium mb-1">Verified by Classmates</p>
              <p className="text-sm text-muted-foreground">
                All entries are verified by at least 1 other classmate
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-sm font-semibold text-primary">3</span>
            </div>
            <div>
              <p className="font-medium mb-1">Earn Access by Contributing</p>
              <p className="text-sm text-muted-foreground">
                Chats are sorted by specific problems or topics. Generating a verified response to
                a problem grants you access to view solutions for a problem up to 5 times. Paid
                required after that.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-sm font-semibold text-primary">4</span>
            </div>
            <div>
              <p className="font-medium mb-1">First Solution Free</p>
              <p className="text-sm text-muted-foreground">
                Your first solution unlock is always free
              </p>
            </div>
          </div>
        </div>

        <Button onClick={onClose} className="w-full">
          Got it!
        </Button>
      </DialogContent>
    </Dialog>
  );
}

