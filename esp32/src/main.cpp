// Jarvis on the ESP32-2432S028 ("Cheap Yellow Display" / CYD, 2.8" ILI9341).
//
// A touch-driven J.A.R.V.I.S. terminal with the arc-reactor HUD. The board has
// no microphone, so instead of a wake word you tap on-screen command buttons;
// each one POSTs to your Cloudflare Worker's /jarvis endpoint over Wi-Fi (the
// same brain + long-term memory as the rest of Jarvis) and the reply is shown
// on the glowing HUD. The RGB LED mirrors the state.
//
// Build with PlatformIO (see platformio.ini). Copy include/config.example.h to
// include/config.h first.

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>
#include <ArduinoJson.h>
#include <time.h>

#include "config.h"

// ---- Board pins (fixed on the CYD) ----
#define PIN_BL   21          // display backlight
#define XPT_CLK  25          // touch controller (XPT2046) on its own SPI bus
#define XPT_MISO 39
#define XPT_MOSI 32
#define XPT_CS   33
#define XPT_IRQ  36
#define LED_R    4           // onboard RGB LED (active LOW)
#define LED_G    16
#define LED_B    17

// ---- Colours (RGB565) ----
#define RGB565(r, g, b) ((uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)))
static const uint16_t COL_BG     = RGB565(2, 6, 11);
static const uint16_t COL_CYAN   = RGB565(56, 208, 255);
static const uint16_t COL_BRIGHT = RGB565(200, 246, 255);
static const uint16_t COL_DIM    = RGB565(14, 70, 105);
static const uint16_t COL_AMBER  = RGB565(255, 168, 40);

// ---- Layout (landscape, 320 x 240) ----
static const int SCR_W = 320, SCR_H = 240;
static const int CX = 160, CY = 80;      // reactor centre
static const int R_OUTER = 40, R_MID = 34;
static const int REACTOR_SZ = 96;        // whole reactor rendered in one sprite (~18 KB)
static const int STATUS_Y = 132;
static const int CAP_Y = 150, CAP_LH = 18, CAP_LINES = 3;
static const int BTN_Y = 206, BTN_H = 30, BTN_W = 100, BTN_GAP = 5;

TFT_eSPI tft = TFT_eSPI();
TFT_eSprite reactor = TFT_eSprite(&tft);
SPIClass touchSPI(HSPI);
XPT2046_Touchscreen ts(XPT_CS, XPT_IRQ);

enum State { IDLE, PROCESSING, REPLY };
State state = IDLE;

struct Button { int x; const char *label; const char *prompt; };
Button buttons[3] = {
	{5,   CMD1_LABEL, CMD1_PROMPT},
	{110, CMD2_LABEL, CMD2_PROMPT},
	{215, CMD3_LABEL, CMD3_PROMPT},
};

int lastMinute = -1;

// --------------------------------------------------------------------------- //
// LED + tiny helpers
// --------------------------------------------------------------------------- //

void setLed(bool r, bool g, bool b) {  // active LOW
	digitalWrite(LED_R, r ? LOW : HIGH);
	digitalWrite(LED_G, g ? LOW : HIGH);
	digitalWrite(LED_B, b ? LOW : HIGH);
}

uint16_t scaleCyan(uint8_t i) {
	return RGB565((56 * i) / 255, (208 * i) / 255, (255 * i) / 255);
}

// --------------------------------------------------------------------------- //
// HUD drawing
// --------------------------------------------------------------------------- //

void drawButtons() {
	tft.setTextFont(2);
	tft.setTextDatum(MC_DATUM);
	for (auto &btn : buttons) {
		tft.drawRoundRect(btn.x, BTN_Y, BTN_W, BTN_H, 5, COL_CYAN);
		tft.setTextColor(COL_BRIGHT, COL_BG);
		tft.drawString(btn.label, btn.x + BTN_W / 2, BTN_Y + BTN_H / 2);
	}
}

void drawStaticFrame() {
	tft.fillScreen(COL_BG);

	// Title + subtitle.
	tft.setTextDatum(TL_DATUM);
	tft.setTextFont(2);
	tft.setTextColor(COL_CYAN, COL_BG);
	tft.drawString("J.A.R.V.I.S.", 8, 4);
	tft.setTextFont(1);
	tft.setTextColor(COL_DIM, COL_BG);
	tft.drawString("JUST A RATHER VERY INTELLIGENT SYSTEM", 8, 22);

	// The reactor (rings, core, ticks, sweep) is drawn every frame from a sprite.
	drawButtons();
}

void showStatus(const char *text, uint16_t colour) {
	tft.fillRect(0, STATUS_Y, SCR_W, 16, COL_BG);
	tft.setTextFont(2);
	tft.setTextDatum(MC_DATUM);
	tft.setTextColor(colour, COL_BG);
	tft.drawString(text, CX, STATUS_Y + 8);
}

// Word-wrap a reply into the caption area (truncates past CAP_LINES with "...").
void showCaption(const String &text) {
	tft.fillRect(0, CAP_Y, SCR_W, CAP_LH * CAP_LINES, COL_BG);
	tft.setTextFont(2);
	tft.setTextDatum(TC_DATUM);
	tft.setTextColor(COL_BRIGHT, COL_BG);

	const int maxW = SCR_W - 16;
	int line = 0;
	String cur = "";
	int start = 0;
	while (start < (int)text.length() && line < CAP_LINES) {
		int sp = text.indexOf(' ', start);
		String word = (sp < 0) ? text.substring(start) : text.substring(start, sp);
		String cand = cur.length() ? cur + " " + word : word;
		if (tft.textWidth(cand) <= maxW) {
			cur = cand;
		} else {
			tft.drawString(cur, CX, CAP_Y + line * CAP_LH);
			line++;
			cur = word;
		}
		if (sp < 0) break;
		start = sp + 1;
	}
	if (line < CAP_LINES && cur.length()) {
		tft.drawString(cur, CX, CAP_Y + line * CAP_LH);
	} else if (line >= CAP_LINES) {
		tft.drawString("...", CX, CAP_Y + (CAP_LINES - 1) * CAP_LH);
	}
}

// Render the whole reactor — glow core, reticle, rings, ticks, sweep dot — into
// one sprite and push it. Double-buffered, so no flicker and nothing outside the
// sprite is disturbed.
void drawReactor(float t) {
	reactor.fillSprite(COL_BG);
	const int c = REACTOR_SZ / 2;  // sprite centre
	float rate = (state == PROCESSING) ? 9.0 : 3.0;
	float pulse = 0.5 + 0.5 * sin(t * rate);

	// Concentric glow, bright centre fading out.
	for (int r = 30; r > 0; r -= 2) {
		uint8_t inten = map(r, 0, 30, 235, 16);
		reactor.fillCircle(c, c, r, scaleCyan(inten));
	}
	reactor.fillCircle(c, c, 7 + (int)(pulse * 3), COL_BRIGHT);

	// Rotating triangle reticle (the arc-reactor motif).
	float a = t * 0.9;
	int px[3], py[3];
	for (int k = 0; k < 3; k++) {
		float ang = a + k * (2 * PI / 3.0);
		px[k] = c + cos(ang) * 16;
		py[k] = c + sin(ang) * 16;
	}
	for (int k = 0; k < 3; k++) {
		reactor.drawLine(px[k], py[k], px[(k + 1) % 3], py[(k + 1) % 3], COL_BRIGHT);
	}

	// Rings + tick marks.
	reactor.drawCircle(c, c, R_MID, COL_DIM);
	reactor.drawCircle(c, c, R_OUTER, COL_DIM);
	for (int i = 0; i < 12; i++) {
		float ta = i * (PI / 6.0);
		reactor.drawLine(c + cos(ta) * (R_OUTER + 2), c + sin(ta) * (R_OUTER + 2),
		                 c + cos(ta) * (R_OUTER + 5), c + sin(ta) * (R_OUTER + 5), COL_CYAN);
	}

	// Sweeping dot on the outer ring (faster while thinking).
	float sa = t * ((state == PROCESSING) ? 4.0 : 1.4);
	reactor.fillCircle(c + cos(sa) * (R_OUTER - 1), c + sin(sa) * (R_OUTER - 1), 2, COL_BRIGHT);

	reactor.pushSprite(CX - c, CY - c);
}

void updateClock(bool force) {
	struct tm ti;
	if (!getLocalTime(&ti, 50)) return;
	if (!force && ti.tm_min == lastMinute) return;
	lastMinute = ti.tm_min;
	char buf[6];
	strftime(buf, sizeof(buf), "%H:%M", &ti);
	tft.fillRect(SCR_W - 60, 2, 60, 20, COL_BG);
	tft.setTextFont(4);
	tft.setTextDatum(TR_DATUM);
	tft.setTextColor(COL_CYAN, COL_BG);
	tft.drawString(buf, SCR_W - 6, 2);
}

// --------------------------------------------------------------------------- //
// Networking
// --------------------------------------------------------------------------- //

String jsonEscape(const String &s) {
	String out = "\"";
	for (char ch : s) {
		if (ch == '"' || ch == '\\') { out += '\\'; out += ch; }
		else if (ch == '\n') out += "\\n";
		else out += ch;
	}
	out += "\"";
	return out;
}

String askJarvis(const String &prompt) {
	if (WiFi.status() != WL_CONNECTED) {
		WiFi.reconnect();
		return "No network. I'll be back when Wi-Fi returns.";
	}
	WiFiClientSecure client;
	client.setInsecure();  // skip cert validation (fine for a hobby device)

	HTTPClient https;
	https.setTimeout(20000);
	if (!https.begin(client, JARVIS_URL)) return "Couldn't open a connection.";
	https.addHeader("content-type", "application/json");
	https.addHeader("accept", "application/json");
	// A real User-Agent: Cloudflare bot protection 403s the default one.
	https.addHeader("user-agent", "Jarvis-CYD/1.0");
	if (strlen(JARVIS_API_KEY) > 0) {
		https.addHeader("authorization", String("Bearer ") + JARVIS_API_KEY);
	}

	String body = String("{\"text\":") + jsonEscape(prompt) +
	              ",\"sessionId\":\"" JARVIS_SESSION "\"}";
	int code = https.POST(body);

	String reply;
	if (code == 200) {
		String payload = https.getString();
		JsonDocument doc;
		if (deserializeJson(doc, payload)) {
			reply = "I couldn't read my brain's reply.";
		} else {
			const char *r = doc["reply"] | "";
			const char *e = doc["error"] | "";
			reply = strlen(r) ? r : (strlen(e) ? e : "No reply.");
		}
	} else if (code == 401) {
		reply = "I'm not authorised — check the A.P.I. key.";
	} else if (code == 403) {
		reply = "My connection was blocked before reaching the brain.";
	} else if (code > 0) {
		reply = String("Brain error, code ") + code + ".";
	} else {
		reply = "I couldn't reach my brain just now.";
	}
	https.end();
	Serial.printf("Jarvis(%d): %s\n", code, reply.c_str());
	return reply;
}

// --------------------------------------------------------------------------- //
// Touch
// --------------------------------------------------------------------------- //

// Raw XPT2046 range -> screen. These defaults suit most CYD units in landscape;
// enable TOUCH_DEBUG in config.h and adjust if taps land in the wrong place.
static const int TS_MINX = 200, TS_MAXX = 3900, TS_MINY = 240, TS_MAXY = 3800;

bool getTouch(int &sx, int &sy) {
	if (!ts.touched()) return false;
	TS_Point p = ts.getPoint();
#ifdef TOUCH_DEBUG
	Serial.printf("raw touch x=%d y=%d z=%d\n", p.x, p.y, p.z);
#endif
	sx = constrain(map(p.x, TS_MINX, TS_MAXX, 0, SCR_W), 0, SCR_W - 1);
	sy = constrain(map(p.y, TS_MINY, TS_MAXY, 0, SCR_H), 0, SCR_H - 1);
	return true;
}

int hitButton(int x, int y) {
	if (y < BTN_Y || y > BTN_Y + BTN_H) return -1;
	for (int i = 0; i < 3; i++) {
		if (x >= buttons[i].x && x <= buttons[i].x + BTN_W) return i;
	}
	return -1;
}

bool hitReactor(int x, int y) {
	int dx = x - CX, dy = y - CY;
	return dx * dx + dy * dy <= R_OUTER * R_OUTER;
}

void runCommand(const char *label, const char *prompt) {
	state = PROCESSING;
	setLed(false, false, true);  // blue = thinking
	showStatus("PROCESSING", COL_CYAN);
	showCaption(String("> ") + label);
	String reply = askJarvis(prompt);
	showStatus("REPLY", COL_BRIGHT);
	showCaption(reply);
	setLed(false, true, false);  // green = spoke
	state = REPLY;
}

// --------------------------------------------------------------------------- //
// Setup / loop
// --------------------------------------------------------------------------- //

void connectWiFi() {
	showStatus("CONNECTING", COL_CYAN);
	WiFi.mode(WIFI_STA);
	WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
	uint32_t start = millis();
	while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
		delay(250);
	}
	if (WiFi.status() == WL_CONNECTED) {
		configTzTime(TZ_INFO, NTP_SERVER);
		showStatus("ONLINE", COL_CYAN);
	} else {
		showStatus("NO WI-FI", COL_AMBER);
	}
}

void setup() {
	Serial.begin(115200);

	pinMode(LED_R, OUTPUT);
	pinMode(LED_G, OUTPUT);
	pinMode(LED_B, OUTPUT);
	setLed(false, false, false);

	pinMode(PIN_BL, OUTPUT);
	digitalWrite(PIN_BL, HIGH);  // backlight on

	tft.init();
	tft.setRotation(1);  // landscape, 320x240
	// If your unit shows inverted colours, uncomment:
	// tft.invertDisplay(true);

	touchSPI.begin(XPT_CLK, XPT_MISO, XPT_MOSI, XPT_CS);
	ts.begin(touchSPI);
	ts.setRotation(1);

	reactor.createSprite(REACTOR_SZ, REACTOR_SZ);

	drawStaticFrame();
	connectWiFi();
	setLed(false, false, false);
	state = IDLE;
	updateClock(true);
}

uint32_t lastFrame = 0, lastTouch = 0;

void loop() {
	uint32_t now = millis();

	// ~30 fps animation of the reactor + sweep + clock.
	if (now - lastFrame > 33) {
		lastFrame = now;
		float t = now / 1000.0;
		drawReactor(t);
		updateClock(false);
		// LED breathes cyan while idle.
		if (state == IDLE) {
			setLed(false, false, (sin(t * 2) > 0));
		}
	}

	// Debounced touch handling.
	int x, y;
	if (now - lastTouch > 350 && getTouch(x, y)) {
		lastTouch = now;
		int b = hitButton(x, y);
		if (b >= 0) {
			runCommand(buttons[b].label, buttons[b].prompt);
		} else if (hitReactor(x, y)) {
			// Tapping the reactor re-runs the briefing command.
			runCommand(buttons[2].label, buttons[2].prompt);
		} else if (state == REPLY) {
			// Tap elsewhere to dismiss the reply and return to standby.
			state = IDLE;
			showStatus("STANDBY", COL_DIM);
			showCaption("");
		}
	}
}
