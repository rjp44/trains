idf_component_register(SRCS "wifi.cpp" "preferences.cpp" "horn.cpp" "settings_ui.cpp"
    INCLUDE_DIRS "." PRIV_INCLUDE_DIRS "../component"
    REQUIRES lvgl__lvgl
    PRIV_REQUIRES esp_driver_ledc esp_driver_gpio esp_driver_i2s esp_timer esp_wifi esp_netif esp_event nvs_flash)
