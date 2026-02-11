import fs from 'fs';
import path from 'path';
import { Skill, ToolDefinition } from '../../types.js';
import { config } from '../../config/config.js';

// Constants
const INBOX = '_Inbox';
const WORKSPACE = '_Workspace';
const LIBRARY = '_Library';
const SYSTEM = '_System';
const INDEX_FILE = 'index.json';
const CATALOG_FILE = 'CATALOG.md';

interface IndexEntry {
  path: string; // Relative to LIBRARY
  name: string;
  size: number;
  mtime: string; // ISO string
  type: 'file' | 'directory';
}

export class LibrarianSkill implements Skill {
  readonly id = 'librarian';
  readonly name = 'Librarian';
  readonly description = 'Manages the digital library system: _Inbox (new files), _Library (archive), _Workspace (active projects), and _System (indices).';
  private watcherInterval: NodeJS.Timeout | null = null;
  private lastInboxCount = 0;
  private root: string;

  constructor() {
    this.root = config.drive.root.trim() || '/app/drive';
    // Ensure structure on initialization
    this.ensureStructure();
    // Start background watcher
    this.startWatcher();
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'lib_init',
        description: 'Initialize or verify the library folder structure (_Inbox, _Library, _Workspace, _System).',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'lib_inbox_check',
        description: 'Check _Inbox for new files. Returns list of files waiting to be organized.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'lib_organize',
        description: 'Move a file from _Inbox to a destination in _Library or _Workspace. Automatically updates the index.',
        parameters: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: 'Name of the file in _Inbox' },
            destination: { type: 'string', description: 'Relative path in _Library (e.g. "IT/Python") or "_Workspace/ProjectX"' },
          },
          required: ['filename', 'destination'],
        },
      },
      {
        name: 'lib_search',
        description: 'Search the library index for files matching a query.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term (filename or path)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'lib_tree',
        description: 'Show the directory structure of _Library to understand organization.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Sub-path in _Library (optional)' },
            depth: { type: 'number', description: 'Depth limit (default 2)' },
          },
        },
      },
      {
        name: 'lib_index_rebuild',
        description: 'Force a full rebuild of the library index (index.json and CATALOG.md).',
        parameters: { type: 'object', properties: {} },
      },
    ];
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    try {
      switch (toolName) {
        case 'lib_init':
          return this.ensureStructure();
        case 'lib_inbox_check':
          return this.checkInbox(true);
        case 'lib_organize': {
          const filename = String(args.filename || '');
          const destination = String(args.destination || '');
          if (!filename || !destination) return 'Error: filename and destination are required.';
          return await this.organizeFile(filename, destination);
        }
        case 'lib_search':
          return this.searchIndex(String(args.query || ''));
        case 'lib_tree': {
          const p = String(args.path || '');
          const d = typeof args.depth === 'number' ? args.depth : 2;
          return this.getTree(p, d);
        }
        case 'lib_index_rebuild':
          return await this.rebuildIndex();
        default:
          return `Unknown tool: ${toolName}`;
      }
    } catch (err) {
      return `Librarian Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // --- Core Logic ---

  private ensureStructure(): string {
    const created: string[] = [];
    [INBOX, WORKSPACE, LIBRARY, SYSTEM].forEach(dir => {
      const p = path.join(this.root, dir);
      if (!fs.existsSync(p)) {
        fs.mkdirSync(p, { recursive: true });
        created.push(dir);
      }
    });

    // Ensure index exists
    const indexPath = path.join(this.root, SYSTEM, INDEX_FILE);
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(indexPath, '[]');
      created.push(`${SYSTEM}/${INDEX_FILE}`);
    }

    return created.length > 0
      ? `Created: ${created.join(', ')}`
      : 'Structure is intact.';
  }

  private startWatcher() {
    // Check every 60 seconds
    if (this.watcherInterval) clearInterval(this.watcherInterval);

    // Initial check
    this.lastInboxCount = this.getInboxCount();

    this.watcherInterval = setInterval(() => {
      const count = this.getInboxCount();
      if (count > this.lastInboxCount) {
        console.log(`[Librarian] 🔔 New files detected in _Inbox! Count: ${count}`);
      }
      this.lastInboxCount = count;
    }, 60000);
  }

  private getInboxCount(): number {
    const p = path.join(this.root, INBOX);
    if (!fs.existsSync(p)) return 0;
    try {
      return fs.readdirSync(p).filter(f => !f.startsWith('.')).length;
    } catch (e) {
      return 0;
    }
  }

  private checkInbox(verbose = false): string {
    const p = path.join(this.root, INBOX);
    if (!fs.existsSync(p)) return 'Inbox is empty (directory missing).';
    const files = fs.readdirSync(p).filter(f => !f.startsWith('.'));
    if (files.length === 0) return 'Inbox is empty.';
    return `Found ${files.length} files in _Inbox:\n${files.join('\n')}`;
  }

  private async organizeFile(filename: string, destination: string): Promise<string> {
    const src = path.join(this.root, INBOX, filename);

    // Handle special destination "_Workspace/..."
    let destRoot = LIBRARY;
    let destRel = destination;

    // Check if user specified root explicitly
    if (destination.startsWith(WORKSPACE) || destination.startsWith('/' + WORKSPACE)) {
        destRoot = ''; // Root relative
        destRel = destination.startsWith('/') ? destination.slice(1) : destination;
    } else if (destination.startsWith(LIBRARY) || destination.startsWith('/' + LIBRARY)) {
        destRoot = '';
        destRel = destination.startsWith('/') ? destination.slice(1) : destination;
    } else {
        // Default to Library if not specified
        destRoot = LIBRARY;
    }

    const destDir = path.join(this.root, destRoot, destRel);
    // Determine target path
    // If destination ends in separator or is an existing dir, treat as dir

    let targetPath = destDir;
    let isDir = destDir.endsWith(path.sep);

    if (!isDir) {
        // Simple heuristic: if it has an extension, it's a file. If not, it's a dir.
        if (!path.extname(destDir)) {
             isDir = true;
        }
    }

    if (isDir) {
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        targetPath = path.join(destDir, filename);
    } else {
        const parent = path.dirname(destDir);
        if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    }

    if (!fs.existsSync(src)) return `Error: File '${filename}' not found in _Inbox.`;

    fs.renameSync(src, targetPath);

    // Update Index (only if in Library)
    if (targetPath.includes('/' + LIBRARY + '/')) {
        await this.rebuildIndex();
    }

    const relDest = path.relative(this.root, targetPath);
    return `Moved '${filename}' to '${relDest}'. Index updated.`;
  }

  private async rebuildIndex(): Promise<string> {
    const libraryPath = path.join(this.root, LIBRARY);
    const index: IndexEntry[] = [];

    // Helper to scan recursively
    const scan = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.name.startsWith('.')) continue; // Skip hidden

        const fullPath = path.join(dir, ent.name);

        if (ent.isDirectory()) {
          scan(fullPath);
        } else {
          const stats = fs.statSync(fullPath);
          const relPath = path.relative(libraryPath, fullPath);
          index.push({
            path: relPath,
            name: ent.name,
            size: stats.size,
            mtime: stats.mtime.toISOString(),
            type: 'file'
          });
        }
      }
    };

    scan(libraryPath);

    // Write JSON Index
    const jsonPath = path.join(this.root, SYSTEM, INDEX_FILE);
    fs.writeFileSync(jsonPath, JSON.stringify(index, null, 2));

    // Write Human Readable Catalog
    const catalogPath = path.join(this.root, SYSTEM, CATALOG_FILE);
    // Group by directory for readability
    const byDir: Record<string, IndexEntry[]> = {};
    for (const item of index) {
        const dir = path.dirname(item.path);
        if (!byDir[dir]) byDir[dir] = [];
        byDir[dir].push(item);
    }

    let md = `# Library Catalog\n\nGenerated: ${new Date().toLocaleString()}\nTotal Files: ${index.length}\n\n`;

    for (const [dir, items] of Object.entries(byDir).sort()) {
        md += `## /${dir === '.' ? '' : dir}\n`;
        for (const item of items) {
            md += `- **${item.name}** (${(item.size / 1024).toFixed(1)} KB)\n`;
        }
        md += '\n';
    }

    fs.writeFileSync(catalogPath, md);

    return `Index rebuilt. ${index.length} items indexed.`;
  }

  private searchIndex(query: string): string {
    const jsonPath = path.join(this.root, SYSTEM, INDEX_FILE);
    if (!fs.existsSync(jsonPath)) return 'Index not found. Run lib_index_rebuild first.';

    try {
      const content = fs.readFileSync(jsonPath, 'utf-8');
      const index: IndexEntry[] = JSON.parse(content || '[]');
      const q = query.toLowerCase();

      const results = index.filter(i =>
          i.name.toLowerCase().includes(q) ||
          i.path.toLowerCase().includes(q)
      );

      if (results.length === 0) return 'No matches found.';

      const out = results.slice(0, 10).map(r => `- ${r.path} (${(r.size / 1024).toFixed(1)} KB)`);
      if (results.length > 10) out.push(`...and ${results.length - 10} more.`);

      return `Found ${results.length} matches:\n` + out.join('\n');
    } catch (e) {
      return `Error reading index file: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private getTree(subPath: string, depth: number): string {
     const startDir = path.join(this.root, LIBRARY, subPath);
     if (!fs.existsSync(startDir)) return `Path not found: ${subPath}`;

     const lines: string[] = [];

     const traverse = (current: string, currentDepth: number, prefix: string) => {
         if (currentDepth > depth) return;

         let entries: fs.Dirent[] = [];
         try {
             entries = fs.readdirSync(current, { withFileTypes: true }).filter(e => !e.name.startsWith('.'));
         } catch (e) {
             lines.push(`${prefix} (Error reading dir)`);
             return;
         }

         entries.forEach((ent, i) => {
             const isLast = i === entries.length - 1;
             const marker = isLast ? '└── ' : '├── ';
             lines.push(`${prefix}${marker}${ent.name}`);

             if (ent.isDirectory()) {
                 traverse(path.join(current, ent.name), currentDepth + 1, prefix + (isLast ? '    ' : '│   '));
             }
         });
     };

     lines.push(subPath || '/');
     traverse(startDir, 1, '');
     return lines.join('\n');
  }
}
