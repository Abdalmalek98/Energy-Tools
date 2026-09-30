/** Page images live outside React state (large blobs), keyed by page id. */
export const images = new Map<string, Blob>();
export const getImage = (id: string) => images.get(id);
