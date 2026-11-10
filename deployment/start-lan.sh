#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
exec sh "$script_dir/start.sh" --lan "$@"
