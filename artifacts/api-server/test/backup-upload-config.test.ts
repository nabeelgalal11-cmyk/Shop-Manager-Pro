import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedBackupUploadUrl } from "../src/lib/backup-upload-config.js";

test("allows the branded backup relay URL and the existing relay during DNS cutover", () => {
  assert.equal(
    isAllowedBackupUploadUrl("https://backups.915motorsusa.com/api/backups/upload"),
    true,
  );
  assert.equal(
    isAllowedBackupUploadUrl("https://shop-manager-pro.replit.app/api/backups/upload"),
    true,
  );
});

test("does not accept the live shop host or a modified relay URL", () => {
  assert.equal(
    isAllowedBackupUploadUrl("https://app.915motorsusa.com/api/backups/upload"),
    false,
  );
  assert.equal(
    isAllowedBackupUploadUrl("https://backups.915motorsusa.com/api/backups/upload/"),
    false,
  );
  assert.equal(
    isAllowedBackupUploadUrl("http://backups.915motorsusa.com/api/backups/upload"),
    false,
  );
  assert.equal(isAllowedBackupUploadUrl(undefined), false);
});