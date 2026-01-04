/**
 * PostCard component for displaying a post in the list
 */

import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { motion } from 'framer-motion';
import GlassCard from '@/components/GlassCard';
import { Badge } from '@/components/ui/badge';
import { VoteButtons } from './VoteButtons';
import { cn } from '@/lib/utils';
import type { Post } from '@/types/chat';
import { formatDistanceToNow } from 'date-fns';

interface PostCardProps {
  post: Post;
  userVote?: 'up' | 'down' | null;
  onClick: () => void;
}

const TAG_COLORS: Record<string, string> = {
  problem: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
  discussion: 'bg-green-500/20 text-green-500 border-green-500/30',
  other: 'bg-gray-500/20 text-gray-500 border-gray-500/30',
};

export function PostCard({ post, userVote, onClick }: PostCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const timeAgo = formatDistanceToNow(new Date(post.created_at), { addSuffix: true });

  const handleClick = (e: React.MouseEvent) => {
    // Don't prevent default or stop propagation - let the click bubble naturally
    console.log('PostCard clicked:', post.id, post.title);
    onClick();
  };

  return (
    <div
      className="relative cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      {isHovered && (
        <motion.div
          layoutId="postCardSidebar"
          className="absolute left-0 top-0 bottom-0 w-[3px] bg-foreground z-0"
          initial={false}
          transition={{
            type: "tween",
            duration: 0.1,
            ease: "easeOut"
          }}
        />
      )}
      <GlassCard
        hover={false}
        className="relative z-10"
      >
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-foreground/90 line-clamp-2 mb-2">
                {post.title}
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="outline"
                  className={cn('text-xs capitalize', TAG_COLORS[post.tag])}
                >
                  {post.tag}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  by {post.anonymous_thread_id}
                </span>
              </div>
            </div>
          </div>

          {/* Meta info and Vote buttons */}
          <div className="flex items-center justify-between gap-4 text-xs text-foreground/60 pt-2 border-t border-border">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                <span>{post.response_count} {post.response_count === 1 ? 'response' : 'responses'}</span>
              </div>
              <span>{timeAgo}</span>
              {post.is_edited && (
                <span className="text-muted-foreground/50 italic">edited</span>
              )}
            </div>
            
            {/* Vote buttons in bottom right */}
            <div data-vote-buttons onClick={(e) => e.stopPropagation()}>
              <VoteButtons
                targetId={post.id}
                targetType="post"
                currentScore={post.net_score}
                userVote={userVote}
                className="scale-90"
              />
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

