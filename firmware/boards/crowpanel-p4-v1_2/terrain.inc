// Included inside map.cpp so the development benchmark uses the production map
// projection, palette, overlays and framebuffer. The normal build omits this code.
extern "C" const uint8_t streams[] asm("_binary_terrain_tiles_start");
extern "C" const uint8_t streamsEnd[] asm("_binary_terrain_tiles_end");
struct TileScratch {
    tinfl_decompressor decoder;
    uint8_t pixels[128 * 128];
};
TileScratch *scratch;
bool tileError;
unsigned decoded;
uint32_t little32(const uint8_t *p) {
    return p[0] | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24;
}
bool drawTiles(const int *columns, const int *rows, const uint16_t *palette) {
    constexpr int across = (rasterW + 127) / 128, down = (rasterH + 127) / 128, indexSize = across * down * 8;
    const size_t payload = size_t(streamsEnd - streams) - indexSize;
    for (int y = top; y < bottom;) {
        int ty = rows[y] / rasterW / 128, y2 = y + 1;
        while (y2 < bottom && rows[y2] / rasterW / 128 == ty)
            ++y2;
        for (int x = 0; x < W;) {
            int tx = columns[x] / 128, x2 = x + 1;
            while (x2 < W && columns[x2] / 128 == tx)
                ++x2;
            int stride = std::min(128, rasterW - tx * 128);
            size_t bytes = stride * std::min(128, rasterH - ty * 128);
            const uint8_t *entry = streams + (ty * across + tx) * 8;
            size_t pos = little32(entry), length = little32(entry + 4), used = length, written = bytes;
            if (pos > payload || length > payload - pos)
                return false;
            tinfl_init(&scratch->decoder);
            auto rc = tinfl_decompress(
                &scratch->decoder, streams + indexSize + pos, &used, scratch->pixels, scratch->pixels,
                &written, TINFL_FLAG_PARSE_ZLIB_HEADER | TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF);
            if (rc != TINFL_STATUS_DONE || used != length || written != bytes)
                return false;
            ++decoded;
            // Consecutive writes along physical scan lines in both orientations.
            if (portrait) {
                for (int col = x; col < x2; ++col) {
                    auto dst = pixels + offset(col, y2 - 1);
                    for (int row = y2 - 1; row >= y; --row)
                        *dst++ = palette[scratch->pixels[((rows[row] / rasterW) % 128) * stride +
                                                         columns[col] % 128]];
                }
            } else {
                for (int row = y; row < y2; ++row) {
                    auto src = scratch->pixels + ((rows[row] / rasterW) % 128) * stride;
                    for (int col = x; col < x2; ++col)
                        pixels[offset(col, row)] = palette[src[columns[col] % 128]];
                }
            }
            x = x2;
        }
        y = y2;
    }
    return true;
}
