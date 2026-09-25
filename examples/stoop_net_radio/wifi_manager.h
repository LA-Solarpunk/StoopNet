#pragma once


/*
 * Sets up the devices WiFi and server routes. If a client wifi is specified,
 * it will attempt to connect, but will fail over to hosting as an AP. When connected as a client
 * it hosts itself on mDNS.
*/

#ifdef WIFI_SSID

#include <WebServer.h>
#include <helpers/ArduinoHelpers.h> // StdRNG
#include <helpers/MultiSerialInterface.h>
#include "RateLimiter.h"

extern WebServer server;
extern RateLimiter rate_limiter;

// Starts WiFi (client mode if CLIENT_WIFI_SSID is configured, else AP mode),
// the HTTP server, the captive-portal DNS redirector, and the TCP
// companion-radio interface, registering that interface with
// interface_manager. Also configures the rate limiter.
void wifiManagerBegin(MultiSerialInterface& interface_manager, StdRNG& fast_rng);

// Services the HTTP/DNS servers, the WiFi-client reconnect/AP-fallback state
// machine, and AP client eviction. Call every loop() iteration.
void wifiManagerLoop();

// True once connected to CLIENT_WIFI_SSID as a station; false in AP mode.
// Used by server.cpp to decide whether captive-portal redirects make sense.
bool wifiClientModeActive();

#endif // WIFI_SSID
