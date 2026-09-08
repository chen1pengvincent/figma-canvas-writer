// Shared product limits. Pure JS, no Node/Figma dependencies: imported by the
// Node bridge directly and bundled into the Figma plugin.
export const LIMITS = {
  FRAME_BYTES: 256 * 1024,
  STDIO_BYTES: 1024 * 1024,
  CHUNK_RAW_BYTES: 64 * 1024,
  RESOURCE_BYTES: 16 * 1024 * 1024,
  CONCURRENT_TRANSFERS: 2,
  UNACKED_CHUNKS: 4,
  STAGING_BYTES: 64 * 1024 * 1024,
  TRANSFER_IDLE_MS: 30000,
  TRANSFER_TOTAL_MS: 120000,
  BITMAP_PIXELS: 16777216,
  PREVIEW_LONG_EDGE: 1600,
  PREVIEW_LONG_EDGE_MAX: 8192,
  QUERY_PAGE_IDS: 100,
  ACTIVE_HANDLES: 16,
  HANDLE_MEMBER_IDS: 10000,
  HANDLE_BUDGET_BYTES: 8 * 1024 * 1024,
  HANDLE_TTL_MS: 120000,
  BATCH_STEPS: 50,
  OPERATION_RECORDS: 1000,
  OPERATION_RECORD_BYTES: 8 * 1024 * 1024,
  PENDING_REQUESTS: 100,
  PENDING_CONTROL_RESERVED: 8,
  INLINE_PREVIEW_BYTES: 128 * 1024,
  TEXT_CHUNK_CHARS: 16000,
};

// Commands that move page context or touch host files never run inside a batch.
export const BATCH_EXCLUDED_COMMANDS = new Set([
  'managePage', 'exportAsset', 'importAsset', 'exportVideo', 'batch', 'getOperation', 'getCapabilities',
]);

// Control commands that must never be starved by business work or transfers.
export const CONTROL_COMMANDS = new Set(['ping', 'getOperation', 'getCapabilities']);

// pageRevision/context fields shared by bridge, plugin main and plugin UI.
export const CONTEXT_KEYS = ['sessionId', 'runId', 'pageId', 'pageName', 'fileName', 'editorType', 'pageRevision'];
export const CONTEXT_OPTIONAL_KEYS = ['fileKey'];
export const EDITOR_TYPES = ['figma', 'figjam', 'slides'];
