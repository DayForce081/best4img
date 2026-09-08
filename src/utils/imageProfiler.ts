export type ImageType = 'graphic' | 'photo';

/**
 * Lightweight image profiler that draws a 64x64 thumbnail
 * to detect the number of unique 15-bit colors.
 * Returns 'graphic' if < 300 colors, else 'photo'.
 */
export async function profileImage(file: File): Promise<ImageType> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    
    img.onload = () => {
      // Create off-screen canvas explicitly with size 64x64
      const SIZE = 64;
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        URL.revokeObjectURL(url);
        return resolve('photo'); // fallback to safe default
      }
      
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
      const data = imageData.data;
      
      // Count unique 15-bit colors
      const colorSet = new Set<number>();
      for (let i = 0; i < data.length; i += 4) {
        // Skip fully transparent pixels to not skew color counts
        if (data[i + 3] === 0) continue;
        
        // Quantize 8-bit RGB to 5-bit RGB
        const r = data[i]! >> 3;
        const g = data[i + 1]! >> 3;
        const b = data[i + 2]! >> 3;
        
        // Combine into a 15-bit key
        const key = (r << 10) | (g << 5) | b;
        colorSet.add(key);
      }
      
      URL.revokeObjectURL(url);
      
      if (colorSet.size < 300) {
        resolve('graphic');
      } else {
        resolve('photo');
      }
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve('photo'); // Fallback to safe photo path handling
    };
    
    img.src = url;
  });
}
