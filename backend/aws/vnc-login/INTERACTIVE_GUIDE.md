# Interactive VNC Usage Guide

## Overview

The VNC login system provides **full keyboard and mouse interaction** with a remote browser window through your web browser. You can type, click, scroll, and navigate just like you would on a local machine.

## Quick Start

1. **Start a VNC session** (via API or script)
2. **Open the provided VNC URL** in your browser
3. **Click in the VNC canvas** to focus it
4. **Use your keyboard and mouse** to interact with the remote browser
5. **Complete the Canvas login** normally

## How It Works

```
Your Browser → noVNC Web Interface → WebSocket → x11vnc Server → Remote Browser
```

- **noVNC**: Web-based VNC client that runs in your browser
- **x11vnc**: VNC server that captures the remote desktop and sends input
- **Input forwarding**: Your keyboard and mouse actions are sent to the remote machine in real-time

## Using Keyboard Input

1. **Click in the VNC window** to ensure it has focus (the canvas area, not just the page)
2. **Type normally** - your keystrokes will appear in the remote browser
3. **All keys work**: Letters, numbers, special characters, modifiers (Shift, Ctrl, Alt), function keys
4. **Keyboard shortcuts**: Work normally (Ctrl+C, Ctrl+V, Tab, Enter, etc.)

### Troubleshooting Keyboard Input

- **Not typing?** Click in the VNC canvas first to give it focus
- **Wrong characters?** The keyboard layout is set to US English by default
- **Special keys not working?** Try clicking in the VNC window again

## Using Mouse Input

1. **Move your mouse** over the VNC canvas
2. **Click normally** - left click, right click, middle click all work
3. **Drag and drop** - Click and hold, then drag
4. **Scroll** - Use your mouse wheel or trackpad scrolling within the VNC canvas
5. **Hover effects** - Mouse hover works for tooltips, menus, etc.

### Mouse Features

- **Smooth cursor tracking**: The remote cursor follows your mouse movements
- **Click-to-type**: Clicking in text fields automatically focuses them
- **Scroll synchronization**: Scrolling in the VNC window scrolls the remote page
- **Multi-button support**: All mouse buttons are supported

## Best Practices

### 1. Focus Management
- **Always click in the VNC canvas** before typing
- The window is auto-focused when it opens, but you may need to click again
- If input stops working, click in the VNC window to regain focus

### 2. Window Interaction
- The browser window is automatically sized to 1920x1080
- You can see the full browser interface
- Multiple browser windows are supported

### 3. Navigation
- Click links, buttons, and form fields normally
- Use browser navigation buttons (back/forward) if visible
- Type URLs directly in the address bar
- Use keyboard shortcuts like Ctrl+L to focus address bar

### 4. Form Filling
- Click in input fields to focus them
- Type your credentials normally
- Use Tab to move between fields
- Press Enter to submit forms

## Configuration Details

### x11vnc Server Settings
- **Keyboard support**: Enabled with `-xkb` flag
- **Mouse support**: Full pointer mode enabled
- **Key repeat**: Enabled for normal typing experience
- **Input acceptance**: Configured to accept all input types

### noVNC Client Settings
- **View-only mode**: **Disabled** (`view_only=false`)
- **Auto-connect**: Enabled for immediate connection
- **Auto-focus**: Enabled to focus on click
- **Quality**: High quality rendering (level 6)
- **Compression**: Balanced for responsive interaction

## Troubleshooting

### "Keyboard input not working"
1. Click in the VNC canvas area
2. Try clicking a text field in the remote browser
3. Check browser console for errors
4. Refresh the VNC page and reconnect

### "Mouse clicks not registering"
1. Click in the center of the VNC canvas first
2. Try a different mouse button
3. Check if the remote browser window is visible
4. Refresh and reconnect if needed

### "Input is delayed"
- This is normal for network-based VNC connections
- The delay depends on your internet connection speed
- Close other bandwidth-heavy applications

### "Can't see the browser window"
- The window should appear automatically
- Try refreshing the VNC page
- Check EC2 instance logs: `/var/log/vnc-login-*.log`
- Verify the browser launched: Check supervisor status

## Advanced Features

### Multi-Connection Support
- Multiple users can connect to the same VNC session (shared mode)
- All users see the same desktop
- Only one user's input is active at a time

### Window Management
- Browser windows are automatically sized and positioned
- Window focus is managed automatically
- You can interact with multiple browser tabs/windows

### Network Requirements
- Stable internet connection recommended
- Low latency for best responsiveness
- Works over standard HTTP (port 80)
- WebSocket connection for real-time updates

## Security Notes

- VNC sessions are temporary (expire after timeout)
- No password by default (consider adding for production)
- Connections are over HTTP (consider HTTPS for production)
- Sessions are isolated per token

## Getting Help

If you encounter issues:

1. Check the console output when starting the session
2. Review EC2 logs: `ssh ... "tail -f /var/log/vnc-login-*.log"`
3. Check supervisor services: `ssh ... "sudo supervisorctl status"`
4. Verify noVNC is accessible: Open the VNC URL directly in browser
5. Test manually: Try connecting with a desktop VNC client (optional)

## Summary

The VNC system provides **full interactive control** - you can use your keyboard and mouse exactly as you would on a local machine. Just click in the VNC window, type your credentials, and navigate normally. The system handles all the technical details automatically.




