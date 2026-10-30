declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    OWNER_IMPORT_USER_ID?: string;
    OWNER_IMPORT_KEY_HASH?: string;
    OWNER_IMPORT_PAYLOAD_HASH?: string;
    OWNER_IMPORT_EXPIRES_AT?: string;
    BUCKET?: R2Bucket;
  }
}
