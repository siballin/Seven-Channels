#!/usr/bin/env python3
"""Copy the published site into _site/ and minify its JavaScript and CSS with esbuild.

Used by the Pages workflow before upload. The repository keeps readable source files;
only the published copy is minified. Any file esbuild can't handle is published as is,
so a minifier problem never breaks the site.

Usage: python scripts/build_site.py [--out _site] [--esbuild "npx --yes esbuild@0.24.2"]
"""

import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = {".git", ".github", "scripts", "tests", "node_modules", "_site", "__pycache__", "supabase"}
SKIP_FILES = {"README.md", ".gitignore"}


def esbuild(command, source, loader):
    """Minify one string. Top-level names are kept: the site's classic scripts share globals."""
    result = subprocess.run(
        command + [f"--loader={loader}", "--minify", "--target=es2020", "--legal-comments=none", "--log-level=error"],
        input=source.encode("utf-8"), capture_output=True, timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", "replace")[:500])
    return result.stdout.decode("utf-8")


def copy_site(out):
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(out)
    for name in os.listdir(ROOT):
        if name in SKIP or name in SKIP_FILES or name.startswith("."):
            continue
        source = os.path.join(ROOT, name)
        target = os.path.join(out, name)
        if os.path.isdir(source):
            shutil.copytree(source, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        else:
            shutil.copy2(source, target)


def stamp_service_worker(out):
    """Give sw.js a version (a hash of the published files, so each deploy replaces the old offline copy) and the
    files to save at install: the page, the scripts it loads up front, the manifest and the app icons."""
    path = os.path.join(out, "sw.js")
    if not os.path.isfile(path):
        return
    with open(os.path.join(out, "index.html"), encoding="utf-8") as handle:
        html = handle.read()
    scripts = [src for src in re.findall(r'<script src="([^"]+)"', html) if not re.match(r"https?://", src)]
    precache = ["./", "index.html", "manifest.webmanifest", *scripts, "assets/app/icon-192.png", "assets/app/icon-512.png"]
    digest = hashlib.sha256()
    for root, _dirs, files in sorted(os.walk(out)):
        for name in sorted(files):
            if name == "sw.js" or root.startswith(os.path.join(out, "data")):
                continue
            with open(os.path.join(root, name), "rb") as handle:
                digest.update(name.encode() + handle.read())
    with open(path, encoding="utf-8") as handle:
        source = handle.read()
    source = re.sub(r'const VERSION = "[^"]*";', f'const VERSION = "{digest.hexdigest()[:12]}";', source, count=1)
    source = re.sub(r"const PRECACHE = \[[^\]]*\];", f"const PRECACHE = {json.dumps(precache)};", source, count=1)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(source)
    print(f"sw.js: version {digest.hexdigest()[:12]}, {len(precache)} files saved for offline use")


def minify_html(html, command):
    """Minify inline <script> (without src or type) and <style> blocks."""
    def script(match):
        try:
            return match.group(1) + esbuild(command, match.group(2), "js").strip() + match.group(3)
        except Exception as error:  # keep the original block
            print(f"warning: inline script left unminified: {error}", file=sys.stderr)
            return match.group(0)

    def style(match):
        try:
            return match.group(1) + esbuild(command, match.group(2), "css").strip() + match.group(3)
        except Exception as error:
            print(f"warning: inline style left unminified: {error}", file=sys.stderr)
            return match.group(0)

    html = re.sub(r"(<script>)(.*?)(</script>)", script, html, flags=re.S)
    html = re.sub(r"(<style>)(.*?)(</style>)", style, html, flags=re.S)
    return html


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join(ROOT, "_site"))
    parser.add_argument("--esbuild", default="npx --yes esbuild@0.24.2")
    args = parser.parse_args()
    command = shlex.split(args.esbuild)
    copy_site(args.out)
    stamp_service_worker(args.out)
    before = after = 0
    for name in sorted(os.listdir(args.out)):
        path = os.path.join(args.out, name)
        if not (name.endswith(".js") or name.endswith(".html")) or not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as handle:
            source = handle.read()
        try:
            output = minify_html(source, command) if name.endswith(".html") else esbuild(command, source, "js")
        except Exception as error:
            print(f"warning: {name} left unminified: {error}", file=sys.stderr)
            output = source
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(output)
        before += len(source.encode("utf-8"))
        after += len(output.encode("utf-8"))
        print(f"{name}: {len(source.encode('utf-8')) // 1024} KB -> {len(output.encode('utf-8')) // 1024} KB")
    print(f"total: {before // 1024} KB -> {after // 1024} KB")


if __name__ == "__main__":
    main()
