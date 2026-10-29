#include "StoopAlert.h"

#include <Ed25519.h>
#include <Utils.h>
#include <string.h>

#ifndef STOOP_ADMIN_PUBKEY
#error "STOOP_ADMIN_PUBKEY must be set (run tools/stoop_keygen.py) -- admin alerts have no safe default key"
#endif

namespace {

bool pubkey_decoded = false;
uint8_t admin_pubkey[32];

bool getAdminPubkey() {
  if (!pubkey_decoded) {
    pubkey_decoded = mesh::Utils::fromHex(admin_pubkey, sizeof(admin_pubkey), STOOP_ADMIN_PUBKEY);
  }
  return pubkey_decoded;
}

} // namespace

const char* stoopAlertVerifyResultReason(StoopAlertVerifyResult result) {
  switch (result) {
    case StoopAlertVerifyResult::OK: return "ok";
    case StoopAlertVerifyResult::BAD_LENGTH: return "wrong payload length";
    case StoopAlertVerifyResult::BAD_VERSION: return "unsupported version";
    case StoopAlertVerifyResult::BAD_TYPE: return "not an alert payload";
    case StoopAlertVerifyResult::BAD_SIGNATURE: return "bad signature (wrong passphrase, or STOOP_ADMIN_PUBKEY misconfigured)";
    default: return "unknown error";
  }
}

StoopAlertVerifyResult verifyStoopAlert(const uint8_t* payload, size_t len, StoopAlert& out) {
  if (len != STOOP_ALERT_PAYLOAD_LEN) return StoopAlertVerifyResult::BAD_LENGTH;
  if (payload[0] != STOOP_ALERT_VER) return StoopAlertVerifyResult::BAD_VERSION;
  if ((payload[1] & 0xF0) != STOOP_ALERT_TYPE_NIBBLE) return StoopAlertVerifyResult::BAD_TYPE;

  if (!getAdminPubkey()) return StoopAlertVerifyResult::BAD_SIGNATURE;

  const uint8_t* sig = payload + STOOP_ALERT_SIGNED_LEN;
  if (!Ed25519::verify(sig, admin_pubkey, payload, STOOP_ALERT_SIGNED_LEN)) {
    return StoopAlertVerifyResult::BAD_SIGNATURE;
  }

  // only parse the body once the signature over it has been verified
  out.posted = ((uint32_t)payload[2] << 24) | ((uint32_t)payload[3] << 16) |
               ((uint32_t)payload[4] << 8) | (uint32_t)payload[5];

  const uint8_t* body = payload + 6;
  size_t body_len = STOOP_ALERT_BODY_LEN;
  while (body_len > 0 && body[body_len - 1] == 0) body_len--;
  memcpy(out.body, body, body_len);
  out.body[body_len] = 0;

  return StoopAlertVerifyResult::OK;
}
