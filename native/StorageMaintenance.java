package com.zenni.pokevoid;

import java.io.File;
import java.io.IOException;

/** Retired asset/download directories only. WebView profiles, preferences and saves are excluded. */
public final class StorageMaintenance {
    private StorageMaintenance() {}
    public static void removeRetiredInternal(File files, File cache) throws IOException {
        for (String name : new String[]{"resumable-bundles", "versions", "public"})
            ExternalGameStorage.removeTree(new File(files, name));
        ExternalGameStorage.removeTree(new File(cache, "capgo_downloads"));
    }
}
