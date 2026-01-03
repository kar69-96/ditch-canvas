import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RouteGuard from '../../src/components/RouteGuard';

/**
 * Unit tests for RouteGuard component
 * Tests authentication flow and route protection
 */

// Mock the auth service
vi.mock('../../src/services/api/auth', () => ({
  checkAuthStatus: vi.fn(),
}));

import { checkAuthStatus } from '../../src/services/api/auth';

describe('RouteGuard', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  const renderWithRouter = (component: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          {component}
        </BrowserRouter>
      </QueryClientProvider>
    );
  };

  it('should render children when authenticated', async () => {
    (checkAuthStatus as any).mockResolvedValue({
      isAuthenticated: true,
      user: { email: 'test@example.com' },
    });

    renderWithRouter(
      <RouteGuard>
        <div>Protected Content</div>
      </RouteGuard>
    );

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });

  it('should redirect to login when not authenticated', async () => {
    (checkAuthStatus as any).mockResolvedValue({
      isAuthenticated: false,
    });

    renderWithRouter(
      <RouteGuard>
        <div>Protected Content</div>
      </RouteGuard>
    );

    await waitFor(() => {
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });
  });

  it('should show loading state while checking auth', () => {
    (checkAuthStatus as any).mockImplementation(() => new Promise(() => {}));

    renderWithRouter(
      <RouteGuard>
        <div>Protected Content</div>
      </RouteGuard>
    );

    // Should show loading indicator or nothing
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('should handle authentication errors gracefully', async () => {
    (checkAuthStatus as any).mockRejectedValue(new Error('Auth error'));

    renderWithRouter(
      <RouteGuard>
        <div>Protected Content</div>
      </RouteGuard>
    );

    await waitFor(() => {
      // Should redirect to login on error
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });
  });
});

