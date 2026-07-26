export type WebCodexThreadMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string | null;
  failed?: boolean;
  pending?: boolean;
  processPending?: boolean;
  processText?: string | null;
  source?: 'history' | 'local' | 'stream';
};
