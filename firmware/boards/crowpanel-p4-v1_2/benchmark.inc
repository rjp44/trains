// Only the temporary instrumented Lakes application calls these entry points.
void drawOverlay(uint16_t *target) {
    pixels = target;
    portrait = false;
    layout();
    transport::paintActive(
        {[](int x, int y, int w, int h, unsigned rgb) { rect(x, y, w, h, color(rgb)); },
         [](int x, int y, const std::string &s, unsigned rgb, int w) { text(x, y, s, color(rgb), w); }});
}

bool benchmarkTerrain() {
    portrait = true;
    zoom = 2;
    cy = mapH / 2.f;
    const uint32_t clock = esp_timer_get_time() / 1000;
    auto *buffer = static_cast<TileScratch *>(
        heap_caps_malloc(sizeof(TileScratch), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
    if (!buffer)
        return false;
    bool ok = true;
    printf("TDP MEM scratch=%u tile=%u decoder=%u\n", unsigned(sizeof(TileScratch)),
           unsigned(sizeof(buffer->pixels)), unsigned(sizeof(buffer->decoder)));
    for (int pan = 0; ok && pan < 6; ++pan) {
        cx = mapW / 2.f + pan * 8;
        uint32_t reference = 0;
        for (int tiled = 0; tiled <= 1; ++tiled) {
            scratch = tiled ? buffer : nullptr;
            decoded = 0;
            tileError = false;
            auto *target = crowpanel_back_buffer();
            unsigned before = httpsActivity();
            int64_t start = esp_timer_get_time();
            render(target, clock);
            int64_t drawn = esp_timer_get_time();
            crowpanel_present();
            int64_t end = esp_timer_get_time();
            unsigned after = httpsActivity();
            auto crc = esp_rom_crc32_le(0, reinterpret_cast<uint8_t *>(target), panelWidth * panelHeight * 2);
            if (!tiled)
                reference = crc;
            ok = !tileError && crc == reference;
            printf(
                "TDP DRAW pan=%d tiled=%d draw_us=%lld present_us=%lld decoded=%u crc=%08lx tls=%d ok=%d\n",
                pan, tiled, drawn - start, end - drawn, decoded, (unsigned long)crc,
                (before & 1u) || before != after, ok);
        }
    }
    scratch = nullptr;
    free(buffer);
    return ok;
}
