/** Convert a grayscale RGBA image (depth map) to a normal-mapped RGBA image. */
export function normalsFromDepth(src, width, height, opts = {}) {
    const strength = opts.strength ?? 1.0;
    const invert = opts.invert ?? false;
    // sample depth as luminance, normalized to [0,1]
    const depth = new Float32Array(width * height);
    for (let i = 0, j = 0; i < depth.length; i++, j += 4) {
        const v = 0.299 * src[j] + 0.587 * src[j + 1] + 0.114 * src[j + 2];
        depth[i] = invert ? 1 - v / 255 : v / 255;
    }
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const cl = x === 0 ? 0 : x - 1;
            const cr = x === width - 1 ? width - 1 : x + 1;
            const cu = y === 0 ? 0 : y - 1;
            const cd = y === height - 1 ? height - 1 : y + 1;
            // central differences
            const dx = (depth[y * width + cr] - depth[y * width + cl]) * strength;
            const dy = (depth[cd * width + x] - depth[cu * width + x]) * strength;
            // n = normalize(-dx, -dy, 1)
            let nx = -dx;
            let ny = -dy;
            let nz = 1;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx /= len;
            ny /= len;
            nz /= len;
            // map [-1,1] → [0,255]
            out[idx * 4] = Math.round((nx * 0.5 + 0.5) * 255);
            out[idx * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
            out[idx * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
            out[idx * 4 + 3] = 255;
        }
    }
    return out;
}
