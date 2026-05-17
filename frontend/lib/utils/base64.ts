// Decode a base64 string to an ArrayBuffer. Used by the image-upload paths
// to feed Supabase storage from the ImagePicker base64 output.

export function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
