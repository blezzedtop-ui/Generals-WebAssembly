# iPhone/iPad Safari memory profile for the Emscripten web build.
#
# The main web configuration intentionally keeps ALLOW_MEMORY_GROWTH enabled.
# A 768 MB initial SharedArrayBuffer caused a large committed-memory spike on
# iOS Safari before the game had a chance to load a map.  Keep a smaller
# initial heap and let Emscripten grow it only when the engine actually needs
# more memory.  This file is included after the generic Emscripten flags so
# the later linker setting wins for the final executable.

if(NOT EMSCRIPTEN)
    return()
endif()

add_link_options(
    "SHELL:-s INITIAL_MEMORY=512MB"
)
