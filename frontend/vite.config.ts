import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
      external: [
        /.*\.test\.(ts|tsx|js|jsx)$/,
        /.*\/tests?\/.*/,
      ],
    },
  },
  server: {
    host: "0.0.0.0", // Listen on all network interfaces
    port: 5173,
    strictPort: false, // Try next available port if 5173 is taken
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
    },
    // Middleware to handle SPA routing - serve index.html for all non-API routes
    middlewareMode: false,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    // Custom plugin to handle SPA routing fallback
    {
      name: 'spa-fallback',
      configureServer(server) {
        return () => {
          server.middlewares.use((req, res, next) => {
            // Skip API routes (handled by proxy)
            if (req.url?.startsWith('/api')) {
              return next();
            }
            // Skip if Vite is already handling it (has file extension or is a Vite internal route)
            if (req.url?.includes('.') && !req.url?.endsWith('/')) {
              return next();
            }
            // For SPA routes (no file extension), serve index.html
            // This ensures client-side routing works on refresh
            if (req.url && !req.url.includes('.')) {
              req.url = '/index.html';
            }
            next();
          });
        };
      },
    },
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
