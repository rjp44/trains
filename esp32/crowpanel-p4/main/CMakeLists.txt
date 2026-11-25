idf_component_register(SRCS "main.cpp" "display.c" INCLUDE_DIRS "."
    PRIV_REQUIRES component esp_lcd esp_driver_gpio esp_driver_i2c
    esp_driver_uart esp_hw_support esp_timer)
