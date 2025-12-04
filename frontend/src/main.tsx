import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// Import clearUserData utility for debugging
import "./utils/clearUserData";
import { applyBackgroundColor } from "./lib/preferences";

// Ensure the global background color is applied before the app renders
applyBackgroundColor();

// Initialize React Grab with custom keyboard shortcut (Cmd+G)
if (import.meta.env.DEV) {
  import("react-grab/core").then(({ init }) => {
    const api = init({
      theme: {
        enabled: true,
      },
      onStateChange: (state) => {
        if (state.isActive) {
          console.log("React Grab activated - hover over elements and click to copy!");
        } else {
          console.log("React Grab deactivated");
        }
      },
    });

    // Set up custom keyboard shortcut: Cmd+G (or Ctrl+G on Windows/Linux)
    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "g" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        api.activate();
      }
    });

    // Allow Escape key to deactivate
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (api.isActive()) {
          api.deactivate();
        }
      }
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);

