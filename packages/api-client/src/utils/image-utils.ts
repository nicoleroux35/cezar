/**
 * Image and media type utilities shared between client and server.
 */

/**
 * Check if a media type represents an image.
 */
export function isImageMediaType(mediaType: string): boolean {
  return mediaType.startsWith('image/');
}

/**
 * Check if a file name represents an image based on its extension.
 */
export function isImageAttachmentName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext ? ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext) : false;
}

/**
 * Check if a media type is a valid attachment type.
 */
export function isAttachmentMediaType(mediaType: string): boolean {
  // Accept images and common document types
  return mediaType.startsWith('image/') ||
         mediaType.startsWith('text/') ||
         mediaType === 'application/pdf' ||
         mediaType === 'application/json';
}

/**
 * Get the file extension from an attachment name.
 */
export function attachmentExtension(name: string): string | undefined {
  return name.split('.').pop()?.toLowerCase();
}

/**
 * Convert a base64 data URL to an image block for the API.
 */
export function toBase64ImageBlock(dataUrl: string): { type: 'image'; source: { type: 'base64'; media_type: string; data: string } } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid data URL format');
  }

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: match[1],
      data: match[2],
    },
  };
}

/**
 * Check if a string is a base64 data URL.
 */
export function isDataUrl(str: string): boolean {
  return /^data:[^;]+;base64,/.test(str);
}
