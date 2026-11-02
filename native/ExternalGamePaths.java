package com.zenni.pokevoid;

import android.os.Build;
import android.os.Environment;
import java.io.File;
import java.io.IOException;

/** Every large, mutable game file lives in the shared PokeVoid folder. */
public final class ExternalGamePaths {
    private ExternalGamePaths() {}
    public static ExternalGameStorage storage() throws IOException {
        if (Build.VERSION.SDK_INT < 30 || !Environment.isExternalStorageManager())
            throw new IOException("Enable All files access to use PokeVoid/Game");
        return new ExternalGameStorage(new File(Environment.getExternalStorageDirectory(), "PokeVoid/Game"));
    }
    public static File downloads() throws IOException { return storage().downloads(); }
}
