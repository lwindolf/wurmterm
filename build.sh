#!/bin/bash


set -euo pipefail

cd node_modules

cp \
	handlebars/dist/handlebars.min.js \
	mermaid/dist/mermaid.esm.min.mjs \
	../www/js/vendor

# Mermaid has chunks it wants to load
test -d ../www/js/vendor/chunks || mkdir ../www/js/vendor/chunks
cp -r mermaid/dist/chunks/mermaid.esm.min ../www/js/vendor/chunks
