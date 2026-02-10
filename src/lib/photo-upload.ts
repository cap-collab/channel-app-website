import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '@/lib/firebase';

export interface UploadPhotoResult {
  success: boolean;
  url?: string;
  error?: string;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * Validate a file before upload
 */
export function validatePhoto(file: File): { valid: boolean; error?: string } {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: 'Please upload a JPG, PNG, GIF, or WebP image' };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: 'Image must be less than 5MB' };
  }
  return { valid: true };
}

/**
 * Upload a DJ profile photo to Firebase Storage
 */
export async function uploadDJPhoto(userId: string, file: File): Promise<UploadPhotoResult> {
  if (!storage) {
    return { success: false, error: 'Storage not configured' };
  }

  // Validate file
  const validation = validatePhoto(file);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    // Generate filename with extension
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `profile.${ext}`;
    const photoRef = ref(storage, `dj-photos/${userId}/${filename}`);

    // Upload with metadata
    await uploadBytes(photoRef, file, {
      contentType: file.type,
      customMetadata: {
        uploadedAt: new Date().toISOString(),
      },
    });

    // Get download URL
    const url = await getDownloadURL(photoRef);
    return { success: true, url };
  } catch (error) {
    console.error('Photo upload failed:', error);
    return { success: false, error: 'Failed to upload photo. Please try again.' };
  }
}

/**
 * Upload a recommendation image to Firebase Storage
 */
export async function uploadRecImage(userId: string, recIndex: number, file: File): Promise<UploadPhotoResult> {
  if (!storage) {
    return { success: false, error: 'Storage not configured' };
  }

  const validation = validatePhoto(file);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `rec-${recIndex}.${ext}`;
    const photoRef = ref(storage, `dj-photos/${userId}/${filename}`);

    await uploadBytes(photoRef, file, {
      contentType: file.type,
      customMetadata: {
        uploadedAt: new Date().toISOString(),
      },
    });

    const url = await getDownloadURL(photoRef);
    return { success: true, url };
  } catch (error) {
    console.error('Rec image upload failed:', error);
    return { success: false, error: 'Failed to upload image. Please try again.' };
  }
}

/**
 * Upload a show image to Firebase Storage
 */
export async function uploadShowImage(slotId: string, file: File): Promise<UploadPhotoResult> {
  if (!storage) {
    return { success: false, error: 'Storage not configured' };
  }

  // Validate file
  const validation = validatePhoto(file);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    // Generate filename with extension
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `show-image.${ext}`;
    const photoRef = ref(storage, `show-images/${slotId}/${filename}`);

    // Upload with metadata
    await uploadBytes(photoRef, file, {
      contentType: file.type,
      customMetadata: {
        uploadedAt: new Date().toISOString(),
      },
    });

    // Get download URL
    const url = await getDownloadURL(photoRef);
    return { success: true, url };
  } catch (error) {
    console.error('Show image upload failed:', error);
    return { success: false, error: 'Failed to upload image. Please try again.' };
  }
}

/**
 * Delete a show image from Firebase Storage
 */
export async function deleteShowImage(slotId: string): Promise<boolean> {
  if (!storage) return false;

  try {
    // Try common extensions
    const extensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    for (const ext of extensions) {
      try {
        const photoRef = ref(storage, `show-images/${slotId}/show-image.${ext}`);
        await deleteObject(photoRef);
        return true;
      } catch {
        // Continue trying other extensions
      }
    }
    return false;
  } catch (error) {
    console.error('Show image delete failed:', error);
    return false;
  }
}

/**
 * Upload a pending DJ profile photo to Firebase Storage
 * Uses the pending profile ID instead of a userId
 */
export async function uploadPendingDJPhoto(profileId: string, file: File): Promise<UploadPhotoResult> {
  if (!storage) {
    return { success: false, error: 'Storage not configured' };
  }

  // Validate file
  const validation = validatePhoto(file);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    // Generate filename with extension
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `profile.${ext}`;
    const photoRef = ref(storage, `pending-dj-photos/${profileId}/${filename}`);

    // Upload with metadata
    await uploadBytes(photoRef, file, {
      contentType: file.type,
      customMetadata: {
        uploadedAt: new Date().toISOString(),
      },
    });

    // Get download URL
    const url = await getDownloadURL(photoRef);
    return { success: true, url };
  } catch (error) {
    console.error('Pending DJ photo upload failed:', error);
    return { success: false, error: 'Failed to upload photo. Please try again.' };
  }
}

/**
 * Delete a pending DJ profile photo from Firebase Storage
 */
export async function deletePendingDJPhoto(profileId: string, photoUrl: string): Promise<boolean> {
  if (!storage) return false;

  try {
    // Extract the filename from the URL
    const match = photoUrl.match(/pending-dj-photos%2F[^%]+%2F([^?]+)/);
    let filename = 'profile.jpg';

    if (match) {
      filename = decodeURIComponent(match[1]);
    } else {
      const altMatch = photoUrl.match(/pending-dj-photos\/[^/]+\/([^?]+)/);
      if (altMatch) {
        filename = altMatch[1];
      }
    }

    const photoRef = ref(storage, `pending-dj-photos/${profileId}/${filename}`);
    await deleteObject(photoRef);
    return true;
  } catch (error) {
    console.error('Pending DJ photo delete failed:', error);
    return false;
  }
}

/**
 * Delete a DJ profile photo from Firebase Storage
 */
export async function deleteDJPhoto(userId: string, photoUrl: string): Promise<boolean> {
  if (!storage) return false;

  try {
    // Extract the filename from the URL
    // URL format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/dj-photos%2F{userId}%2F{filename}?...
    const match = photoUrl.match(/dj-photos%2F[^%]+%2F([^?]+)/);
    let filename = 'profile.jpg';

    if (match) {
      filename = decodeURIComponent(match[1]);
    } else {
      // Try alternate URL format (non-encoded)
      const altMatch = photoUrl.match(/dj-photos\/[^/]+\/([^?]+)/);
      if (altMatch) {
        filename = altMatch[1];
      }
    }

    const photoRef = ref(storage, `dj-photos/${userId}/${filename}`);
    await deleteObject(photoRef);
    return true;
  } catch (error) {
    console.error('Photo delete failed:', error);
    return false;
  }
}
