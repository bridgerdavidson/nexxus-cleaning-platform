export type UploadKind = 'avatar' | 'job-photo' | 'property' | 'message';

export type UploadStatus =
  | 'queued'
  | 'converting'
  | 'compressing'
  | 'uploading'
  | 'done'
  | 'failed';

export interface UploadItem {
  id: string;            // client-side uuid for keying UI rows
  file: File;            // the original file the user picked
  status: UploadStatus;
  attempt: 0 | 1;        // 0 = first try, 1 = retry
  url?: string;          // public URL once uploaded
  rowId?: string;        // DB row id once written
  error?: string;        // user-facing error if failed
}

export interface AvatarContext {
  userId: string;
  currentAvatarUrl?: string | null;
}

export interface JobPhotoContext {
  appointmentId: string;
  photoType: 'before' | 'after' | 'during';
}

export interface PropertyContext {
  propertyId: string;
  currentPhotoUrl?: string | null;
}

export interface MessageContext {
  conversationId: string;
  messageId: string;
}

export type UploadContext =
  | { kind: 'avatar'; ctx: AvatarContext }
  | { kind: 'job-photo'; ctx: JobPhotoContext }
  | { kind: 'property'; ctx: PropertyContext }
  | { kind: 'message'; ctx: MessageContext };

export interface UploadSuccess {
  id: string;
  url: string;
  rowId?: string;
}

export interface UploadFailure {
  id: string;
  fileName: string;
  message: string;
}

export interface UploadCompleteSummary {
  uploaded: UploadSuccess[];
  failed: UploadFailure[];
}
