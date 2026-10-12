#!/usr/bin/env bash
# Renders the PNG icons from their SVG sources. Needs rsvg-convert (brew install librsvg).
#   web/icons/app-icon.svg          -> apple-touch-icon.png (180 px, the iPhone home screen),
#                                      icon-192.png and icon-512.png (the web manifest)
#   web/icons/app-icon-maskable.svg -> icon-maskable-512.png (the mark in the inner 80%)
#   web/public/icons/favicon.svg    -> favicon-32.png (browsers without SVG favicons)
# All of them land in web/public/icons/.
set -euo pipefail
cd "$(dirname "$0")/.."
out=web/public/icons
rsvg-convert -w 180 -h 180 web/icons/app-icon.svg -o "$out/apple-touch-icon.png"
rsvg-convert -w 192 -h 192 web/icons/app-icon.svg -o "$out/icon-192.png"
rsvg-convert -w 512 -h 512 web/icons/app-icon.svg -o "$out/icon-512.png"
rsvg-convert -w 512 -h 512 web/icons/app-icon-maskable.svg -o "$out/icon-maskable-512.png"
rsvg-convert -w 32 -h 32 "$out/favicon.svg" -o "$out/favicon-32.png"
