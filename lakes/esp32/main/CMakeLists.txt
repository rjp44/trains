set(entry main.cpp)
if(TRANSPORT_DEV)
    set(root "${CMAKE_CURRENT_LIST_DIR}/../../..")
    set(board "${root}/firmware/boards/crowpanel-p4-v1_2")
    set(player "${root}/firmware/player")
    set(entry "${board}/dev.cpp" "${player}/replay.cpp")
endif()
idf_component_register(SRCS ${entry} "display.c" "map.cpp" "settings_display.cpp" "feed.cpp"
    INCLUDE_DIRS "." "../generated"
    PRIV_REQUIRES panel_settings esp_lcd esp_driver_gpio esp_driver_i2c esp_driver_uart esp_hw_support esp_mm esp_timer
                  esp_wifi esp_netif esp_event esp_http_client nvs_flash mbedtls json)
target_add_binary_data(${COMPONENT_LIB} "${CMAKE_CURRENT_LIST_DIR}/../generated/terrain.bin" BINARY)

if(TRANSPORT_DEV)
    target_compile_definitions(${COMPONENT_LIB} PRIVATE TRANSPORT_DEV=1)
    target_include_directories(${COMPONENT_LIB} PRIVATE "${board}" "${player}")
    target_add_binary_data(${COMPONENT_LIB} "${CMAKE_CURRENT_LIST_DIR}/../generated/terrain.tiles" BINARY)
endif()

if(TRANSPORT_PROFILE)
    target_compile_definitions(${COMPONENT_LIB} PRIVATE TRANSPORT_PROFILE=1)
    target_include_directories(${COMPONENT_LIB} PRIVATE "${CMAKE_CURRENT_LIST_DIR}/../../../tests/conformance/baseline")
endif()
