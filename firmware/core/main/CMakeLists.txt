set(root "${CMAKE_CURRENT_LIST_DIR}/../../..")
set(hemel "${root}/esp32/crowpanel-p4/main")
set(lakes "${root}/lakes/esp32/main")
set(panel "${root}/esp32/component")
idf_component_register(SRCS "apps-ui.cpp" "core.cpp" "storage.cpp" "package.cpp"
  "${lakes}/display.c" "${lakes}/map.cpp" "${lakes}/feed.cpp" "${lakes}/settings_display.cpp"
  "${hemel}/source.cpp" "${hemel}/feed.cpp" "${hemel}/feed_vm.cpp" "${panel}/panel.cpp" "${panel}/wire.cpp"
  INCLUDE_DIRS "." "${lakes}" "${hemel}" "${panel}"
  PRIV_REQUIRES panel_settings esp_lcd esp_driver_gpio esp_driver_i2c esp_driver_i2s esp_driver_uart
    esp_hw_support esp_mm esp_timer esp_wifi esp_netif esp_event esp_http_client nvs_flash mbedtls json app_update)
if(NOT RELEASE_TRUST OR NOT RELEASE_URL OR NOT FEED_PREPACKED)
  message(FATAL_ERROR "Set RELEASE_TRUST, RELEASE_URL and FEED_PREPACKED as described in firmware/core/README.md")
endif()
target_compile_definitions(${COMPONENT_LIB} PRIVATE TRANSPORT_CORE=1 TRANSPORT_RELEASE_URL="${RELEASE_URL}" TRANSPORT_VERSION=${PROJECT_VER})
set_source_files_properties("${lakes}/feed.cpp" PROPERTIES COMPILE_DEFINITIONS "public_feed_start=lakes_feed_start")
set_source_files_properties("${hemel}/feed.cpp" PROPERTIES COMPILE_DEFINITIONS "public_feed_start=hemel_feed_start")
foreach(asset signing.pem)
  configure_file("${RELEASE_TRUST}/${asset}" "${CMAKE_CURRENT_BINARY_DIR}/${asset}" COPYONLY)
  target_add_binary_data(${COMPONENT_LIB} "${CMAKE_CURRENT_BINARY_DIR}/${asset}" TEXT)
endforeach()
configure_file("${FEED_PREPACKED}" "${CMAKE_CURRENT_BINARY_DIR}/board_feed.js" COPYONLY)
target_add_binary_data(${COMPONENT_LIB} "${CMAKE_CURRENT_BINARY_DIR}/board_feed.js" TEXT)
