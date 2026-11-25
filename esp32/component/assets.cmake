set(PANEL_WIDTH 1024 CACHE STRING "Panel pixel width")
set(PANEL_HEIGHT 600 CACHE STRING "Panel pixel height")
get_filename_component(PANEL_DIR "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)
set(PANEL_ASSETS "${CMAKE_CURRENT_BINARY_DIR}/panel_assets.h")
if(PANEL_PREPACKED)
    configure_file("${PANEL_PREPACKED}" "${PANEL_ASSETS}" COPYONLY)
    return()
endif()
find_program(PANEL_NODE node REQUIRED)
add_custom_command(OUTPUT "${PANEL_ASSETS}"
    COMMAND "${PANEL_NODE}" "${PANEL_DIR}/pack.mjs" "${PANEL_WIDTH}" "${PANEL_HEIGHT}" "${PANEL_ASSETS}"
    DEPENDS "${PANEL_DIR}/pack.mjs" "${PANEL_DIR}/../rail.mjs" "${PANEL_DIR}/../public/hemel.mjs"
            "${PANEL_DIR}/../public/style.css" "${PANEL_DIR}/../public/data/corridor.json"
            "${PANEL_DIR}/../public/data/replay.json" "${PANEL_DIR}/../public/data/hemel-replay.json"
            "${PANEL_DIR}/../public/data/watford-replay.json"
    VERBATIM)
