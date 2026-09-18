/**
 * Shared contracts between apps/web and apps/api.
 * Keep in sync with backend Zod schemas. No Node-only imports here.
 */

export type AccountStatus =
  | 'CONNECTING'
  | 'QR_REQUIRED'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'LOGGED_OUT'
  | 'ERROR';

export type UploadStatus =
  | 'QUEUED'
  | 'VALIDATING'
  | 'PROCESSING'
  | 'PUBLISHING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED';

export interface WhatsAppAccountDTO {
  id: string;
  name: string;
  phoneNumber: string | null;
  status: AccountStatus;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadDTO {
  id: string;
  accountId: string;
  accountName?: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  status: UploadStatus;
  errorMessage: string | null;
  errorCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const ACCOUNT_STATUSES: AccountStatus[] = [
  'CONNECTING',
  'QR_REQUIRED',
  'CONNECTED',
  'DISCONNECTED',
  'LOGGED_OUT',
  'ERROR',
];

export const UPLOAD_STATUSES: UploadStatus[] = [
  'QUEUED',
  'VALIDATING',
  'PROCESSING',
  'PUBLISHING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
];
