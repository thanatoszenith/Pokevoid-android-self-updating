package com.zenni.pokevoid;
import java.io.*;
import java.util.*;

/** Only downloader-owned names; one resumable archive, at most 4 GiB and 48 hours old. */
public final class DownloadCache {
    public static final long MAX_BYTES = 4L * 1024 * 1024 * 1024;
    public static final long MAX_AGE_MS = 48L * 60 * 60 * 1000;
    public static synchronized void clean(File dir, String keep) throws IOException {
        File[] files = dir.listFiles((d, n) -> n.matches("[a-f0-9]{64}\\.(part|zip)"));
        if (files == null) return;
        Arrays.sort(files, (a,b) -> Long.compare(b.lastModified(), a.lastModified()));
        boolean retained = false;
        for (File file : files) {
            boolean eligible = keep == null || file.getName().startsWith(keep + ".");
            boolean retain = eligible && !retained && file.length() <= MAX_BYTES
                && System.currentTimeMillis() - file.lastModified() <= MAX_AGE_MS;
            if (retain) retained = true;
            else if (!file.delete()) throw new IOException("Cannot prune download cache");
        }
    }
}
