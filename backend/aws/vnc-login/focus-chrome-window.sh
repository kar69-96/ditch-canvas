#!/bin/bash
# Helper script to focus and prepare Chrome window for VNC input

DISPLAY=${DISPLAY:-:99}

echo "Focusing Chrome window for VNC input..."

# Wait a moment for Chrome to be ready
sleep 2

# Find the main Chrome window (largest visible one)
MAIN_WIN=$(xdotool search --class 'google-chrome' 2>/dev/null | while read winid; do
  geom=$(xdotool getwindowgeometry $winid 2>/dev/null | grep Geometry | awk '{print $2}')
  if [ -n "$geom" ]; then
    width=$(echo $geom | cut -dx -f1)
    if [ -n "$width" ] && [ "$width" -gt 500 ]; then
      echo $winid
      break
    fi
  fi
done | head -1)

if [ -n "$MAIN_WIN" ]; then
  echo "Found Chrome window: $MAIN_WIN"
  
  # Resize to full screen
  xdotool windowsize $MAIN_WIN 1920 1080 2>/dev/null
  xdotool windowmove $MAIN_WIN 0 0 2>/dev/null
  
  # Focus the window
  xdotool windowactivate $MAIN_WIN 2>/dev/null
  xdotool windowfocus $MAIN_WIN 2>/dev/null
  
  echo "Chrome window focused and ready for input"
else
  echo "Could not find Chrome window"
fi



