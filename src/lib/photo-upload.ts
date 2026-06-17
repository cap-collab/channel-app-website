import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '@/lib/firebase';

export interface UploadPhotoResult {
  success: boolean;
  url?: string;
  error?: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Images are served raw (unoptimized) from Firebase Storage across the site,
// so we downscale + re-encode on upload to keep download weight small.
const MAX_DIMENSION = 1600; // longest edge, in px
const OUTPUT_QUALITY = 0.85;

/**
 * Validate a file before upload
 */
export function validatePhoto(file: File): { valid: boolean; error?: string } {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: 'Please upload a JPG, PNG, GIF, or WebP image' };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: 'Image must be less than 10MB' };
  }
  return { valid: true };
}

/**
 * Downscale (longest edge <= MAX_DIMENSION) and re-encode an image to WebP
 * before upload. Returns a `.webp` File. Animated GIFs and any browser without
 * canvas/toBlob support fall through to the original file unchanged.
 */
export async function processPhoto(file: File): Promise<File> {
  // GIFs are usually animated; canvas would flatten them to a single frame.
  if (file.type === 'image/gif') return file;
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', OUTPUT_QUALITY)
    );
    if (!blob) return file;

    // If processing somehow produced a larger file (e.g. tiny already-compressed
    // source), keep the original.
    if (blob.size >= file.size && scale === 1) return file;

    const baseName = file.name.replace(/\.[^/.]+$/, '') || 'image';
    return new File([blob], `${baseName}.webp`, { type: 'image/webp' });
  } catch (error) {
    console.error('Photo processing failed, uploading original:', error);
    return file;
  }
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
    const processed = await processPhoto(file);
    // Generate filename with extension
    const ext = processed.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `profile.${ext}`;
    const photoRef = ref(storage, `dj-photos/${userId}/${filename}`);

    // Upload with metadata
    await uploadBytes(photoRef, processed, {
      contentType: processed.type,
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
    const processed = await processPhoto(file);
    const ext = processed.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `rec-${recIndex}.${ext}`;
    const photoRef = ref(storage, `dj-photos/${userId}/${filename}`);

    await uploadBytes(photoRef, processed, {
      contentType: processed.type,
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
    const processed = await processPhoto(file);
    // Generate filename with extension
    const ext = processed.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `show-image.${ext}`;
    const photoRef = ref(storage, `show-images/${slotId}/${filename}`);

    // Upload with metadata
    await uploadBytes(photoRef, processed, {
      contentType: processed.type,
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
    const processed = await processPhoto(file);
    // Generate filename with extension
    const ext = processed.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `profile.${ext}`;
    const photoRef = ref(storage, `pending-dj-photos/${profileId}/${filename}`);

    // Upload with metadata
    await uploadBytes(photoRef, processed, {
      contentType: processed.type,
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
 * Upload a venue photo to Firebase Storage
 */
export async function uploadVenuePhoto(venueId: string, file: File): Promise<UploadPhotoResult> {
  if (!storage) {
    return { success: false, error: 'Storage not configured' };
  }

  const validation = validatePhoto(file);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const processed = await processPhoto(file);
    const ext = processed.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `photo.${ext}`;
    const photoRef = ref(storage, `venue-photos/${venueId}/${filename}`);

    await uploadBytes(photoRef, processed, {
      contentType: processed.type,
      customMetadata: {
        uploadedAt: new Date().toISOString(),
      },
    });

    const url = await getDownloadURL(photoRef);
    return { success: true, url };
  } catch (error) {
    console.error('Venue photo upload failed:', error);
    return { success: false, error: 'Failed to upload photo. Please try again.' };
  }
}

/**
 * Delete a venue photo from Firebase Storage
 */
export async function deleteVenuePhoto(venueId: string, photoUrl: string): Promise<boolean> {
  if (!storage) return false;

  try {
    const match = photoUrl.match(/venue-photos%2F[^%]+%2F([^?]+)/);
    let filename = 'photo.jpg';

    if (match) {
      filename = decodeURIComponent(match[1]);
    } else {
      const altMatch = photoUrl.match(/venue-photos\/[^/]+\/([^?]+)/);
      if (altMatch) {
        filename = altMatch[1];
      }
    }

    const photoRef = ref(storage, `venue-photos/${venueId}/${filename}`);
    await deleteObject(photoRef);
    return true;
  } catch (error) {
    console.error('Venue photo delete failed:', error);
    return false;
  }
}

/**
 * Upload a collective photo to Firebase Storage
 */
export async function uploadCollectivePhoto(collectiveId: string, file: File): Promise<UploadPhotoResult> {
  if (!storage) {
    return { success: false, error: 'Storage not configured' };
  }

  const validation = validatePhoto(file);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const processed = await processPhoto(file);
    const ext = processed.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `photo.${ext}`;
    const photoRef = ref(storage, `collective-photos/${collectiveId}/${filename}`);

    await uploadBytes(photoRef, processed, {
      contentType: processed.type,
      customMetadata: {
        uploadedAt: new Date().toISOString(),
      },
    });

    const url = await getDownloadURL(photoRef);
    return { success: true, url };
  } catch (error) {
    console.error('Collective photo upload failed:', error);
    return { success: false, error: 'Failed to upload photo. Please try again.' };
  }
}

/**
 * Delete a collective photo from Firebase Storage
 */
export async function deleteCollectivePhoto(collectiveId: string, photoUrl: string): Promise<boolean> {
  if (!storage) return false;

  try {
    const match = photoUrl.match(/collective-photos%2F[^%]+%2F([^?]+)/);
    let filename = 'photo.jpg';

    if (match) {
      filename = decodeURIComponent(match[1]);
    } else {
      const altMatch = photoUrl.match(/collective-photos\/[^/]+\/([^?]+)/);
      if (altMatch) {
        filename = altMatch[1];
      }
    }

    const photoRef = ref(storage, `collective-photos/${collectiveId}/${filename}`);
    await deleteObject(photoRef);
    return true;
  } catch (error) {
    console.error('Collective photo delete failed:', error);
    return false;
  }
}

/**
 * Upload an event photo to Firebase Storage
 */
export async function uploadEventPhoto(eventId: string, file: File): Promise<UploadPhotoResult> {
  if (!storage) {
    return { success: false, error: 'Storage not configured' };
  }

  const validation = validatePhoto(file);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const processed = await processPhoto(file);
    const ext = processed.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `photo.${ext}`;
    const photoRef = ref(storage, `event-photos/${eventId}/${filename}`);

    await uploadBytes(photoRef, processed, {
      contentType: processed.type,
      customMetadata: {
        uploadedAt: new Date().toISOString(),
      },
    });

    const url = await getDownloadURL(photoRef);
    return { success: true, url };
  } catch (error) {
    console.error('Event photo upload failed:', error);
    return { success: false, error: 'Failed to upload photo. Please try again.' };
  }
}

/**
 * Delete an event photo from Firebase Storage
 */
export async function deleteEventPhoto(eventId: string, photoUrl: string): Promise<boolean> {
  if (!storage) return false;

  try {
    const match = photoUrl.match(/event-photos%2F[^%]+%2F([^?]+)/);
    let filename = 'photo.jpg';

    if (match) {
      filename = decodeURIComponent(match[1]);
    } else {
      const altMatch = photoUrl.match(/event-photos\/[^/]+\/([^?]+)/);
      if (altMatch) {
        filename = altMatch[1];
      }
    }

    const photoRef = ref(storage, `event-photos/${eventId}/${filename}`);
    await deleteObject(photoRef);
    return true;
  } catch (error) {
    console.error('Event photo delete failed:', error);
    return false;
  }
}

/**
 * Upload an archive show image to Firebase Storage
 */
export async function uploadArchiveImage(archiveId: string, file: File): Promise<UploadPhotoResult> {
  if (!storage) {
    return { success: false, error: 'Storage not configured' };
  }

  const validation = validatePhoto(file);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const processed = await processPhoto(file);
    const ext = processed.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `archive-image.${ext}`;
    const photoRef = ref(storage, `show-images/${archiveId}/${filename}`);

    await uploadBytes(photoRef, processed, {
      contentType: processed.type,
      customMetadata: {
        uploadedAt: new Date().toISOString(),
      },
    });

    const url = await getDownloadURL(photoRef);
    return { success: true, url };
  } catch (error) {
    console.error('Archive image upload failed:', error);
    return { success: false, error: 'Failed to upload image. Please try again.' };
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
