#!/usr/bin/env bash
# Double-click this file in Finder to start the standalone Jarvis assistant.
# It opens in Terminal, sets up its environment on first run, and talks straight
# to Claude (no Worker needed). Push Enter to speak; Ctrl-C to quit.
cd "$(dirname "$0")"
exec ./jarvis --direct
