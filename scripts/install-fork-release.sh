#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
prefix=${1:-"$HOME/.local"}
name=$(basename "$root")
destination="$prefix/lib/$name"
test -f "$root/app/dist/index.js" || { echo "Run install.sh from the extracted release." >&2; exit 1; }
node --input-type=module -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 11)) throw new Error("Node.js >=24.11 is required")'
test ! -e "$destination" || { echo "Already installed: $destination; keep it or remove this exact version before reinstalling." >&2; exit 1; }
if test -e "$prefix/bin/paperclipai" && ! test -L "$prefix/bin/paperclipai"; then
  echo "Refusing to overwrite a non-symlink: $prefix/bin/paperclipai" >&2
  exit 1
fi
mkdir -p "$prefix/lib" "$prefix/bin"
cp -R "$root" "$destination"
# Keep the wrapper's directory stable when invoked through the bin symlink.
ln -sfn "$destination/app/dist/index.js" "$prefix/bin/paperclipai"
chmod +x "$destination/app/dist/index.js"
echo "Installed $prefix/bin/paperclipai; add $prefix/bin to PATH. Instance data was not changed."
