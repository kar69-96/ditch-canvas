/**
 * Smart Module Organizer
 * Uses Gemini API to intelligently organize pages, files, and existing modules into structured course modules
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

interface ContentItem {
  id: string;
  type: 'page' | 'file' | 'module';
  title: string;
  folderPath?: string;
  position?: number;
  url?: string;
}

interface OrganizedModule {
  name: string;
  position: number;
  items: Array<{
    id: string;
    type: 'page' | 'file';
    title: string;
    originalType: string;
  }>;
}

/**
 * Organize course content into modules using Gemini API
 */
export async function organizeContentIntoModules(
  courseName: string,
  courseCode: string,
  pages: Array<{ id: number; title: string; url?: string }>,
  files: Array<{ id: number; fileName: string; folder?: string; url?: string }>,
  existingModules: Array<{ id: number; name: string; position: number }>
): Promise<OrganizedModule[]> {
  // Check if Gemini API key is available
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  
  if (!apiKey) {
    console.warn('[moduleOrganizer] No Gemini API key found, using fallback organization');
    return organizeContentFallback(courseName, pages, files, existingModules);
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    // Prepare content for analysis
    const contentItems: ContentItem[] = [
      ...pages.map(p => ({
        id: `page-${p.id}`,
        type: 'page' as const,
        title: p.title,
        url: p.url,
      })),
      ...files.map(f => ({
        id: `file-${f.id}`,
        type: 'file' as const,
        title: f.fileName,
        folderPath: f.folder,
        url: f.url,
      })),
    ];

    // Build prompt for Gemini
    const prompt = `You are organizing course content for "${courseCode}: ${courseName}".

Existing modules (if any):
${existingModules.map(m => `- ${m.name} (position: ${m.position})`).join('\n') || 'None'}

Available content to organize:
${contentItems.map((item, idx) => 
  `${idx + 1}. [${item.type.toUpperCase()}] ${item.title}${item.folderPath ? ` (folder: ${item.folderPath})` : ''}`
).join('\n')}

Please organize this content into logical modules (e.g., by week, topic, or chapter). Consider:
1. File folder paths that might indicate module structure
2. Page titles that might reference weeks or topics
3. Existing module names for consistency
4. Logical grouping by subject matter

Return a JSON array of modules in this exact format:
[
  {
    "name": "Module Name",
    "position": 1,
    "items": [
      {
        "id": "page-123 or file-456",
        "type": "page or file",
        "title": "Item Title",
        "originalType": "page or file"
      }
    ]
  }
]

Only include items that exist in the provided content list. Use clear, descriptive module names.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Extract JSON from response (might have markdown code blocks)
    let jsonText = text.trim();
    if (jsonText.includes('```json')) {
      jsonText = jsonText.split('```json')[1].split('```')[0].trim();
    } else if (jsonText.includes('```')) {
      jsonText = jsonText.split('```')[1].split('```')[0].trim();
    }

    const organizedModules: OrganizedModule[] = JSON.parse(jsonText);

    // Validate and filter to only include items that actually exist
    const validItemIds = new Set(contentItems.map(item => item.id));
    const validatedModules = organizedModules
      .map(module => ({
        ...module,
        items: module.items.filter(item => validItemIds.has(item.id)),
      }))
      .filter(module => module.items.length > 0);

    console.log('[moduleOrganizer] Successfully organized content into', validatedModules.length, 'modules');
    return validatedModules;
  } catch (error) {
    console.error('[moduleOrganizer] Error using Gemini API:', error);
    console.log('[moduleOrganizer] Falling back to rule-based organization');
    return organizeContentFallback(courseName, pages, files, existingModules);
  }
}

/**
 * Fallback organization using rule-based logic
 */
function organizeContentFallback(
  courseName: string,
  pages: Array<{ id: number; title: string; url?: string }>,
  files: Array<{ id: number; fileName: string; folder?: string; url?: string }>,
  existingModules: Array<{ id: number; name: string; position: number }>
): OrganizedModule[] {
  const modules: OrganizedModule[] = [];

  // Group files by folder path
  const filesByFolder = new Map<string, Array<{ id: number; fileName: string; url?: string }>>();
  files.forEach(file => {
    const folder = file.folder || 'Uncategorized';
    if (!filesByFolder.has(folder)) {
      filesByFolder.set(folder, []);
    }
    filesByFolder.get(folder)!.push({
      id: file.id,
      fileName: file.fileName,
      url: file.url,
    });
  });

  // Create modules from folder structure
  let position = 1;
  filesByFolder.forEach((folderFiles, folderName) => {
    if (folderName !== 'Uncategorized' && folderFiles.length > 0) {
      modules.push({
        name: folderName,
        position: position++,
        items: folderFiles.map(file => ({
          id: `file-${file.id}`,
          type: 'file' as const,
          title: file.fileName,
          originalType: 'file',
        })),
      });
    }
  });

  // Group pages by week/topic patterns
  const weekPattern = /week\s*(\d+)|week\s*(\d+)\s*[-:]|(\d+)\s*week/i;
  const pagesByWeek = new Map<string, Array<{ id: number; title: string; url?: string }>>();

  pages.forEach(page => {
    const weekMatch = page.title.match(weekPattern);
    if (weekMatch) {
      const weekNum = weekMatch[1] || weekMatch[2] || weekMatch[3];
      const weekKey = `Week ${weekNum}`;
      if (!pagesByWeek.has(weekKey)) {
        pagesByWeek.set(weekKey, []);
      }
      pagesByWeek.get(weekKey)!.push(page);
    } else {
      // Group uncategorized pages
      if (!pagesByWeek.has('Other Content')) {
        pagesByWeek.set('Other Content', []);
      }
      pagesByWeek.get('Other Content')!.push(page);
    }
  });

  // Add page modules
  pagesByWeek.forEach((weekPages, weekName) => {
    if (weekPages.length > 0) {
      modules.push({
        name: weekName,
        position: position++,
        items: weekPages.map(page => ({
          id: `page-${page.id}`,
          type: 'page' as const,
          title: page.title,
          originalType: 'page',
        })),
      });
    }
  });

  // Add uncategorized files if any
  const uncategorizedFiles = filesByFolder.get('Uncategorized') || [];
  if (uncategorizedFiles.length > 0) {
    modules.push({
      name: 'Course Materials',
      position: position++,
      items: uncategorizedFiles.map(file => ({
        id: `file-${file.id}`,
        type: 'file' as const,
        title: file.fileName,
        originalType: 'file',
      })),
    });
  }

  // Sort modules by position
  modules.sort((a, b) => a.position - b.position);

  return modules;
}



