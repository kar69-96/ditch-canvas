#!/usr/bin/env python3
"""
Process screenshot to add computer screen frame and crop to content.
"""

from PIL import Image, ImageDraw, ImageFilter
import sys
import os

def find_content_bounds(img):
    """Find the bounding box of non-black content."""
    # Convert to grayscale for easier processing
    gray = img.convert('L')
    pixels = gray.load()
    width, height = gray.size
    
    # Find bounds
    min_x, min_y = width, height
    max_x, max_y = 0, 0
    
    # Threshold for "black" (adjust if needed)
    black_threshold = 30
    
    # Sample pixels for performance (check every Nth pixel)
    sample_rate = max(1, min(width, height) // 500)
    
    for y in range(0, height, sample_rate):
        for x in range(0, width, sample_rate):
            if pixels[x, y] > black_threshold:
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    
    # If no content found, return full image bounds
    if min_x >= width or min_y >= height:
        return (0, 0, width, height)
    
    # Add small padding
    padding = 10
    min_x = max(0, min_x - padding)
    min_y = max(0, min_y - padding)
    max_x = min(width, max_x + padding)
    max_y = min(height, max_y + padding)
    
    return (min_x, min_y, max_x, max_y)

def add_computer_frame(img, bezel_width=50, bezel_color=(35, 35, 35)):
    """Add a realistic computer screen frame around the image."""
    width, height = img.size
    
    # Create frame dimensions with thicker bottom bezel (like real monitors)
    top_bezel = bezel_width
    side_bezel = bezel_width
    bottom_bezel = bezel_width + 20  # Thicker bottom
    
    frame_width = width + (side_bezel * 2)
    frame_height = height + top_bezel + bottom_bezel
    
    # Create base frame
    frame = Image.new('RGB', (frame_width, frame_height), bezel_color)
    draw = ImageDraw.Draw(frame)
    
    # Outer bezel (darker, like monitor casing)
    outer_color = tuple(max(0, c - 20) for c in bezel_color)
    draw.rectangle([0, 0, frame_width, frame_height], fill=outer_color)
    
    # Inner bezel (slightly lighter) for depth
    inner_rect = [side_bezel - 3, top_bezel - 3, 
                  frame_width - side_bezel + 3, frame_height - bottom_bezel + 3]
    draw.rectangle(inner_rect, fill=bezel_color)
    
    # Add subtle highlight at top of screen (like a real monitor's screen edge)
    highlight_y = top_bezel + 2
    highlight_height = 2
    highlight_color = tuple(min(255, c + 25) for c in bezel_color)
    draw.rectangle([side_bezel, highlight_y, 
                    frame_width - side_bezel, highlight_y + highlight_height], 
                   fill=highlight_color)
    
    # Add subtle shadow at bottom of screen
    shadow_y = frame_height - bottom_bezel - 2
    shadow_height = 2
    shadow_color = tuple(max(0, c - 10) for c in bezel_color)
    draw.rectangle([side_bezel, shadow_y, 
                    frame_width - side_bezel, shadow_y + shadow_height], 
                   fill=shadow_color)
    
    # Add rounded corners effect (subtle)
    corner_radius = 8
    # Top-left corner
    draw.ellipse([0, 0, corner_radius * 2, corner_radius * 2], fill=outer_color)
    # Top-right corner
    draw.ellipse([frame_width - corner_radius * 2, 0, frame_width, corner_radius * 2], fill=outer_color)
    # Bottom-left corner
    draw.ellipse([0, frame_height - corner_radius * 2, corner_radius * 2, frame_height], fill=outer_color)
    # Bottom-right corner
    draw.ellipse([frame_width - corner_radius * 2, frame_height - corner_radius * 2, frame_width, frame_height], fill=outer_color)
    
    # Paste the original image in the center
    frame.paste(img, (side_bezel, top_bezel))
    
    return frame

def process_screenshot(input_path, output_path=None, manual_bounds=None, crop_top=0):
    """Process a screenshot: crop and add computer frame.
    
    Args:
        input_path: Path to input image
        output_path: Path to save processed image (optional)
        manual_bounds: Optional tuple (x1, y1, x2, y2) for manual cropping
        crop_top: Number of pixels to crop from the top (default: 0)
    """
    if not os.path.exists(input_path):
        print(f"Error: File not found: {input_path}")
        return False
    
    # Check file size
    file_size = os.path.getsize(input_path)
    if file_size == 0:
        print(f"Error: Image file is empty (0 bytes): {input_path}")
        print("Please provide a valid image file.")
        return False
    
    # Load image
    print(f"Loading image: {input_path}")
    try:
        img = Image.open(input_path)
        # Convert to RGB if necessary (handles RGBA, P mode, etc.)
        if img.mode != 'RGB':
            print(f"Converting from {img.mode} to RGB...")
            rgb_img = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'RGBA':
                rgb_img.paste(img, mask=img.split()[3])  # Use alpha channel as mask
            else:
                rgb_img.paste(img)
            img = rgb_img
    except Exception as e:
        print(f"Error loading image: {e}")
        return False
    
    original_size = img.size
    print(f"Original size: {original_size[0]}x{original_size[1]}")
    
    # Crop top portion first (browser tab bar and notification)
    if crop_top > 0:
        if crop_top >= original_size[1]:
            print(f"Warning: crop_top ({crop_top}) >= image height ({original_size[1]}), skipping top crop")
        else:
            print(f"Cropping {crop_top} pixels from top...")
            img = img.crop((0, crop_top, original_size[0], original_size[1]))
            print(f"After top crop: {img.size[0]}x{img.size[1]}")
    
    # Find content bounds and crop
    if manual_bounds:
        print(f"Using manual crop bounds: {manual_bounds}")
        # Adjust manual bounds if we already cropped the top
        adjusted_bounds = (manual_bounds[0], max(0, manual_bounds[1] - crop_top), 
                          manual_bounds[2], max(0, manual_bounds[3] - crop_top))
        bounds = adjusted_bounds
    else:
        print("Detecting content bounds...")
        bounds = find_content_bounds(img)
        print(f"Detected content bounds: {bounds}")
    
    if bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
        print("Warning: Invalid bounds detected, using full image")
        cropped = img
    else:
        cropped = img.crop(bounds)
        print(f"Cropped size: {cropped.size[0]}x{cropped.size[1]}")
    
    # Add computer frame
    print("Adding computer screen frame...")
    framed = add_computer_frame(cropped)
    print(f"Final size: {framed.size[0]}x{framed.size[1]}")
    
    # Save result
    if output_path is None:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_processed{ext}"
    
    framed.save(output_path, quality=95, optimize=True)
    print(f"✅ Saved processed image: {output_path}")
    
    return True

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python process_screenshot.py <input_image> [output_image] [--crop-top PIXELS] [x1 y1 x2 y2]")
        print("\nOptions:")
        print("  --crop-top PIXELS    Crop N pixels from the top (removes browser bar/notifications)")
        print("\nExamples:")
        print("  # Auto-detect and crop with top crop:")
        print("  python process_screenshot.py screenshot.png output.png --crop-top 100")
        print("\n  # Manual crop bounds (x1, y1, x2, y2) with top crop:")
        print("  python process_screenshot.py screenshot.png output.png --crop-top 100 0 0 1800 1000")
        print("\n  # Just top crop, auto-detect rest:")
        print("  python process_screenshot.py screenshot.png output.png --crop-top 120")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = None
    crop_top = 0
    manual_bounds = None
    
    # Parse arguments - simpler approach
    args = sys.argv[2:]
    
    # Look for --crop-top flag
    if '--crop-top' in args:
        idx = args.index('--crop-top')
        if idx + 1 < len(args):
            try:
                crop_top = int(args[idx + 1])
                # Remove the flag and value from args
                args = args[:idx] + args[idx + 2:]
            except ValueError:
                print(f"Error: --crop-top requires a number")
                sys.exit(1)
        else:
            print("Error: --crop-top requires a value")
            sys.exit(1)
    
    # Remaining args: first is output path (if not empty), rest might be manual bounds
    if len(args) > 0:
        # Check if first arg looks like output path (has extension or is not all digits)
        if not args[0].replace('.', '').replace('-', '').isdigit() or '.' in args[0]:
            output_path = args[0]
            args = args[1:]
        
        # If 4 numbers remain, they're manual bounds
        if len(args) >= 4:
            try:
                manual_bounds = tuple(int(args[i]) for i in range(4))
            except ValueError:
                print("Warning: Invalid manual bounds format, ignoring")
    
    success = process_screenshot(input_path, output_path, manual_bounds, crop_top)
    sys.exit(0 if success else 1)

