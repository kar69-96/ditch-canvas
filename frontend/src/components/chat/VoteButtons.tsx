/**
 * VoteButtons component for upvoting and downvoting posts/responses
 */

import { ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useVote } from '@/hooks/useChat';
import type { VoteTargetType } from '@/types/chat';

interface VoteButtonsProps {
  targetId: string;
  targetType: VoteTargetType;
  currentScore: number;
  userVote?: 'up' | 'down' | null;
  className?: string;
}

export function VoteButtons({
  targetId,
  targetType,
  currentScore,
  userVote,
  className,
}: VoteButtonsProps) {
  const voteMutation = useVote();

  const handleVote = async (voteType: 'up' | 'down') => {
    try {
      await voteMutation.mutateAsync({
        targetId,
        targetType,
        voteType,
      });
    } catch (error: any) {
      console.error('Failed to vote:', error);
    }
  };

  const isUpvoted = userVote === 'up';
  const isDownvoted = userVote === 'down';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          'h-8 w-8',
          isUpvoted && 'bg-green-500/20 text-green-500 hover:bg-green-500/30'
        )}
        onClick={() => handleVote('up')}
        disabled={voteMutation.isPending}
      >
        <ArrowUp className="w-4 h-4" />
      </Button>

      <span
        className={cn(
          'text-sm font-medium min-w-[2rem] text-center',
          currentScore > 0 && 'text-green-500',
          currentScore < 0 && 'text-red-500'
        )}
      >
        {currentScore > 0 ? '+' : ''}{currentScore}
      </span>

      <Button
        variant="ghost"
        size="icon"
        className={cn(
          'h-8 w-8',
          isDownvoted && 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
        )}
        onClick={() => handleVote('down')}
        disabled={voteMutation.isPending}
      >
        <ArrowDown className="w-4 h-4" />
      </Button>
    </div>
  );
}

