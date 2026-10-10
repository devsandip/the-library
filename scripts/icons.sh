#!/usr/bin/env bash
# Renders the PNG icons from their SVG sources. Needs rsvg-convert (brew install librsvg).
#   web/icons/app-icon.svg -> web/public/apple-touch-icon.png (180 px, the iPhone home screen)
#   web/public/favicon.svg -> web/public/favicon-32.png (32 px, browsers without SVG favicons)
set -euo pipefail
cd "$(dirname "$0")/.."
rsvg-convert -w 180 -h 180 web/icons/app-icon.svg -o web/public/apple-touch-icon.png
rsvg-convert -w 32 -h 32 web/public/favicon.svg -o web/public/favicon-32.png
