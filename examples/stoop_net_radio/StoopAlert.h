#pragma once

#include <stddef.h>
#include <stdint.h>

// Wire format for an admin alert (165 bytes total), produced by
// web/admin.html and verified here -- the one place that happens, shared by
// both the local HTTP publish path (server.cpp) and the mesh-receive path
// (MyMesh::onChannelDataRecv):
//
//   ver        1   = STOOP_ALERT_VER
//   type       1   high nibble STOOP_ALERT_TYPE_NIBBLE = alert; low nibble reserved
//   posted     4   unix seconds, big-endian
//   body      95   UTF-8, NUL-padded (not NUL-terminated if exactly 95 bytes)
//   sig       64   Ed25519 over bytes [0, STOOP_ALERT_SIGNED_LEN)
#define STOOP_ALERT_VER 1
#define STOOP_ALERT_TYPE_NIBBLE 0x10

#define STOOP_ALERT_BODY_LEN 95
#define STOOP_ALERT_SIGNED_LEN (1 + 1 + 4 + STOOP_ALERT_BODY_LEN) // 101
#define STOOP_ALERT_SIG_LEN 64
#define STOOP_ALERT_PAYLOAD_LEN (STOOP_ALERT_SIGNED_LEN + STOOP_ALERT_SIG_LEN) // 165

// sendGroupData() data_type tag that marks a GRP_DATA payload as a stoop
// alert, distinct from DATA_TYPE_RESERVED (0x0000) and DATA_TYPE_DEV (0xFFFF).
#define STOOP_ALERT_DATA_TYPE 1

enum class StoopAlertVerifyResult : uint8_t {
  OK,
  BAD_LENGTH,
  BAD_VERSION,
  BAD_TYPE,
  BAD_SIGNATURE,
};

struct StoopAlert {
  uint32_t posted;
  char body[STOOP_ALERT_BODY_LEN + 1]; // NUL-padding trimmed, always NUL-terminated here
};

const char* stoopAlertVerifyResultReason(StoopAlertVerifyResult result);

// Verifies `payload` (expected exactly STOOP_ALERT_PAYLOAD_LEN bytes) against
// STOOP_ADMIN_PUBKEY, checking ver/type/signature in that order, signature
// last and only once ver/type look right. On OK, fills `out`.
StoopAlertVerifyResult verifyStoopAlert(const uint8_t* payload, size_t len, StoopAlert& out);
