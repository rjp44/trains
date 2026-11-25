idf_component_register(SRCS "main.cpp" "display.c" "wifi.cpp" "map.cpp" "feed.cpp"
    INCLUDE_DIRS "." "../generated"
    PRIV_REQUIRES esp_lcd esp_driver_gpio esp_driver_i2c esp_driver_uart esp_hw_support esp_mm esp_timer
                  esp_wifi esp_netif esp_event esp_http_client nvs_flash mbedtls json)
target_add_binary_data(${COMPONENT_LIB} "${CMAKE_CURRENT_LIST_DIR}/../generated/terrain.bin" BINARY)
