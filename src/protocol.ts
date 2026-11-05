import type { Conversation, ExportOptions, Format, Message } from './model';
export type Header = { conversation: Omit<Conversation, 'messages'>; options: ExportOptions; format: Format };
export type PreviewRequest = { type: 'open-preview'; token: string } |
  { type: 'close-preview'; token: string; tabId: number };
export type FromContent =
  | { type: 'header'; header: Header }
  | { type: 'message'; message: Message }
  | { type: 'ready' }
  | { type: 'media'; id: string; data?: string };
export type FromPreview = { type: 'read-media'; id: string; url: string } | { type: 'cancel-media'; id: string };
