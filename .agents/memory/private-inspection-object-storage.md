---
name: Private inspection object storage
description: Security boundary and compatibility constraints for the API's private Google Cloud object routes.
---

Private object upload and download routes currently serve inspection photos. Keep upload authorization tied to inspection creation and downloads tied to inspection viewing unless a caller-specific authorization model is added.

The current upload URL flow does not assign the generic object ACL metadata. A direct `canAccessObjectEntity` check therefore denies objects uploaded through this flow, including existing photos. Do not add that check without migrating uploaders and initializing ACLs. Keep private photo content limited to safe raster image types and send `X-Content-Type-Options: nosniff`.

**Why:** The upload URL is generated before the inspection record is saved, while the API's ACL helper requires object metadata that this flow never writes. The routes still need staff permission checks because random object paths can leak through inspection data.

**How to apply:** Before expanding `/api/storage` beyond inspection photos, identify each upload caller and define its corresponding resource permission and object ownership rules.