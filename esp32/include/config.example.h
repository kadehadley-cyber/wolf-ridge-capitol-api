// Jarvis CYD configuration.
// Copy this file to config.h (same folder) and fill in your values.
// config.h is gitignored, so your Wi-Fi password and API key stay local.
#pragma once

// ---- Wi-Fi ----
#define WIFI_SSID     "your-wifi-name"
#define WIFI_PASSWORD "your-wifi-password"

// ---- Jarvis brain (your Cloudflare Worker) ----
#define JARVIS_URL     "https://wolf-ridge-capitol-api.kade-hadley.workers.dev/jarvis"
#define JARVIS_API_KEY ""      // bearer token, if your Worker has JARVIS_API_KEY set
#define JARVIS_SESSION "cyd"   // memory bucket so this device keeps its own thread

// ---- Clock (NTP) ----
#define NTP_SERVER "pool.ntp.org"
// POSIX TZ string. Denver: "MST7MDT,M3.2.0,M11.1.0"  London: "GMT0BST,M3.5.0/1,M10.5.0"
#define TZ_INFO    "MST7MDT,M3.2.0,M11.1.0"

// ---- Touch command buttons (label shown on screen -> prompt sent to Jarvis) ----
// The Worker has the tools + memory, so "at home" uses your saved home_location.
#define CMD1_LABEL  "TIME"
#define CMD1_PROMPT "what time is it?"
#define CMD2_LABEL  "WEATHER"
#define CMD2_PROMPT "what's the weather at home?"
#define CMD3_LABEL  "BRIEFING"
#define CMD3_PROMPT "give me my briefing"

// Uncomment to print raw touch coordinates to Serial for calibration.
// #define TOUCH_DEBUG
