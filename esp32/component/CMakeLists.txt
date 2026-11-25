idf_component_register(SRCS "panel.cpp" INCLUDE_DIRS "."
    PRIV_INCLUDE_DIRS "${CMAKE_CURRENT_BINARY_DIR}" REQUIRES lvgl)
include(assets.cmake)
add_custom_target(hemel_panel_assets DEPENDS "${PANEL_ASSETS}")
add_dependencies(${COMPONENT_LIB} hemel_panel_assets)
