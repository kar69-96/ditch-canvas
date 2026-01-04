/**
 * TagFilter component for filtering posts by tag
 */

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { PostTag } from '@/types/chat';

interface TagFilterProps {
  selectedTags: PostTag[];
  onChange: (tags: PostTag[]) => void;
  className?: string;
}

const TAG_COLORS: Record<PostTag, string> = {
  problem: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
  discussion: 'bg-green-500/20 text-green-500 border-green-500/30',
  other: 'bg-gray-500/20 text-gray-500 border-gray-500/30',
};

export function TagFilter({ selectedTags, onChange, className }: TagFilterProps) {
  const tags: PostTag[] = ['problem', 'discussion', 'other'];

  const toggleTag = (tag: PostTag) => {
    if (selectedTags.includes(tag)) {
      onChange(selectedTags.filter((t) => t !== tag));
    } else {
      onChange([...selectedTags, tag]);
    }
  };

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {tags.map((tag) => {
        const isSelected = selectedTags.includes(tag);
        return (
          <Badge
            key={tag}
            variant={isSelected ? 'default' : 'outline'}
            className={cn(
              'cursor-pointer capitalize transition-colors',
              isSelected && TAG_COLORS[tag]
            )}
            onClick={() => toggleTag(tag)}
          >
            {tag}
          </Badge>
        );
      })}
    </div>
  );
}

