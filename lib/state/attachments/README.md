# Attachment persistence

The repository owns attachment bytes, strict metadata validation, and safe paths.
External callers use `lib/state/index.ts`; application selects routing and upload
policy. Only missing directories or indexes read as empty. Corruption and access
errors remain failures, and reads never create files.

Save, URL update, and purge share a lock outside the issue directory. Saves use
unique filenames and atomically replace the validated index. An index-write failure
removes only the new file. URL updates read fresh state and reject missing entries.
A crash between writing bytes and publishing the index can leave unindexed bytes;
purge includes these files in its hash manifest.

Saves first acquire the shared issue-store lock and reject an existing archived
identity, so cleanup cannot race an upload into an archived record. Archive
retention holds that store lock through cleanup and its conditional record commit.
Uploads begun as new provider-only operations after record expiry are outside the
expired record's retention lifetime.

Paths require a canonical project slug, positive safe issue ID, and flat safe
basenames. Operations inspect directory ancestors from the configured workspace
and reject links, junctions, and non-directory ancestors. Purge validates all
entries before deletion, uses individual unlinks, and removes the index last.
Partial deletion can be retried. The returned manifest covers that completed
attempt; application/issues selects the retention policy.
The archive repository additionally records the complete pre-delete manifest in
its required intent journal. Its checkpoint failure prevents the first unlink;
the general application audit is not used as a durability gate.

These checks assume trusted configured workspace ancestors and cooperative local
writers. They do not provide an OS-level directory-handle guarantee against a
hostile process swapping paths between inspection and filesystem calls.
