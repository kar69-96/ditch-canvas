/**
 * ChatForumPage - Main forum page for anonymous class discussions
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Plus, Loader2 } from 'lucide-react';
import { useChatPosts, useOnboardingState, useMarkOnboardingSeen } from '@/hooks/useChat';
import { useChatRealtime } from '@/hooks/useChatRealtime';
import { useSidebar, SidebarViewer } from '@/components/SidebarViewer';
import { useCanvasData } from '@/hooks/useCanvasData';
import { PostCard } from '@/components/chat/PostCard';
import { SearchBar } from '@/components/chat/SearchBar';
import { TagFilter } from '@/components/chat/TagFilter';
import { SortDropdown } from '@/components/chat/SortDropdown';
import { PostForm } from '@/components/chat/PostForm';
import { OnboardingModal } from '@/components/chat/OnboardingModal';
import type { PostTag, SortMode } from '@/types/chat';

export default function ChatForumPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const courseId = id ? parseInt(id) : null;
  const { openItem, isOpen: isSidebarOpen, sidebarWidth, isFullscreen } = useSidebar();
  const { data: canvasData } = useCanvasData();

  // Get course info
  const course = canvasData?.courses.find((c) => c.id === courseId);

  // State
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<PostTag[]>([]);
  const [sort, setSort] = useState<SortMode>('default');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Onboarding
  const { data: onboardingState } = useOnboardingState(courseId || 0);
  const markOnboardingSeen = useMarkOnboardingSeen();

  // Fetch posts
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useChatPosts(
    courseId || 0,
    {
      search: search || undefined,
      tag: selectedTags.length > 0 ? selectedTags : undefined,
    },
    sort
  );

  // Real-time updates
  useChatRealtime({ courseId: courseId || undefined, enabled: !!courseId });

  // Flatten pages into single array
  const posts = data?.pages.flat() || [];

  // Infinite scroll
  useEffect(() => {
    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 1000 &&
        hasNextPage &&
        !isFetchingNextPage
      ) {
        fetchNextPage();
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Handle post click - open in sidecar
  const handlePostClick = useCallback((postId: string) => {
    // Find the post to get its title
    const post = posts.find(p => p.id === postId);
    console.log('Opening post in sidecar:', postId, post?.title, 'openItem:', typeof openItem);
    try {
      openItem({
        id: postId,
        type: 'chat',
        title: post?.title || 'Post',
        postId: postId,
      });
      console.log('openItem called successfully');
    } catch (error) {
      console.error('Error opening sidecar:', error);
    }
  }, [openItem, posts]);

  // Handle onboarding dismiss
  const handleDismissOnboarding = async () => {
    if (courseId) {
      await markOnboardingSeen.mutateAsync(courseId);
    }
  };

  if (!courseId) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <p className="text-muted-foreground">Invalid course ID</p>
        </div>
      </Layout>
    );
  }

  return (
    <div className="relative w-full">
      {/* Main Content Wrapper */}
      {!isFullscreen && (
        <div 
          className="transition-all duration-150 ease-out max-lg:pr-0"
          style={{ paddingRight: isSidebarOpen ? sidebarWidth : 0 }}
        >
          <Layout>
            <div className="px-5 sm:px-8 pb-10">
        {/* Header */}
        <header className="py-6 sm:py-8 border-b border-border mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="page-header">
                {course?.code || 'Class'} Discussion
              </h1>
              <p className="page-header-subtitle">
                Ask questions and share solutions anonymously
              </p>
            </div>
            <Button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New Post
            </Button>
          </div>
        </header>

        {/* Filters and Search */}
        <div className="mb-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <SearchBar value={search} onChange={setSearch} />
            </div>
            <SortDropdown value={sort} onChange={setSort} />
          </div>
          <TagFilter selectedTags={selectedTags} onChange={setSelectedTags} />
        </div>

        {/* Onboarding Modal */}
        <OnboardingModal
          open={!!(onboardingState && !onboardingState.has_seen_onboarding)}
          onClose={handleDismissOnboarding}
        />

        {/* Posts List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-destructive">Error loading posts: {error.message}</p>
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">No posts found</p>
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create First Post
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                userVote={post.user_vote}
                onClick={() => handlePostClick(post.id)}
              />
            ))}
            {isFetchingNextPage && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        )}

        {/* Create Post Modal */}
        <PostForm
          open={showCreateModal}
          onOpenChange={setShowCreateModal}
          courseId={courseId}
          onSuccess={() => {
            // Posts will refresh automatically via React Query
          }}
        />
            </div>
          </Layout>
        </div>
      )}

      {/* Sidebar Viewer */}
      <SidebarViewer />
    </div>
  );
}

