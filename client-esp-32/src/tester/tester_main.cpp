// stoop-tester — M5StickC firmware that exercises a StoopNet node over WiFi.
//
// The Heltec node broadcasts an open AP ("Neighborhood Board (free)") on
// 8.8.8.8/24 with a captive portal. This client associates with that AP and
// runs an HTTP test suite against it, emitting the same machine-parsable
// `SELFTEST|name=…|result=…` lines the dr-esp32 analyzer already understands,
// then a `SELFTEST|suite=stoop_tester|failures=N|result=PASS|FAIL` summary.
//
// Tests auto-run shortly after boot (so `flow` can just reset the stick and
// listen). The serial console also takes one-shot commands so the host can
// re-run without a reflash:  run | reboot | status | help
//
// Build/flash/listen: ./scripts/run.sh -e m5stick-tester build|upload|monitor
#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>

#ifndef STOOP_TEST_SSID
#define STOOP_TEST_SSID "Neighborhood Board (free)"
#endif

// The node softAP-configures itself to 8.8.8.8 (captive-portal trick, see
// examples/stoop_net_radio/main.cpp), so the portal is always at this IP.
#ifndef STOOP_TEST_HOST
#define STOOP_TEST_HOST "8.8.8.8"
#endif

// Blink patterns while a suite runs: every test blips the LED, then the
// result is held — solid = pass, fast-blink = fail (GPIO10, active low).
#ifndef TESTER_LED_GPIO
#define TESTER_LED_GPIO 10
#endif

// How long to keep scanning for the node's AP before giving up (the Heltec
// needs ~10 s after its own reset to bring the AP up).
#define AP_WAIT_MS 90000
// Serial command that kicks off a suite run (also the boot default).
#define AUTOSTART_DELAY_MS 2500

static const char* TAG = "stoop-tester";

// Bumped per firmware change; the flow prints it so you can confirm the
// stick is actually running the bits you just built.
#ifndef TESTER_BUILD_LABEL
#define TESTER_BUILD_LABEL "dev"
#endif

struct TestResult {
    const char* name;
    bool pass;
    uint32_t ms;
    char note[96];
};

static TestResult s_results[16];
static size_t s_result_count = 0;
static uint32_t s_suite_start_ms = 0;
static bool s_suite_running = false;

void run_suite();

static void led_write(bool on) { digitalWrite(TESTER_LED_GPIO, on ? LOW : HIGH); }

static void led_blip() {
    led_write(true);
    delay(30);
    led_write(false);
}

static void log_line(const char* fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    Serial.printf("[%lu] ", (unsigned long)millis());
    Serial.printf("%s: ", TAG);
    char buf[256];
    vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    Serial.println(buf);
}

static void record(const char* name, bool pass, uint32_t ms, const char* fmt, ...) {
    if (s_result_count >= sizeof(s_results) / sizeof(s_results[0])) return;
    TestResult& r = s_results[s_result_count++];
    r.name = name;
    r.pass = pass;
    r.ms = ms;
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(r.note, sizeof(r.note), fmt, ap);
    va_end(ap);
    // The analyzer's regex wants exactly this prefix; extra |k=v fields after
    // the result are fine and carry the evidence.
    Serial.printf("SELFTEST|name=%s|result=%s|ms=%lu|%s\r\n", name,
                  pass ? "PASS" : "FAIL", (unsigned long)ms, r.note);
    led_blip();
}

// ---------------------------------------------------------------- HTTP help

static bool http_get(const char* path, int* code, String* body, String* headers) {
    HTTPClient http;
    String url = String("http://") + STOOP_TEST_HOST + path;
    if (!http.begin(url)) return false;
    http.setConnectTimeout(5000);
    http.setTimeout(8000);
    // default is "never follow": the suite wants to see raw 302s too
    http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
    *code = http.GET();
    if (headers) {
        String loc = http.getLocation();
        *headers = loc.length() ? String("location=") + loc : String();
    }
    if (*code > 0 && body) {
        // cap the fetch: index.html is ~40 kB gzipped and we only sniff it
        int len = http.getSize();
        WiFiClient* stream = http.getStreamPtr();
        int want = (len > 0 && len < 8192) ? len : (len > 0 ? 8192 : 512);
        char buf[1024];
        while (body->length() < want) {
            int n = stream->readBytes(buf, min((int)sizeof(buf), want - (int)body->length()));
            if (n <= 0) break;
            body->concat(buf, n);
        }
    }
    http.end();
    return *code > 0;
}

// ------------------------------------------------------------------- tests

static bool ensure_wifi() {
    if (WiFi.status() == WL_CONNECTED) return true;

    uint32_t t0 = millis();
    log_line("scanning for AP \"%s\" ...", STOOP_TEST_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.disconnect(false);
    WiFi.begin(STOOP_TEST_SSID /* open AP: no password */);
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < AP_WAIT_MS) {
        delay(500);
        led_write((millis() / 200) & 1);  // hunt blink
    }
    led_write(false);
    uint32_t ms = millis() - t0;
    if (WiFi.status() != WL_CONNECTED) {
        record("ap_connect", false, ms, "no AP \"%s\" within %ds", STOOP_TEST_SSID,
               (int)(AP_WAIT_MS / 1000));
        return false;
    }
    record("ap_connect", true, ms, "ssid=%s rssi=%d", STOOP_TEST_SSID, WiFi.RSSI());
    return true;
}

static void test_got_ip() {
    IPAddress ip = WiFi.localIP();
    // the node's DHCP hands out 8.8.8.x; anything else means we joined some
    // other network that happens to share the SSID
    bool in_ap_subnet = (ip[0] == 8 && ip[1] == 8 && ip[2] == 8);
    record("got_ip", in_ap_subnet, 0, "ip=%s gw=%s", ip.toString().c_str(),
           WiFi.gatewayIP().toString().c_str());
}

static void test_http_index() {
    int code = 0;
    String body;
    uint32_t t0 = millis();
    bool ok = http_get("/", &code, &body, nullptr);
    uint32_t ms = millis() - t0;
    if (!ok) {
        record("http_index", false, ms, "GET / failed (code=%d)", code);
        return;
    }
    // server sends Content-Encoding: gzip — first two bytes must be 1f 8b
    bool gz = body.length() >= 2 && (uint8_t)body[0] == 0x1F && (uint8_t)body[1] == 0x8B;
    record("http_index", code == 200 && gz, ms, "code=%d bytes=%u gzip=%d", code,
           (unsigned)body.length(), gz ? 1 : 0);
}

static void test_http_portal_probe() {
    int code = 0;
    String body;
    uint32_t t0 = millis();
    bool ok = http_get("/generate_204", &code, &body, nullptr);
    uint32_t ms = millis() - t0;
    // the captive portal answers Android's probe with the portal page, not 204
    record("http_portal_probe", ok && code == 200, ms, "code=%d bytes=%u", code,
           (unsigned)body.length());
}

static void test_http_unknown_redirects() {
    int code = 0;
    String headers;
    uint32_t t0 = millis();
    bool ok = http_get("/stoop-test-not-a-page", &code, nullptr, &headers);
    uint32_t ms = millis() - t0;
    bool loc_ok = headers.indexOf("location=http://" STOOP_TEST_HOST "/") == 0;
    record("http_unknown_redirects", ok && code == 302 && loc_ok, ms, "code=%d %s",
           code, headers.c_str());
}

static void test_http_max_message_bytes() {
    int code = 0;
    String body;
    uint32_t t0 = millis();
    bool ok = http_get("/api/stoop/max_message_bytes", &code, &body, nullptr);
    uint32_t ms = millis() - t0;
    bool numeric = ok && !body.isEmpty();
    for (unsigned i = 0; numeric && i < body.length(); i++) {
        if (!isDigit(body[i])) numeric = false;
    }
    record("http_max_message_bytes", ok && code == 200 && numeric, ms, "code=%d body=%s",
           code, body.c_str());
}

static void test_http_messages_json() {
    int code = 0;
    String body;
    uint32_t t0 = millis();
    bool ok = http_get("/api/stoop/messages", &code, &body, nullptr);
    uint32_t ms = millis() - t0;
    record("http_messages_json", ok && code == 200 && body.startsWith("["), ms,
           "code=%d bytes=%u", code, (unsigned)body.length());
}

static void test_http_limits() {
    int code = 0;
    String body;
    uint32_t t0 = millis();
    bool ok = http_get("/api/limits", &code, &body, nullptr);
    uint32_t ms = millis() - t0;
    record("http_limits", ok && code == 200 && body.indexOf("tokens_remaining") >= 0, ms,
           "code=%d body=%s", code, body.c_str());
}

// The end-to-end check: post through the web API, then read the board back
// and confirm the post (which went out over the LoRa mesh stack) is there.
// The post text carries the build label so a stale stick can't false-pass.
static void test_post_and_readback() {
    String marker = String("flow-test ") + TESTER_BUILD_LABEL + " " +
                    String((unsigned long)millis());

    HTTPClient http;
    String url = String("http://") + STOOP_TEST_HOST + "/api/post";
    uint32_t t0 = millis();
    if (!http.begin(url)) {
        record("post_and_readback", false, millis() - t0, "begin failed");
        return;
    }
    http.setConnectTimeout(5000);
    http.setTimeout(15000);  // posting waits on the LoRa radio
    http.addHeader("Content-Type", "application/x-www-form-urlencoded");
    // HTTPClient only parses response headers it was told to collect
    const char* collect[] = {"X-Stoop-Session"};
    http.collectHeaders(collect, 1);
    String req = "username=stoop-tester&text=" + marker;
    int code = http.POST(req);
    String limits = http.getString();
    String session = http.header("X-Stoop-Session");
    http.end();

    if (code != 200) {
        record("post_and_readback", false, millis() - t0, "POST code=%d body=%s", code,
               limits.c_str());
        return;
    }

    // read the board back and look for our exact marker
    int rcode = 0;
    String board;
    if (!http_get("/api/stoop/messages", &rcode, &board, nullptr) || rcode != 200) {
        record("post_and_readback", false, millis() - t0, "readback code=%d", rcode);
        return;
    }
    bool found = board.indexOf(marker) >= 0;
    record("post_and_readback", found, millis() - t0, "post=200 session=%s found=%d",
           session.isEmpty() ? "none" : session.c_str(), found ? 1 : 0);
}

// ---------------------------------------------------------------- console

static void print_status() {
    log_line("fw=%s ssid=%s wifi=%d ip=%s tests_run=%u", TESTER_BUILD_LABEL,
             STOOP_TEST_SSID, (int)WiFi.status(), WiFi.localIP().toString().c_str(),
             (unsigned)s_result_count);
}

static void print_help() {
    Serial.printf("commands: run | status | reboot | help\r\n");
}

static void poll_console() {
    static char buf[64];
    static size_t len = 0;
    while (Serial.available()) {
        char c = (char)Serial.read();
        if (c == '\r' || c == '\n') {
            if (len == 0) continue;
            buf[len] = 0;
            len = 0;
            if (!strcmp(buf, "run")) run_suite();
            else if (!strcmp(buf, "status")) print_status();
            else if (!strcmp(buf, "reboot")) ESP.restart();
            else print_help();
        } else if (len + 1 < sizeof(buf)) {
            buf[len++] = c;
        }
    }
}

// ------------------------------------------------------------------- suite

void run_suite() {
    if (s_suite_running) return;
    s_suite_running = true;
    s_result_count = 0;
    s_suite_start_ms = millis();
    log_line("suite start: fw=%s -> %s", TESTER_BUILD_LABEL, STOOP_TEST_HOST);

    if (ensure_wifi()) {
        test_got_ip();
        test_http_index();
        test_http_portal_probe();
        test_http_unknown_redirects();
        test_http_max_message_bytes();
        test_http_messages_json();
        test_http_limits();
        test_post_and_readback();
    }

    size_t failures = 0;
    for (size_t i = 0; i < s_result_count; i++) {
        if (!s_results[i].pass) failures++;
    }
    bool pass = s_result_count > 0 && failures == 0;
    Serial.printf("SELFTEST|suite=stoop_tester|failures=%u|result=%s\r\n",
                  (unsigned)failures, pass ? "PASS" : "FAIL");
    log_line("suite done: %u test(s), %u failure(s) -> %s", (unsigned)s_result_count,
             (unsigned)failures, pass ? "PASS" : "FAIL");

    if (pass) {
        led_write(true);  // hold solid on success
    } else {
        for (int i = 0; i < 12; i++) {  // fast-blink on failure
            led_write(i & 1);
            delay(120);
        }
        led_write(false);
    }
    WiFi.disconnect(false);  // free the radio; the node's connection-limiter
                             // only holds slots for ~10 min but be polite
    s_suite_running = false;
}

void setup() {
    Serial.begin(115200);
    delay(300);
    pinMode(TESTER_LED_GPIO, OUTPUT);
    led_write(false);

    Serial.printf("\r\nSTOOPTESTER|fw=%s|ssid=%s|host=%s|mac=%s|build=%s %s\r\n",
                  TESTER_BUILD_LABEL, STOOP_TEST_SSID, STOOP_TEST_HOST,
                  WiFi.macAddress().c_str(), __DATE__, __TIME__);
    print_help();
}

void loop() {
    static bool started = false;
    poll_console();
    if (!started && millis() >= AUTOSTART_DELAY_MS) {
        started = true;
        run_suite();  // power-on = run once; `run` over serial re-runs
    }
    delay(20);
}
