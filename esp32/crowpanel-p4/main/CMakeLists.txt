idf_component_register(SRCS "main.cpp" "display.c" "source.cpp" "feed.cpp" "feed_vm.cpp"
    INCLUDE_DIRS "."
    PRIV_REQUIRES panel_settings component esp_lcd esp_driver_gpio esp_driver_i2c esp_driver_i2s
    esp_driver_uart esp_hw_support esp_timer esp_wifi esp_netif esp_event esp_http_client nvs_flash mbedtls)

set(feed "${CMAKE_CURRENT_BINARY_DIR}/board_feed.js")
if(FEED_PREPACKED)
    configure_file("${FEED_PREPACKED}" "${feed}" COPYONLY)
else()
    find_program(node node REQUIRED)
    set(panel "${CMAKE_CURRENT_LIST_DIR}/../..")
    add_custom_command(OUTPUT "${feed}" COMMAND "${node}" "${panel}/standalone/bundle.mjs" "${feed}"
        DEPENDS "${panel}/standalone/bundle.mjs" "${panel}/standalone/board.mjs" "${panel}/standalone/platform.mjs"
                "${panel}/projection.mjs" "${panel}/schedules.mjs" "${panel}/arrivals.mjs" "${panel}/package-lock.json"
                "${panel}/../rail.mjs" "${panel}/../live.mjs" "${panel}/../abbey.mjs"
                "${panel}/../public/hemel.mjs" "${panel}/../public/data/corridor.json"
        VERBATIM)
endif()
target_add_binary_data(${COMPONENT_LIB} "${feed}" TEXT)
