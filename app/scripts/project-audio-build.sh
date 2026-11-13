#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p resources/bin
project_build=${YOGURT_PROJECT_BUILD_DIR:-native/yogurt-project-audio/.build}
swift build -c release --package-path native/yogurt-project-audio --scratch-path "$project_build"
cp "$project_build/release/yogurt-project-audio" resources/bin/yogurt-project-audio
codesign --force --sign - resources/bin/yogurt-project-audio
